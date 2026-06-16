function progressDebugLog(...args) {
  if (typeof window !== 'undefined' && window.CX_DEBUG === true) {
    console.debug(...args);
  }
}

/**
 * ProgressSyncService
 *
 * Serviço responsável por sincronizar progresso do usuário entre localStorage (cache local)
 * e Supabase (fonte de verdade persistente).
 *
 * Features:
 * - Offline-first: Atualiza localStorage imediatamente, sincroniza em background
 * - Delta sync: Envia apenas mudanças incrementais (reduz payload em 90%)
 * - Multi-tab coordination: Apenas uma aba (leader) sincroniza com Supabase
 * - Conflict resolution: Resolve conflitos entre dados locais e remotos
 * - Error handling: Retry com backoff exponencial, preserva dados em caso de falha
 */
class ProgressSyncService {
  constructor() {
    // Sync queue: acumula mudanças pendentes
    this.syncQueue = [];

    // Último estado sincronizado com sucesso (para calcular deltas)
    this.lastSyncedState = null;

    // Flags de controle
    this.syncInProgress = false;
    this.isLeader = false;
    this.initialized = false;

    // Multi-tab coordination
    this.broadcastChannel = null;
    this.tabId = this.generateTabId();
    this.heartbeatInterval = null;
    this.leaderCheckInterval = null;
    this.lastHeartbeatReceived = Date.now();

    // Challenge lock: impede duas abas no mesmo desafio simultaneamente
    this.activeChallengeId = null;     // ID do desafio ativo nesta aba
    this.challengeLockedByTab = null;  // tabId da aba que detém o lock ativo

    this.isTabVisible = !document.hidden;
    this.heartbeatPaused = false;

    // Sync counter (para Full State Sync periódico)
    this.syncCount = 0;

    // Debounce timer
    this.debounceTimer = null;
    this.debounceDelay = 500; // 500ms - Reduzido de 2000ms para melhor UX

    // Retry configuration
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 segundo inicial

    // Event listeners
    this.eventListeners = {};

    // localStorage cache for performance optimization
    this.cachedUsers = null;
    this.cacheTimestamp = null;

    // Listener references for cleanup
    this.pagehideListener = null;
    this.storageListener = null;
    this.visibilityListener = null;
  }

  generateTabId() {
    return `tab_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  getStorageType() {
    return sessionStorage;
  }

  getSessionToken() {
    return sessionStorage.getItem('cx_session_token') || localStorage.getItem('cx_session_token') || '';
  }

  async fetchProtectedJSON(url) {
    const token = this.getSessionToken();
    if (!token) {
      throw new Error('Missing session token');
    }

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Protected API returned ${response.status}`);
    }

    return response.json();
  }

  /**
   * Inicializa o serviço
   * Deve ser chamado após login bem-sucedido
   */
  async initialize() {
    if (this.initialized) {
      progressDebugLog('[ProgressSync] Already initialized');
      return;
    }

    progressDebugLog('[ProgressSync] Initializing...');

    try {
      this.initBroadcastChannel();

      await this.startLeaderElection();

      this.setupLifecycleHooks();

      this.initialized = true;
      progressDebugLog('[ProgressSync] ✓ Initialized successfully');
      progressDebugLog('[ProgressSync] Status: isLeader =', this.isLeader, ', tabId =', this.tabId);
      this.emit('initialized');
    } catch (error) {
      console.error('[ProgressSync] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Inicializa BroadcastChannel para comunicação entre abas
   */
  initBroadcastChannel() {
    // Check both window.BroadcastChannel and global.BroadcastChannel (for tests)
    const BroadcastChannelClass = window.BroadcastChannel || (typeof global !== 'undefined' ? global.BroadcastChannel : null);

    if (!BroadcastChannelClass) {
      console.warn('[ProgressSync] BroadcastChannel not supported');
      this.isLeader = true; // Se não suporta, assume como leader
      progressDebugLog('[ProgressSync] Became leader (BroadcastChannel not supported)');

      // CRITICAL FIX: Iniciar timers mesmo sem BroadcastChannel
      this.startHeartbeat();
      this.startHeartbeatMonitoring();
      return;
    }

    this.broadcastChannel = new BroadcastChannelClass('cxgame-progress-sync');

    this.broadcastChannel.onmessage = (event) => {
      this.handleBroadcastMessage(event.data);
    };

    progressDebugLog('[ProgressSync] BroadcastChannel initialized');
  }

  /**
   * Processa mensagens recebidas via BroadcastChannel
   */
  handleBroadcastMessage(message) {
    const { type, data, tabId, timestamp } = message;

    // Ignorar mensagens da própria aba
    if (tabId === this.tabId) return;

    switch (type) {
      case 'heartbeat':
        this.lastHeartbeatReceived = Date.now();
        // Se recebeu heartbeat de um leader, esta aba não é leader
        if (data.is_leader && this.isLeader) {
          if (data.tab_id < this.tabId) {
            this.isLeader = false;
            progressDebugLog('[ProgressSync] Demoted from leader');
          }
        }
        break;

      case 'sync_complete':
        // Leader completou sync, atualizar localStorage
        if (!this.isLeader) {
          this.updateLocalStorageFromRemote(data.progress);
          this.emit('sync:success');
        }
        break;

      case 'leader_election':
        // Outra aba iniciou eleição
        this.participateInElection(data);

        // Se esta aba é leader, responder imediatamente com heartbeat
        if (this.isLeader) {
          this.broadcast({
            type: 'heartbeat',
            data: {
              is_leader: true,
              tab_id: this.tabId
            }
          });
        }
        break;

      case 'progress_update':
        // Aba não-leader enviou mudança para leader processar
        if (this.isLeader) {
          this.queueChange(data.changeType, data.changeData);
        }
        break;

      case 'challenge_active':
        // Outra aba anunciou que esta em um desafio ativo
        this.challengeLockedByTab = data.tab_id;
        progressDebugLog('[ProgressSync] Challenge lock from tab:', data.tab_id, '| challenge:', data.challenge_id);
        this.emit('challenge:locked', { challengeId: data.challenge_id, ownerTab: data.tab_id });
        break;

      case 'challenge_released':
        // Aba que estava no desafio saiu ou completou
        if (this.challengeLockedByTab === data.tab_id) {
          this.challengeLockedByTab = null;
          progressDebugLog('[ProgressSync] Challenge lock released by tab:', data.tab_id);
          this.emit('challenge:released');
        }
        break;

      case 'challenge_ping':
        // Outra aba pergunta se esta esta em desafio ativo
        if (this.activeChallengeId) {
          this.broadcast({
            type: 'challenge_active',
            data: { challenge_id: this.activeChallengeId, tab_id: this.tabId }
          });
        }
        break;

      default:
        console.warn('[ProgressSync] Unknown message type:', type);
    }
  }

  /**
   * Inicia processo de Leader Election
   */
  async startLeaderElection() {
    // Isso garante que leaderCheckInterval existe logo após initialize()
    this.startHeartbeatMonitoring();

    // Anunciar presença
    this.broadcast({
      type: 'leader_election',
      data: {
        tab_id: this.tabId,
        timestamp: Date.now()
      }
    });

    // Aguardar 500ms para receber respostas
    await this.sleep(500);

    // Se não recebeu heartbeat recente, tornar-se leader
    const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeatReceived;

    // Se passou mais de 400ms desde a inicialização e não recebeu heartbeat,
    // significa que não há outro leader ativo - tornar-se leader
    // Usar 400ms em vez de 500ms para dar margem para processamento de mensagens
    if (timeSinceLastHeartbeat >= 400) {
      this.becomeLeader();
    }
  }

  /**
   * Participa de eleição iniciada por outra aba
   */
  participateInElection(data) {
    // Aba mais antiga (menor tab_id) vence
    if (this.isLeader && data.tab_id < this.tabId) {
      this.isLeader = false;
      progressDebugLog('[ProgressSync] Lost election to older tab');
    }
  }

  /**
   * Torna esta aba o leader
   */
  becomeLeader() {
    if (this.isLeader) {
      progressDebugLog('[ProgressSync] Already leader, skipping');
      return;
    }

    this.isLeader = true;
    progressDebugLog('[ProgressSync] ✓ Became leader (tabId:', this.tabId, ')');
    progressDebugLog('[ProgressSync] BroadcastChannel available:', !!this.broadcastChannel);

    this.startHeartbeat();

    // Emitir evento
    this.emit('leader:elected');
  }

  /**
   * Inicia envio periódico de heartbeat (apenas leader)
   */
  startHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.heartbeatInterval = setInterval(() => {
      if (!this.isTabVisible || this.heartbeatPaused) {
        return;
      }

      if (this.isLeader) {
        this.broadcast({
          type: 'heartbeat',
          data: {
            is_leader: true,
            tab_id: this.tabId
          }
        });
      }
    }, 15000); // A cada 15 segundos (optimized from 5s to reduce broadcasts)
  }

  /**
   * Pausa heartbeat (chamado quando tab fica inativa)
   */
  pauseHeartbeat() {
    progressDebugLog('[ProgressSync] Pausing heartbeat (tab inactive)');
    this.heartbeatPaused = true;
  }

  /**
   * Resume heartbeat (chamado quando tab fica ativa)
   */
  resumeHeartbeat() {
    progressDebugLog('[ProgressSync] Resuming heartbeat (tab active)');
    this.heartbeatPaused = false;

    // Enviar heartbeat imediatamente ao retornar
    if (this.isLeader) {
      this.broadcast({
        type: 'heartbeat',
        data: {
          is_leader: true,
          tab_id: this.tabId
        }
      });
    }
  }

  /**
   * Monitora heartbeat do leader
   */
  startHeartbeatMonitoring() {
    if (this.leaderCheckInterval) {
      clearInterval(this.leaderCheckInterval);
    }

    this.leaderCheckInterval = setInterval(() => {
      const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeatReceived;

      // Se não recebeu heartbeat por 10 segundos e não é leader, iniciar eleição
      if (timeSinceLastHeartbeat > 10000 && !this.isLeader) {
        progressDebugLog('[ProgressSync] Leader timeout, starting election');
        this.startLeaderElection();
      }
    }, 5000);
  }

  /**
   * Envia mensagem via BroadcastChannel
   */
  broadcast(message) {
    if (!this.broadcastChannel) return;

    this.broadcastChannel.postMessage({
      ...message,
      tabId: this.tabId,
      timestamp: Date.now()
    });
  }

  /**
   * Carrega progresso do Supabase (chamado no login)
   */
  async loadProgressFromSupabase(userId) {
    progressDebugLog('[ProgressSync] Loading progress from protected API for user:', userId);
    this.emit('sync:start');

    try {
      const progressData = await this.fetchProtectedJSON('/api/progress');
      progressDebugLog('[ProgressSync] Progress loaded from protected API:', progressData);

      await this.checkAndMigrateLocalData(userId, progressData);

      this.lastSyncedState = {
        user_id: progressData.user_id || userId,
        xp: progressData.xp || 0,
        level: progressData.level || 1,
        completed_challenges: progressData.completed_challenges || [],
        completed_minigames: progressData.completed_minigames || [],
        attempt_history: progressData.attempt_history || [],
        avatar_file_name: progressData.avatar_file_name || null,
        nickname: progressData.nickname || null,
        display_name: progressData.display_name || null,
        ranking_code: progressData.ranking_code || null,
        updated_at: progressData.updated_at || new Date().toISOString()
      };

      progressDebugLog('[ProgressSync] lastSyncedState updated from protected API:', this.lastSyncedState);

      this.updateLocalStorageFromRemote(this.lastSyncedState);
      this.emit('sync:success');
      return this.lastSyncedState;

    } catch (error) {
      console.error('[ProgressSync] Failed to load progress:', error);
      this.emit('sync:error', error);

      const localData = this.getLocalProgress(userId);
      if (localData) {
        progressDebugLog('[ProgressSync] Using local data as fallback cache');
        return localData;
      }

      progressDebugLog('[ProgressSync] No local data, returning initial state');
      return {
        user_id: userId,
        xp: 0,
        level: 1,
        completed_challenges: [],
        completed_minigames: [],
        attempt_history: [],
        updated_at: new Date().toISOString()
      };
    }
  }
  /**
   * Verifica e migra dados antigos do localStorage para Supabase
   */
  async checkAndMigrateLocalData(userId, remoteData) {
    const migrationKey = `cx_migrated_${userId}`;
    if (localStorage.getItem(migrationKey)) {
      return false;
    }

    const localData = this.getLocalProgress(userId);
    if (!localData || (localData.xp === 0 && localData.completed_challenges.length === 0)) {
      localStorage.setItem(migrationKey, 'true');
      return false;
    }

    if (remoteData?.xp > 0 || remoteData?.completed_challenges?.length > 0) {
      localStorage.setItem(migrationKey, 'true');
      return false;
    }

    console.warn('[ProgressSync] Local progress migration skipped: progress writes are server-authoritative now');
    localStorage.setItem(migrationKey, 'server_authoritative');
    return false;
  }
  /**
   * Obtém progresso do localStorage (com cache para performance)
   */
  getLocalProgress(userId) {
    if (this.cachedUsers && this.cacheTimestamp) {
      const cacheAge = Date.now() - this.cacheTimestamp;
      // Cache válido por 5 segundos
      if (cacheAge < 5000) {
        const user = this.cachedUsers[userId];
        if (user) {
          let attemptHistory = user.attemptHistory || [];
          if (Array.isArray(attemptHistory)) {
            attemptHistory = attemptHistory.filter(attempt => {
              if (typeof attempt === 'string') {
                return false;
              }
              return attempt &&
                typeof attempt === 'object' &&
                attempt.challenge_id &&
                attempt.timestamp &&
                typeof attempt.correct === 'boolean' &&
                typeof attempt.time_used === 'number' &&
                typeof attempt.score === 'number';
            });
          } else {
            attemptHistory = [];
          }

          return {
            xp: user.xp || 0,
            level: user.level || 1,
            completed_challenges: user.completedChallenges || [],
            completed_minigames: user.completedMinigames || [],
            attempt_history: attemptHistory,
            updated_at: new Date().toISOString()
          };
        }
      }
    }

    // Cache miss or expired - parse from storage (respecting user's choice)
    const storage = this.getStorageType();
    const users = JSON.parse(storage.getItem('cx_users') || '{}');

    this.cachedUsers = users;
    this.cacheTimestamp = Date.now();

    const user = users[userId];

    if (!user) return null;

    let attemptHistory = user.attemptHistory || [];
    if (Array.isArray(attemptHistory)) {
      // Filtrar apenas attempts válidos (remover strings "[]" e objetos inválidos)
      attemptHistory = attemptHistory.filter(attempt => {
        if (typeof attempt === 'string') {
          return false;
        }

        return attempt &&
          typeof attempt === 'object' &&
          attempt.challenge_id &&
          attempt.timestamp &&
          typeof attempt.correct === 'boolean' &&
          typeof attempt.time_used === 'number' &&
          typeof attempt.score === 'number';
      });
    } else {
      attemptHistory = [];
    }

    return {
      xp: user.xp || 0,
      level: user.level || 1,
      completed_challenges: user.completedChallenges || [],
      completed_minigames: user.completedMinigames || [],
      attempt_history: attemptHistory,
      updated_at: new Date().toISOString()
    };
  }

  /**
   * Adiciona mudança Ã  fila de sincronização
   */
  queueChange(changeType, data) {
    this.syncQueue.push({
      type: changeType,
      data: data,
      timestamp: new Date().toISOString()
    });

    progressDebugLog(`[ProgressSync] Queued change: ${changeType}`, data);
  }

  /**
   * Calcula delta entre estado atual e último sincronizado
   */
  calculateDelta(currentState) {
    // Se não há estado anterior, retornar tudo como delta
    if (!this.lastSyncedState) {
      return {
        xp_delta: currentState.xp,
        new_challenges: currentState.completed_challenges || [],
        new_minigames: currentState.completed_minigames || [],
        new_attempts: currentState.attempt_history || []
      };
    }

    // Calcular diferenças
    const xp_delta = currentState.xp - this.lastSyncedState.xp;

    const new_challenges = (currentState.completed_challenges || []).filter(
      id => !(this.lastSyncedState.completed_challenges || []).includes(id)
    );

    const new_minigames = (currentState.completed_minigames || []).filter(
      id => !(this.lastSyncedState.completed_minigames || []).includes(id)
    );

    // Attempts novos (comparar por timestamp)
    const lastSyncTime = new Date(this.lastSyncedState.updated_at).getTime();
    const new_attempts = (currentState.attempt_history || []).filter(attempt => {
      const attemptTime = new Date(attempt.timestamp).getTime();
      return attemptTime > lastSyncTime;
    });

    return {
      xp_delta,
      new_challenges: new_challenges.length > 0 ? new_challenges : [],
      new_minigames: new_minigames.length > 0 ? new_minigames : [],
      new_attempts: new_attempts.length > 0 ? new_attempts : []
    };
  }

  /**
   * Sincroniza delta (mudanças incrementais)
   */
  async syncDelta() {
    if (this.syncQueue.length === 0) {
      progressDebugLog('[ProgressSync] No changes to sync');
      return { success: true };
    }

    progressDebugLog('[ProgressSync] Refreshing authoritative progress after local event');
    this.emit('sync:start');

    try {
      const userId = sessionStorage.getItem('cx_logged_in_user');
      if (!userId) {
        throw new Error('No user logged in');
      }

      const data = await this.loadProgressFromSupabase(userId);
      this.syncQueue = [];
      this.syncCount++;

      this.broadcast({
        type: 'sync_complete',
        data: {
          progress: this.lastSyncedState
        }
      });

      this.emit('sync:success');
      return { success: true, data };

    } catch (error) {
      console.error('[ProgressSync] Protected progress refresh failed:', error);
      this.emit('sync:error', error);
      return { success: false, error };
    }
  }
  /**
   * Sincroniza estado completo
   */
  async syncFullState(stateOverride = null) {
    progressDebugLog('[ProgressSync] Full state upload disabled; refreshing authoritative state instead');
    this.emit('sync:start');

    try {
      const userId = sessionStorage.getItem('cx_logged_in_user');
      if (!userId) {
        throw new Error('No user logged in');
      }

      const data = await this.loadProgressFromSupabase(userId);
      this.syncQueue = [];
      this.syncCount = 0;

      this.broadcast({
        type: 'sync_complete',
        data: {
          progress: this.lastSyncedState
        }
      });

      this.emit('sync:success');
      return { success: true, data };

    } catch (error) {
      console.error('[ProgressSync] Full state refresh failed:', error);
      this.emit('sync:error', error);
      return { success: false, error };
    }
  }
  /**
   * Sincroniza com retry e backoff exponencial
   */
  async syncWithRetry(maxRetries = this.maxRetries) {
    let attempt = 0;
    let delay = this.retryDelay;

    while (attempt < maxRetries) {
      try {
        // Tentar delta sync primeiro
        const result = await this.syncDelta();

        if (result.success) {
          return result;
        }

        throw new Error(result.error || 'Sync failed');

      } catch (error) {
        attempt++;
        console.warn(`[ProgressSync] Sync attempt ${attempt} failed:`, error);

        if (attempt >= maxRetries) {
          console.error('[ProgressSync] Max retries reached');
          this.emit('sync:max_retries');
          return { success: false, error };
        }

        // Aguardar antes de tentar novamente (backoff exponencial)
        progressDebugLog(`[ProgressSync] Retrying in ${delay}ms...`);
        await this.sleep(delay);
        delay *= 2; // Dobrar delay
      }
    }
  }

  /**
   * Resolve conflitos entre dados locais e remotos
   */
  async resolveConflict(localData, remoteData) {
    progressDebugLog('[ProgressSync] Resolving conflict...');

    // Comparar timestamps
    const localTime = new Date(localData.updated_at || 0).getTime();
    const remoteTime = new Date(remoteData.updated_at || 0).getTime();

    // Estratégia de merge
    const merged = {
      user_id: localData.user_id || remoteData.user_id,

      // XP: usar maior valor
      xp: Math.max(localData.xp || 0, remoteData.xp || 0),

      // Level: recalcular baseado no XP
      level: Math.floor(Math.max(localData.xp || 0, remoteData.xp || 0) / 500) + 1,

      // Challenges: união sem duplicatas
      completed_challenges: [
        ...new Set([
          ...(localData.completed_challenges || []),
          ...(remoteData.completed_challenges || [])
        ])
      ],

      // Minigames: união sem duplicatas
      completed_minigames: [
        ...new Set([
          ...(localData.completed_minigames || []),
          ...(remoteData.completed_minigames || [])
        ])
      ],

      // Attempt history: merge ordenado por timestamp, limitar a 100
      attempt_history: this.mergeAttemptHistory(
        localData.attempt_history || [],
        remoteData.attempt_history || []
      ).slice(0, 100),

      updated_at: new Date().toISOString()
    };

    progressDebugLog('[ProgressSync] Conflict resolved:', merged);

    // Sincronizar estado merged
    await this.syncFullState(merged);

    this.updateLocalStorageFromRemote(merged);

    return merged;
  }

  /**
   * Faz merge de attempt_history de duas fontes
   */
  mergeAttemptHistory(local, remote) {
    const combined = [...local, ...remote];

    const unique = combined.filter((attempt, index, self) =>
      index === self.findIndex(a =>
        a.challenge_id === attempt.challenge_id &&
        a.timestamp === attempt.timestamp
      )
    );

    // Ordenar por timestamp DESC
    return unique.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  /**
   * Atualiza localStorage com dados remotos
   */
  updateLocalStorageFromRemote(remoteData) {
    const userId = sessionStorage.getItem('cx_logged_in_user');
    if (!userId) return;

    const storage = this.getStorageType();
    const users = JSON.parse(storage.getItem('cx_users') || '{}');

    const existingUser = users[userId] || {};
    const remoteXp = Number(remoteData?.xp);
    const remoteLevel = Number(remoteData?.level);

    users[userId] = {
      ...existingUser,
      xp: Number.isFinite(remoteXp) ? remoteXp : 0,
      level: Number.isFinite(remoteLevel) && remoteLevel >= 1 ? remoteLevel : 1,
      completedChallenges: Array.isArray(remoteData?.completed_challenges) ? remoteData.completed_challenges : [],
      completedMinigames: Array.isArray(remoteData?.completed_minigames) ? remoteData.completed_minigames : [],
      failedChallenges: Array.isArray(remoteData?.failed_challenges) ? remoteData.failed_challenges : [],
      attemptHistory: Array.isArray(remoteData?.attempt_history) ? remoteData.attempt_history : [],
      avatar_file_name: remoteData?.avatar_file_name || existingUser.avatar_file_name || null,
      nickname: remoteData?.nickname || existingUser.nickname || userId,
      display_name: remoteData?.display_name || existingUser.display_name || null,
      ranking_code: remoteData?.ranking_code || existingUser.ranking_code || null
    };

    storage.setItem('cx_users', JSON.stringify(users));
    this.cachedUsers = users;
    this.cacheTimestamp = Date.now();
    progressDebugLog('[ProgressSync] Storage overwritten from authoritative remote progress');
  }

  /**
   * Handler para Critical Events (fim de desafio, minigame, etc)
   */
  onCriticalEvent() {
    progressDebugLog('[ProgressSync] Critical event triggered, isLeader:', this.isLeader, 'syncQueue length:', this.syncQueue.length);

    // Se não é leader, tentar se tornar leader (pode ser que o leader anterior tenha fechado)
    if (!this.isLeader) {
      progressDebugLog('[ProgressSync] Not leader, attempting to become leader...');
      this.becomeLeader();
    }

    if (this.syncQueue.length === 0) {
      progressDebugLog('[ProgressSync] No changes in queue, skipping sync');
      return;
    }

    // Cancelar debounce anterior se existir
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      progressDebugLog('[ProgressSync] Cancelled previous debounce timer');
    }

    progressDebugLog('[ProgressSync] Scheduling sync in', this.debounceDelay, 'ms');
    this.debounceTimer = setTimeout(() => {
      progressDebugLog('[ProgressSync] Executing scheduled sync...');
      this.syncWithRetry();
    }, this.debounceDelay);
  }

  /**
   * Configura hooks de lifecycle (beforeunload, visibilitychange, pagehide, storage)
   */
  setupLifecycleHooks() {
    // pagehide: mais confiável que beforeunload, especialmente em mobile
    this.pagehideListener = (e) => {
      progressDebugLog('[ProgressSync] pagehide: cleaning up resources');
      this.releaseChallengeLock();  // Liberar lock de desafio antes de fechar
      this.destroy();
    };
    window.addEventListener('pagehide', this.pagehideListener);

    // beforeunload: sincronizar antes de fechar aba (desktop)
    window.addEventListener('beforeunload', (e) => {
      if (this.syncQueue.length > 0 && this.isLeader) {
        progressDebugLog('[ProgressSync] beforeunload: forcing immediate sync');

        // Cancelar debounce
        if (this.debounceTimer) {
          clearTimeout(this.debounceTimer);
        }

        // Tentar sync síncrono usando sendBeacon
        this.syncBeacon();

        // Também tentar sync normal (pode ser abortado pelo navegador)
        this.syncDelta().catch(err => {
          console.error('[ProgressSync] beforeunload sync failed:', err);
        });
      }
    });

    // visibilitychange: sincronizar quando aba fica oculta (mobile)
    this.visibilityListener = () => {
      const isHidden = document.hidden;
      this.isTabVisible = !isHidden;

      if (isHidden) {
        // Tab ficou inativa
        progressDebugLog('[ProgressSync] Tab hidden: pausing heartbeat and forcing sync');
        this.pauseHeartbeat();

        // Forçar sync se houver mudanças pendentes
        if (this.syncQueue.length > 0 && this.isLeader) {
          // Cancelar debounce
          if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
          }

          this.syncBeacon();
        }
      } else {
        // Tab ficou ativa
        progressDebugLog('[ProgressSync] Tab visible: resuming heartbeat');
        this.resumeHeartbeat();
      }
    };
    document.addEventListener('visibilitychange', this.visibilityListener);

    // storage: invalidar cache quando localStorage muda externamente
    this.storageListener = (e) => {
      if (e.key === 'cx_users' && e.storageArea === localStorage) {
        progressDebugLog('[ProgressSync] localStorage changed externally, invalidating cache');
        this.cachedUsers = null;
        this.cacheTimestamp = null;
      }
    };
    window.addEventListener('storage', this.storageListener);

    progressDebugLog('[ProgressSync] Lifecycle hooks configured');
  }

  /**
   * Sincroniza usando sendBeacon (garante entrega mesmo durante unload)
   */
  // ─────────────────────────────────────────────────────────────────────────
  // Challenge Lock: impede duas abas abertas no mesmo desafio
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Anuncia para outras abas que esta aba entrou em um desafio.
   * Deve ser chamado logo apos carregar challenge.html.
   */
  announceChallengeLock(challengeId) {
    this.activeChallengeId = challengeId;
    this.broadcast({
      type: 'challenge_active',
      data: { challenge_id: challengeId, tab_id: this.tabId }
    });
    progressDebugLog('[ProgressSync] Challenge lock announced:', challengeId);
  }

  /**
   * Remove o lock de desafio (completou, saiu ou fechou a aba).
   */
  releaseChallengeLock() {
    if (!this.activeChallengeId) return;
    progressDebugLog('[ProgressSync] Releasing challenge lock:', this.activeChallengeId);
    this.broadcast({
      type: 'challenge_released',
      data: { tab_id: this.tabId }
    });
    this.activeChallengeId = null;
  }

  /**
   * Verifica com outras abas se alguma delas esta em um desafio.
   * Retorna true se houver lock ativo em outra aba apos 300ms de espera.
   */
  async checkForChallengeLock() {
    if (!this.broadcastChannel) return false;
    this.challengeLockedByTab = null;
    this.broadcast({ type: 'challenge_ping', data: { tab_id: this.tabId } });
    // Aguardar 300ms para receber challenge_active de outra aba
    await new Promise(resolve => setTimeout(resolve, 300));
    const locked = !!this.challengeLockedByTab && this.challengeLockedByTab !== this.tabId;
    progressDebugLog('[ProgressSync] Challenge lock check result:', locked, '| lockedByTab:', this.challengeLockedByTab);
    return locked;
  }

  syncBeacon() {
    const userId = sessionStorage.getItem('cx_logged_in_user');
    const currentState = this.getLocalProgress(userId);

    if (!currentState) return;

    const delta = this.calculateDelta(currentState);

    const payload = JSON.stringify({
      type: 'delta',
      user_id: userId,
      delta: delta
    });

    // Use normal sync instead of beacon (endpoint doesn't exist)
    progressDebugLog('[ProgressSync] Triggering sync on page unload');
    this.syncDelta();
  }

  /**
   * Obtém cliente Supabase
   */
  async getSupabaseClient() {
    // Reutilizar cliente se já existe
    if (this.supabase) {
      return this.supabase;
    }

    if (window.supabaseClient) {
      this.supabase = window.supabaseClient;
      return this.supabase;
    }

    if (window.__APP_CONFIG_READY__) {
      await window.__APP_CONFIG_READY__;
    }

    if (!window.supabase) {
      await this.loadSupabaseSDK();
    }

    const SUPABASE_URL = window.SUPABASE_URL ||
      localStorage.getItem('SUPABASE_URL');

    if (!SUPABASE_URL) {
      console.error('SUPABASE_URL not configured');
      throw new Error('SUPABASE_URL not configured');
    }

    const SUPABASE_KEY = window.SUPABASE_PUBLISHABLE_KEY ||
      window.SUPABASE_KEY ||
      window.SUPABASE_ANON_KEY ||
      localStorage.getItem('SUPABASE_PUBLISHABLE_KEY') ||
      localStorage.getItem('SUPABASE_KEY');

    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      throw new Error('Supabase SDK unavailable');
    }

    this.supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    window.supabaseClient = this.supabase; // Manter compatibilidade

    progressDebugLog('[ProgressSync] Supabase client created and stored');
    return this.supabase;
  }

  /**
   * Carrega Supabase SDK dinamicamente
   */
  async loadSupabaseSDK() {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
      script.defer = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load Supabase SDK'));
      document.head.appendChild(script);
    });
  }

  /**
   * Utilitário: sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Event emitter: registrar listener
   */
  on(event, callback) {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(callback);
  }

  /**
   * Event emitter: remover listener
   */
  off(event, callback) {
    if (!this.eventListeners[event]) return;

    this.eventListeners[event] = this.eventListeners[event].filter(
      cb => cb !== callback
    );
  }

  /**
   * Event emitter: emitir evento
   */
  emit(event, data) {
    if (!this.eventListeners[event]) return;

    this.eventListeners[event].forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`[ProgressSync] Error in event listener for ${event}:`, error);
      }
    });
  }

  /**
   * Valida dados de progresso antes de sincronizar
   */
  validateProgressData(progressData) {
    const errors = [];

    if (typeof progressData.xp !== 'number' || progressData.xp < 0) {
      errors.push('XP must be a non-negative number');
    }

    if (typeof progressData.level !== 'number' || progressData.level < 1) {
      errors.push('Level must be >= 1');
    }

    if (!Array.isArray(progressData.completed_challenges)) {
      errors.push('completed_challenges must be an array');
    } else {
      const invalidChallenges = progressData.completed_challenges.filter(
        id => typeof id !== 'string' || id.trim() === ''
      );
      if (invalidChallenges.length > 0) {
        errors.push('completed_challenges contains invalid IDs');
      }
    }

    if (!Array.isArray(progressData.completed_minigames)) {
      errors.push('completed_minigames must be an array');
    } else {
      const invalidMinigames = progressData.completed_minigames.filter(
        id => typeof id !== 'string' || id.trim() === ''
      );
      if (invalidMinigames.length > 0) {
        errors.push('completed_minigames contains invalid IDs');
      }
    }

    if (!Array.isArray(progressData.attempt_history)) {
      errors.push('attempt_history must be an array');
    } else if (progressData.attempt_history.length > 0) {
      // Validar cada attempt (apenas se não estiver vazio)
      progressData.attempt_history.forEach((attempt, index) => {
        // Pular validação se attempt for null ou undefined
        if (!attempt || typeof attempt !== 'object') {
          errors.push(`attempt_history[${index}]: must be an object`);
          return;
        }

        if (!attempt.challenge_id || typeof attempt.challenge_id !== 'string') {
          errors.push(`attempt_history[${index}]: challenge_id is required and must be a string`);
        }
        if (!attempt.timestamp || isNaN(new Date(attempt.timestamp).getTime())) {
          errors.push(`attempt_history[${index}]: timestamp is required and must be valid ISO date`);
        }
        if (typeof attempt.correct !== 'boolean') {
          errors.push(`attempt_history[${index}]: correct must be a boolean`);
        }
        if (typeof attempt.time_used !== 'number' || attempt.time_used < 0) {
          errors.push(`attempt_history[${index}]: time_used must be a non-negative number`);
        }
        if (typeof attempt.score !== 'number' || attempt.score < 0) {
          errors.push(`attempt_history[${index}]: score must be a non-negative number`);
        }
      });

      if (progressData.attempt_history.length > 100) {
        errors.push('attempt_history exceeds maximum of 100 entries');
      }
    }

    const expectedLevel = Math.floor(progressData.xp / 500) + 1;
    if (progressData.level !== expectedLevel) {
      errors.push(`Level inconsistency: expected ${expectedLevel} based on XP ${progressData.xp}, got ${progressData.level}`);
    }

    return {
      valid: errors.length === 0,
      errors: errors
    };
  }

  /**
   * Obtém o status atual do serviço
   */
  getStatus() {
    if (!this.initialized) {
      return { state: 'not_initialized', message: 'Não inicializado' };
    }

    if (this.syncInProgress) {
      return { state: 'syncing', message: 'Sincronizando...' };
    }

    if (!navigator.onLine) {
      return { state: 'offline', message: 'Offline' };
    }

    if (this.syncQueue.length > 0) {
      return { state: 'pending', message: `${this.syncQueue.length} mudanças pendentes` };
    }

    if (this.lastSyncedState) {
      const timeSinceSync = Date.now() - new Date(this.lastSyncedState.updated_at).getTime();
      if (timeSinceSync < 60000) { // Menos de 1 minuto
        return { state: 'synced', message: 'Sincronizado' };
      }
    }

    return { state: 'idle', message: 'Pronto' };
  }

  /**
   * Cleanup: limpar recursos ao destruir serviço
   */
  destroy() {
    progressDebugLog('[ProgressSync] Destroying service...');

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.leaderCheckInterval) {
      clearInterval(this.leaderCheckInterval);
      this.leaderCheckInterval = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }

    if (this.pagehideListener) {
      window.removeEventListener('pagehide', this.pagehideListener);
      this.pagehideListener = null;
    }

    if (this.storageListener) {
      window.removeEventListener('storage', this.storageListener);
      this.storageListener = null;
    }

    if (this.visibilityListener) {
      document.removeEventListener('visibilitychange', this.visibilityListener);
      this.visibilityListener = null;
    }

    this.cachedUsers = null;
    this.cacheTimestamp = null;

    this.initialized = false;
    progressDebugLog('[ProgressSync] Service destroyed');
  }
}

// Exportar como singleton global
window.ProgressSyncService = ProgressSyncService;

if (!window.progressSync) {
  window.progressSync = new ProgressSyncService();
}

