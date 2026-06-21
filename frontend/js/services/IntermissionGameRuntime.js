(function initIntermissionGameRuntime(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.InlineIntermissionGame = api.InlineIntermissionGame;
    root.IntermissionGameRuntime = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function buildIntermissionGameRuntime(root) {
  function qs(id) {
    return root.document.getElementById(id);
  }

  function delay(ms) {
    return new Promise(resolve => root.setTimeout(resolve, ms));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getCatalog() {
    return root.IntermissionGameCatalog;
  }

  function getStorageType() {
    return root.sessionStorage;
  }

  function getUsersData() {
    try {
      return JSON.parse(getStorageType().getItem('cx_users') || '{}');
    } catch (error) {
      return {};
    }
  }

  function saveUsersData(users) {
    getStorageType().setItem('cx_users', JSON.stringify(users));
  }

  function getMergedProgressSnapshot(loggedInUser) {
    const localUser = getUsersData()[loggedInUser] || {};
    const progressFlow = root.ProgressFlow || null;
    const mergedProgress = progressFlow?.mergeProgressSources
      ? progressFlow.mergeProgressSources(localUser, root.progressSync?.lastSyncedState || {})
      : {
        completedChallenges: localUser.completedChallenges || [],
        completedMinigames: localUser.completedMinigames || [],
        failedChallenges: localUser.failedChallenges || []
      };
    const completedChallenges = progressFlow?.buildCompletedBaseSet
      ? Array.from(
        progressFlow.buildCompletedBaseSet(
          mergedProgress.completedChallenges,
          mergedProgress.completedMinigames
        )
      )
      : (mergedProgress.completedChallenges || []);
    const challengeStatusMap = new Map();

    (mergedProgress.failedChallenges || []).forEach(challengeId => {
      if (!challengeId) return;
      challengeStatusMap.set(challengeId, {
        challenge_id: challengeId,
        status: 'failed'
      });
    });

    return {
      ...mergedProgress,
      completedChallenges,
      challengeStatusMap
    };
  }

  function resolveFlowChallengeId(nodeOrProgress) {
    const resolved = root.IntermissionFlow?.resolveFlowChallengeId?.(nodeOrProgress);
    if (resolved) return resolved;

    const flowChallengeId = nodeOrProgress?.flow_challenge_id || nodeOrProgress?.flowChallengeId;
    if (typeof flowChallengeId === 'string' && flowChallengeId.startsWith('ig-')) {
      return flowChallengeId;
    }

    const syntheticChallengeId = nodeOrProgress?.synthetic_challenge_id || nodeOrProgress?.syntheticChallengeId;
    if (typeof syntheticChallengeId === 'string') {
      if (syntheticChallengeId.startsWith('ig-')) return syntheticChallengeId;
      const legacyMatch = syntheticChallengeId.match(/^game:L(\d+):slot(\d+):/);
      if (legacyMatch) return `ig-L${legacyMatch[1]}-slot${legacyMatch[2]}`;
    }

    return null;
  }

  function shuffle(items, seedText = 'seed') {
    let seed = 0;
    for (let i = 0; i < seedText.length; i++) seed = ((seed << 5) - seed + seedText.charCodeAt(i)) | 0;
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const j = seed % (i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  class InlineIntermissionGame {
    constructor(options = {}) {
      this.sessionId = options.sessionId;
      this.token = options.token;
      this.apiBase = String(options.apiBase || 'https://api.expconnect.com.br').replace(/\/+$/, '');
      this.loggedInUser = options.loggedInUser;
      this.session = null;
      this.meta = null;
      this.theme = null;
      this.manifest = null;
      this.currentNode = null;
      this.completed = false;
      this.root = null;
      this.scoreTracker = null;
    }

    async start() {
      this.preparePage();

      if (root.KeyboardNavigation) {
        root.KeyboardNavigation.init();
      }

      this.renderRouletteShell();

      try {
        this.session = await this.fetchJson(`${this.apiBase}/api/intermission/sessions/${encodeURIComponent(this.sessionId)}`);

        if (this.session?.manifest) {
          this.manifest = root.IntermissionFlow?.cacheManifestById?.(this.session.manifest) || this.session.manifest;
        }
        if (!this.manifest) {
          this.manifest = this.findManifestForSession();
        }

        this.currentNode = this.resolveCurrentNode();

        const gameId = this.session.game?.id || this.session?.game_id || this.currentNode?.game_id;
        
        this.meta = getCatalog().getGameMeta(gameId) || getCatalog().getGameMeta('termo-cx');
        
        this.theme = getCatalog().getGameTheme(this.meta.id);
        
        this.applyTheme();

        if (this.session?.progress) {
          this.updateProgress();
        }

        this.initializeProgressBar();

        if (this.session?.state === 'blocked') {
          this.updateHeader();
          this.renderBlockedState(this.session);
          return;
        }

        if (this.session?.state === 'completed') {
          this.updateHeader();
          this.syncLocalProgress(this.session.progress);
          this.renderFinalResult(this.session);
          return;
        }

        await this.spinRoulette(this.meta.id);
        
        this.updateHeader();
        
        this.renderGame();
      } catch (error) {
        console.error('[IntermissionGame] Load failed:', error);
        this.renderError(error.message || 'Nao foi possivel carregar o game.');
      }
    }

    preparePage() {
      root.document.body.classList.add('intermission-game-mode');
      const bgEffects = qs('bg-effects');
      const progressBar = qs('challenge-progress-bar');
      const questionCard = qs('question-card');
      const actionBar = qs('action-bar');
      const nextBar = qs('next-bar');
      const timer = qs('timer');
      const feedbackOverlay = qs('feedback-overlay');

      if (bgEffects) bgEffects.classList.remove('logum-mode');
      if (progressBar) progressBar.classList.remove('logum-mode');
      if (questionCard) {
        questionCard.className = 'question-card intermission-game-card';
        questionCard.innerHTML = '<div id="inline-intermission-root" class="inline-intermission-root"></div>';
      }
      if (actionBar) actionBar.style.display = 'none';
      if (nextBar) nextBar.style.display = 'none';
      if (timer) timer.style.display = 'none';
      if (feedbackOverlay) feedbackOverlay.classList.remove('show');
      this.root = qs('inline-intermission-root');
    }

    applyTheme() {
      const type = this.theme?.type || 'cx';
      const themeColor = '#D85A30';
      const themeSoft = '#FBEAE0';
      const themeBorder = '#D85A30';
      root.document.body.classList.toggle('intermission-theme-ex', type === 'ex');
      root.document.body.classList.toggle('intermission-theme-cx', type !== 'ex');
      root.document.body.style.setProperty('--intermission-game-color', themeColor);
      root.document.body.style.setProperty('--intermission-game-soft', themeSoft);
      root.document.body.style.setProperty('--intermission-game-border', themeBorder);

      const progressBar = qs('challenge-progress-bar');
      if (progressBar) {
        progressBar.classList.add('intermission-progress');
        progressBar.classList.toggle('intermission-progress--ex', type === 'ex');
        progressBar.classList.toggle('intermission-progress--cx', type !== 'ex');
      }
    }

    updateHeader() {
      const badge = qs('challenge-badge');
      const name = qs('challenge-name');
      const xpIndicator = qs('xp-indicator');
      if (badge) {
        badge.textContent = `${this.meta.letter} FASE ESPECIAL`;
        badge.className = `challenge-badge intermission-badge intermission-badge--${this.theme.type}`;
      }
      if (name) name.textContent = this.meta.name;
      if (xpIndicator && !xpIndicator.querySelector('.intermission-header-icon')) {
        const icon = root.document.createElement('span');
        icon.className = `intermission-header-icon intermission-header-icon--${this.theme.type}`;
        icon.textContent = this.meta.letter;
        xpIndicator.insertBefore(icon, xpIndicator.firstChild);
      }
    }

    updateProgress() {
      const manifest = this.manifest || this.findManifestForSession();
      const currentNode = this.currentNode || this.resolveCurrentNode(manifest);
      const sessionProgress = this.session?.progress || {};
      const orderIndexValue = Number(sessionProgress?.order_index);
      const currentOrderIndex = Number.isFinite(orderIndexValue)
        ? orderIndexValue
        : Number(currentNode?.order_index || 0);
      const current = currentOrderIndex + 1;
      const total = manifest?.total_nodes || manifest?.nodes?.length || 1;
      const progressCurrent = qs('progress-current');
      const progressTotal = qs('progress-total');
      const questionNumber = qs('question-number');
      const progressFill = qs('challenge-progress-fill');
      const dotsContainer = root.document.querySelector('.progress-steps');

      if (progressCurrent) progressCurrent.textContent = current;
      if (progressTotal) progressTotal.textContent = total;
      if (questionNumber) {
        const strong = questionNumber.querySelector('strong');
        if (strong) strong.textContent = String(current).padStart(2, '0');
      }
      if (progressFill) progressFill.style.setProperty('--progress', `${((current - 1) / total) * 100}%`);
      if (dotsContainer) {
        dotsContainer.innerHTML = '';
        for (let i = 0; i < total; i++) {
          const dot = root.document.createElement('span');
          const node = manifest?.nodes?.[i];
          dot.className = 'progress-dot';
          if (node?.type === 'game') dot.classList.add('progress-dot--game');
          if (i < current - 1) {
            dot.classList.add('active');
            dot.classList.add('completed');
          } else if (i === current - 1) {
            dot.classList.add('active');
          }
          dotsContainer.appendChild(dot);
        }
      }
    }

    findManifestForSession() {
      if (this.session?.manifest) {
        return root.IntermissionFlow?.cacheManifestById?.(this.session.manifest) || this.session.manifest;
      }

      const sessionProgress = this.session?.progress || {};
      const manifestId = this.session?.progress?.manifest_id || sessionProgress?.manifest_id;
      if (!manifestId) return null;
      return root.IntermissionFlow?.findManifestById?.(manifestId) || null;
    }

    resolveCurrentNode(manifestOverride = null) {
      const manifest = manifestOverride || this.manifest || this.findManifestForSession();
      if (!manifest) return null;

      const sessionProgress = this.session?.progress || {};
      const orderIndexValue = Number(this.session?.progress?.order_index ?? sessionProgress?.order_index);
      if (Number.isFinite(orderIndexValue)) {
        const byOrderIndex = (manifest.nodes || []).find(node => Number(node?.order_index) === orderIndexValue);
        if (byOrderIndex) return byOrderIndex;
      }

      const flowChallengeId = resolveFlowChallengeId(sessionProgress);
      if (flowChallengeId) {
        const byFlowChallengeId = root.IntermissionFlow?.findGameNodeByFlowChallengeId?.(manifest, flowChallengeId);
        if (byFlowChallengeId) return byFlowChallengeId;
      }

      return (manifest.nodes || []).find(node => node.session_id === this.sessionId) || null;
    }

    getNextTarget(data = null) {
      const navigationTarget = data?.navigation?.next_target || this.session?.navigation?.next_target;
      if (navigationTarget) {
        return navigationTarget;
      }

      const manifest = this.manifest || this.findManifestForSession();
      const currentNode = this.currentNode || this.resolveCurrentNode(manifest);
      const nextNode = currentNode ? manifest?.nodes?.find(node => node.order_index > currentNode.order_index) : null;
      const fallbackTarget = root.IntermissionFlow?.buildNavigationTarget?.(nextNode) || '/app';
      return fallbackTarget;
    }

    renderBlockedState(data = {}) {
      const nextTarget = this.normalizeNavigationTarget(this.ensurePhaseToken(data.navigation?.next_target || '/app'));
      const message = data.message || 'Essa fase especial nao esta mais disponivel.';
      this.root.innerHTML = `
        <section class="intermission-result-card" role="main" aria-label="Sessao indisponivel">
          <div class="intermission-card-stripe"></div>
          <div class="intermission-result-icon" aria-hidden="true">${escapeHtml(this.meta?.letter || '!')}</div>
          <h2>Sessao bloqueada</h2>
          <p>${escapeHtml(message)}</p>
          <button class="intermission-btn" id="intermission-blocked-next-btn">Continuar</button>
        </section>
      `;
      qs('intermission-blocked-next-btn')?.addEventListener('click', () => {
        root.location.href = nextTarget;
      });
    }

    async fetchJson(url, options = {}) {
      const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
      if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
      const response = await root.fetch(url, {
        ...options,
        credentials: 'include',
        headers
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.detail || data.error || `HTTP ${response.status}`);
      }
      return data;
    }

    renderRouletteShell() {
      this.root.innerHTML = `
        <section class="intermission-roulette-screen" role="main" aria-label="Roleta de seleção de jogo">
          <div class="intermission-top-label">FASE ESPECIAL - SORTEANDO SEU DESAFIO</div>
          <div class="intermission-slot-outer">
            <div class="intermission-slot-shine"></div>
            <div class="intermission-slot-shine intermission-slot-shine--bottom"></div>
            <div class="intermission-slot-border"></div>
            <div class="intermission-slot-track" id="intermission-slot-track" role="region" aria-label="Roleta de jogos" aria-live="polite">
              <div class="intermission-slot-item">
                <div class="intermission-game-icon">?</div>
                <div class="intermission-game-info">
                  <div class="intermission-game-name">Preparando roleta</div>
                  <div class="intermission-game-tag">EC</div>
                </div>
              </div>
            </div>
          </div>
          <div class="intermission-dots" id="intermission-dots" role="status" aria-label="Indicadores de jogos"></div>
          <div class="intermission-loading-copy" role="status" aria-live="polite">Estamos escolhendo seu game...</div>
        </section>
      `;
      this.renderRouletteDots();
    }

    renderRouletteDots(activeId = null) {
      const dots = qs('intermission-dots');
      if (!dots) return;
      dots.innerHTML = getCatalog().INTERMISSION_VISUAL_GAMES.map(game => {
        const active = activeId === game.id ? ` active-${game.type}` : '';
        return `<span class="intermission-dot${active}"></span>`;
      }).join('');
    }

    async spinRoulette(winnerId) {
      const sequence = getCatalog().buildRouletteSequence(winnerId, 3);
      const track = qs('intermission-slot-track');
      if (!track) return;

      track.innerHTML = sequence.map(game => {
        const theme = getCatalog().getGameTheme(game.id);
        return `
          <div class="intermission-slot-item">
            <div class="intermission-game-icon" style="background:${theme.color}">${escapeHtml(game.letter)}</div>
            <div class="intermission-game-info">
              <div class="intermission-game-name" style="color:${theme.color}">${escapeHtml(game.name)}</div>
              <div class="intermission-game-tag intermission-game-tag--${game.type}">${game.type.toUpperCase()}</div>
            </div>
          </div>
        `;
      }).join('');

      track.style.transition = 'none';
      track.style.transform = 'translateY(0)';
      await delay(80);

      if (root.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        const lastIndex = sequence.length - 1;
        track.style.transform = `translateY(-${lastIndex * 110}px)`;
        this.renderRouletteDots(sequence[lastIndex].id);
        await delay(250);
        return;
      }

      let delayMs = 40;
      for (let i = 1; i < sequence.length; i++) {
        const progress = i / (sequence.length - 1);
        track.style.transition = `transform ${delayMs}ms linear`;
        track.style.transform = `translateY(-${i * 110}px)`;
        this.renderRouletteDots(sequence[i].id);
        if (progress < 0.3) delayMs = Math.max(38, delayMs - 4);
        if (progress > 0.7) delayMs = Math.min(260, delayMs + 18);
        await delay(delayMs);
      }
      await delay(320);
    }

    renderSplash() {
      return this.renderGame();
    }

    showHowToPlay() {
      // Mantido por compatibilidade com KeyboardNavigation — sem uso no fluxo normal
    }

    renderGame() {
      const game = this.session.game;
      const canonicalId = getCatalog().canonicalizeGameId(game.id);
      const gameCssClass = `intermission-game--${canonicalId.replace(/[^a-z0-9-]/g, '')}`;
      
      if (root.ScoreTracker) {
        this.scoreTracker = new root.ScoreTracker(200);
        this.scoreTracker.startTimer();
      }
      
      this.root.innerHTML = `
        <section class="intermission-play-card ${gameCssClass}" data-game-id="${escapeHtml(canonicalId)}" role="main" aria-label="Área de jogo">
          <div class="intermission-card-stripe"></div>
          <div class="intermission-play-header">
            <span class="intermission-play-badge">DESAFIO</span>
            <div class="intermission-play-title">
              <span class="intermission-play-icon">${escapeHtml(this.meta.letter)}</span>
              <div>
                <strong>${escapeHtml(this.meta.name).replace(/\s(CX|EX)$/i, ' <span class="sector">$1</span>')}</strong>
                <small>${escapeHtml(game.subtitle || this.meta.desc)}</small>
              </div>
            </div>
            <div class="intermission-header-actions">
            <button 
              id="intermission-fullscreen-btn" 
              class="intermission-fullscreen-btn" 
              onclick="window.IntermissionGameRuntime?.toggleFullscreen?.()"
              aria-label="Alternar tela cheia"
              title="Tela cheia (F11)">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
              </svg>
            </button>
            <div class="intermission-stats-container">
              <div class="intermission-time-display" id="intermission-time-display" role="timer" aria-label="Tempo decorrido">
                <div class="time-label">TEMPO</div>
                <div class="time-value" id="time-value" aria-live="polite">00:00</div>
              </div>
              <div class="intermission-score-display" id="intermission-score-display" role="status" aria-label="Pontuação atual">
                <div class="score-label">PONTUAÇÃO</div>
                <div class="score-value" id="score-value" aria-live="polite">0</div>
                <div class="score-max">de 200 pts</div>
              </div>
            </div>
            </div>
          </div>
          <div id="intermission-game-board" class="intermission-game-board ${gameCssClass}__board" role="region" aria-label="Tabuleiro do jogo"></div>
          <footer class="intermission-game-footer">
            <span>${escapeHtml(this.meta.letter)}</span>
            <strong>${escapeHtml(this.meta.name)}</strong>
          </footer>
        </section>
      `;

      this.startTimeDisplay();
      
      if (root.KeyboardNavigation) {
        root.KeyboardNavigation.setupGameNavigation(canonicalId);
      }
      
      if (canonicalId === 'quem-disse-cx') return this.renderQuemDisse(game);
      if (canonicalId === 'sequencia-cx') return this.renderSequencia(game);
      if (canonicalId === 'conexo-cx') return this.renderConexo(game);
      if (canonicalId === 'termo-cx') return this.renderTermo(game);
      this.renderError('Game desconhecido.');
    }

    board() {
      return qs('intermission-game-board');
    }

    renderV2ProgressStrip() {
      const manifest = this.manifest || this.findManifestForSession();
      const nodes = Array.isArray(manifest?.nodes) ? [...manifest.nodes] : [];
      const orderedNodes = nodes.sort((a, b) => Number(a?.order_index ?? 0) - Number(b?.order_index ?? 0));
      const currentNode = this.currentNode || this.resolveCurrentNode(manifest);
      const currentOrder = Number(this.session?.progress?.order_index ?? currentNode?.order_index ?? 0);

      if (!orderedNodes.length) {
        return '<div class="mcol"><span class="mdot current">1</span></div>';
      }

      return orderedNodes.map((node, index) => {
        const order = Number(node?.order_index ?? index);
        const isGame = node?.type === 'game';
        const isCurrent = order === currentOrder;
        const isDone = order < currentOrder;
        const dotClass = [
          'mdot',
          isCurrent ? 'current' : '',
          isDone ? 'done' : '',
          isGame ? 'game' : 'normal'
        ].filter(Boolean).join(' ');
        const content = isGame
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 12h4m-2-2v4"/><path d="M15 11v.01"/><path d="M18 13v.01"/></svg>'
          : String(order + 1);
        const connector = index < orderedNodes.length - 1
          ? `<span class="mconn${order < currentOrder ? ' on' : ''}"></span>`
          : '';
        return `<div class="mcol"><span class="${dotClass}">${content}</span>${connector}</div>`;
      }).join('');
    }

    renderV2Shell({ title, sector = 'CX', subtitle = '', extraStat = null } = {}) {
      const sectorHtml = sector ? ` <span class="c">${escapeHtml(sector)}</span>` : '';
      const extra = extraStat
        ? `<div class="stat-box tries"><div class="stat-label">${escapeHtml(extraStat.label)}</div><div class="stat-value">${escapeHtml(extraStat.value)}</div></div>`
        : '';
      return `
        <div class="stats-strip">
          <span class="badge">INTERMISSION GAME</span>
          <div class="stats-right">
            <button id="intermission-fullscreen-btn" class="fs-btn intermission-fullscreen-btn" onclick="window.IntermissionGameRuntime?.toggleFullscreen?.()" aria-label="Alternar tela cheia" title="Tela cheia (F11)">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
            </button>
            <div class="stat-box intermission-time-display" id="intermission-time-display" role="timer" aria-label="Tempo decorrido"><div class="stat-label time-label">TEMPO</div><div class="stat-value time-value" id="time-value" aria-live="polite">00:00</div></div>
            <div class="stat-box intermission-score-display" id="intermission-score-display" role="status" aria-label="Pontuacao atual"><div class="stat-label score-label">PONTUACAO</div><div class="stat-value score-value" id="score-value" aria-live="polite">0</div></div>
            ${extra}
          </div>
        </div>
        <h1 class="title">${escapeHtml(title)}${sectorHtml}</h1>
        ${subtitle ? `<p class="subtitle">${escapeHtml(subtitle)}<span class="sub-underline"></span></p>` : ''}
        <div class="rule"></div>
      `;
    }

    v2Sector() {
      return String(this.theme?.type || 'cx').toUpperCase();
    }

    renderTermoKeyboard() {
      const rows = [
        ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
        ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
        ['⌫', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', 'ENTER']
      ];

      return rows.map(row => `
        <div class="krow">
          ${row.map(key => `<span class="key${key === '⌫' || key === 'ENTER' ? ' act' : ''}">${escapeHtml(key)}</span>`).join('')}
        </div>
      `).join('');
    }

    renderTermoV2({
      board,
      currentAttempt,
      currentHintMessage,
      hintDisabled,
      maxHints,
      message,
      rows,
      showHintAction,
      submitting,
      termoCompleted,
      wordLength
    }) {
      const hintText = currentHintMessage || message || 'Pense em valores, comportamentos e momentos que encantam.';
      const hintButton = showHintAction
        ? `
          <button
            class="btn-dica"
            id="intermission-hint-btn"
            aria-label="Solicitar dica do Termo"
            ${hintDisabled ? 'disabled' : ''}
          >
            ${submitting ? 'PROCESSANDO...' : 'DICA RAPIDA'}
          </button>
        `
        : '<span class="btn-dica is-disabled">SEM DICAS</span>';

      return `
        <div class="intermission-v2-termo-shell intermission-v2-shell intermission-termo-layout intermission-game-layout ig-fade-in">
          <div class="stats-strip">
            <span class="badge">INTERMISSION GAME</span>
            <div class="stats-right">
              <button
                id="intermission-fullscreen-btn"
                class="fs-btn intermission-fullscreen-btn"
                onclick="window.IntermissionGameRuntime?.toggleFullscreen?.()"
                aria-label="Alternar tela cheia"
                title="Tela cheia (F11)"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
                </svg>
              </button>
              <div class="stat-box intermission-time-display" id="intermission-time-display" role="timer" aria-label="Tempo decorrido">
                <div class="stat-label time-label">TEMPO</div>
                <div class="stat-value time-value" id="time-value" aria-live="polite">00:00</div>
              </div>
              <div class="stat-box intermission-score-display" id="intermission-score-display" role="status" aria-label="Pontuacao atual">
                <div class="stat-label score-label">PONTUACAO</div>
                <div class="stat-value score-value" id="score-value" aria-live="polite">0</div>
                <div class="score-max">de 200 pts</div>
              </div>
              <div class="stat-box tries">
                <div class="stat-label">TENTATIVAS</div>
                <div class="stat-value">${Math.max(0, currentAttempt - 1)}/${rows}</div>
              </div>
            </div>
          </div>

          <h1 class="title"><span class="k">TERMO</span> <span class="c">DE CX</span></h1>
          <p class="subtitle">Descubra a palavra secreta relacionada a Experiencia do Cliente.<span class="sub-underline"></span></p>
          <div class="rule"></div>

          <div class="play">
            <div class="aside-left">A palavra tem <b>${wordLength} letras.</b><div class="arrow">↗</div></div>
            <div class="intermission-termo-board board" role="region" aria-label="Tabuleiro de tentativas">${board}</div>
            <div class="legend" aria-label="Legenda de feedback">
              <div class="leg"><span class="sw c"></span><span>Letra certa<br>na posicao certa</span></div>
              <div class="leg"><span class="sw p"></span><span>Letra certa<br>na posicao errada</span></div>
              <div class="leg"><span class="sw a"></span><span>Letra nao esta<br>na palavra</span></div>
            </div>
          </div>

          <div class="intermission-termo-input-panel">
            <div class="intermission-termo-input-container">
              <input id="intermission-termo-input" class="intermission-termo-input" maxlength="${wordLength}" autocomplete="off" inputmode="text" placeholder="DIGITE" aria-label="Digite sua tentativa de ${wordLength} letras" ${termoCompleted ? 'disabled' : ''}>
              <button id="intermission-termo-submit" class="ig-btn ig-btn--primary" aria-label="Enviar tentativa" ${submitting || termoCompleted ? 'disabled' : ''}>${submitting ? 'Enviando...' : 'Enviar'}</button>
            </div>
          </div>

          <div class="hintbar">
            <span class="bubble" aria-hidden="true">?</span>
            ${hintButton}
            <span class="hint-sep" aria-hidden="true"></span>
            <span class="hint-txt" role="status" aria-live="polite">${escapeHtml(hintText)}</span>
            <span class="hint-counter" aria-label="${Math.max(0, maxHints)} dicas disponiveis">${Math.max(0, maxHints)}</span>
          </div>
        </div>
      `;
    }

    showLoadingState() {
      const board = this.board();
      if (!board) return;

      board.innerHTML = `
        <div class="intermission-loading-state ig-fade-in">
          <div class="intermission-skeleton intermission-skeleton--heading"></div>
          <div class="intermission-skeleton intermission-skeleton--text"></div>
          <div class="intermission-skeleton intermission-skeleton--text medium"></div>
          <div class="intermission-skeleton intermission-skeleton--text short"></div>
          <div class="intermission-skeleton intermission-skeleton--card"></div>
          <div class="intermission-skeleton intermission-skeleton--card"></div>
        </div>
      `;
    }

    async hideLoadingState() {
      const board = this.board();
      if (!board) return;

      const loadingState = board.querySelector('.intermission-loading-state');
      if (loadingState) {
        loadingState.classList.remove('ig-fade-in');
        loadingState.classList.add('ig-fade-out');
        await delay(300);
      }
    }

    updateScoreDisplay(correct, total) {
      if (!this.scoreTracker) {
        return;
      }

      const scoreValueEl = qs('score-value');
      if (!scoreValueEl) {
        return;
      }

      const timeSpent = this.scoreTracker.getCurrentTime();
      const hintsUsed = this.scoreTracker.hintsUsed;

      const scoreData = this.scoreTracker.calculateScore(correct, total, timeSpent, hintsUsed);
      
      const currentDisplayed = parseInt(scoreValueEl.textContent) || 0;
      const targetScore = scoreData.finalScore;
      
      if (currentDisplayed !== targetScore) {
        this.animateScoreChange(currentDisplayed, targetScore);
      }
    }

    animateScoreChange(from, to) {
      const scoreValueEl = qs('score-value');
      if (!scoreValueEl) {
        return;
      }

      const duration = 400; // ms
      const steps = 20;
      const stepDuration = duration / steps;
      const increment = (to - from) / steps;
      
      let current = from;
      let step = 0;

      const animate = () => {
        if (step >= steps) {
          scoreValueEl.textContent = to;
          return;
        }

        current += increment;
        scoreValueEl.textContent = Math.round(current);
        step++;

        root.setTimeout(animate, stepDuration);
      };

      animate();
    }

    startTimeDisplay() {
      if (this.timeDisplayInterval) {
        root.clearInterval(this.timeDisplayInterval);
      }

      this.updateTimeDisplay();

      this.timeDisplayInterval = root.setInterval(() => {
        this.updateTimeDisplay();
      }, 1000);
    }

    stopTimeDisplay() {
      if (this.timeDisplayInterval) {
        root.clearInterval(this.timeDisplayInterval);
        this.timeDisplayInterval = null;
      }
    }

    updateTimeDisplay() {
      if (!this.scoreTracker) {
        return;
      }

      const timeValueEl = qs('time-value');
      if (!timeValueEl) {
        return;
      }

      const timeInSeconds = this.scoreTracker.getCurrentTime();

      const minutes = Math.floor(timeInSeconds / 60);
      const seconds = timeInSeconds % 60;
      const formattedTime = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

      timeValueEl.textContent = formattedTime;
    }

    renderHintPanel(hintSystem, currentHintMessage = '') {
      if (!hintSystem) {
        return '';
      }

      const status = hintSystem.getHintStatus();
      const cost = status.nextCost;
      
      const showHintAction = status.hasAvailable;
      const buttonText = cost === 0
        ? 'Usar dica gratis'
        : `Usar dica (-${cost} XP)`;

      const disabledReason = showHintAction && status.isDisabled && status.disabledReason
        ? `<div class="hint-disabled-reason">${escapeHtml(status.disabledReason)}</div>`
        : '';
      const hintButtonHtml = showHintAction
        ? `
          <button
            class="hint-btn"
            id="intermission-hint-btn"
            aria-label="${cost === 0 ? 'Usar dica gratis' : `Usar dica, custo ${cost} XP`}"
            ${status.isDisabled ? 'disabled' : ''}
          >
            ${escapeHtml(buttonText)}
          </button>
        `
        : '';

      const hintMessageHtml = currentHintMessage 
        ? `<div class="hint-message" role="status" aria-live="polite">${escapeHtml(currentHintMessage)}</div>`
        : '';

      return `
        <div class="hint-panel" role="complementary" aria-label="Painel de dicas">
          <div class="hint-header">
            <span class="hint-title">Dicas disponiveis</span>
            <span class="hint-counter" aria-label="${status.hintsUsed} dicas usadas de ${status.maxHints} disponiveis">${status.hintsUsed}/${status.maxHints}</span>
          </div>
          ${hintButtonHtml}
          ${disabledReason}
          ${hintMessageHtml}
        </div>
      `;
    }

    async renderQuemDisse(config) {
      this.showLoadingState();
      await delay(100); // Curto atraso para mostrar o estado de carregamento

      const users = getUsersData();
      const userXP = users[this.loggedInUser]?.xp || 0;
      const hintSystem = root.HintSystem ? new root.HintSystem('quem-disse-cx', userXP) : null;
      let currentHintMessage = '';
      let eliminatedOptions = [];

      let index = 0;
      const answers = [];
      let isFirstRender = true;
      
      const draw = async (feedback = '') => {
        const question = config.questions[index];
        
        const hintPanelHtml = hintSystem ? this.renderHintPanel(hintSystem, currentHintMessage) : '';

        if (isFirstRender) {
          await this.hideLoadingState();
          isFirstRender = false;
        }

        const _ch = String(question.channel || '').toLowerCase();
        const _chMeta = _ch.includes('whats') ? { k: 'whatsapp', n: 'WhatsApp', i: '💬' }
          : _ch.includes('mail') ? { k: 'email', n: 'E-mail', i: '✉️' }
          : (_ch.includes('telef') || _ch.includes('liga') || _ch.includes('call')) ? { k: 'telefone', n: 'Telefone', i: '☎️' }
          : (_ch.includes('rede') || _ch.includes('social') || _ch.includes('insta')) ? { k: 'social', n: question.channel || 'Redes Sociais', i: '📱' }
          : (_ch.includes('reuni') || _ch.includes('1:1') || _ch.includes('pesquis') || _ch.includes('clima') || _ch.includes('interno')) ? { k: 'interno', n: question.channel || 'Canal interno', i: '🏢' }
          : { k: 'chat', n: question.channel || 'Chat ao vivo', i: '💬' };

        this.root.querySelector('.intermission-play-header')?.remove();
        this.root.querySelector('.intermission-game-footer')?.remove();
        this.board().innerHTML = `
          <div class="intermission-v2-shell intermission-quem-disse-container intermission-game-layout ig-fade-in">
            ${this.renderV2Shell({ title: 'QUEM DISSE?', sector: this.v2Sector(), subtitle: 'Identifique o perfil por tras da fala.', extraStat: { label: 'FRASE', value: `${index + 1}/${config.questions.length}` } })}
            ${hintPanelHtml}
            <div class="qd-chat" data-channel="${_chMeta.k}" role="region" aria-label="Mensagem para identificar">
              <div class="qd-chat-head"><span class="ch-dot"></span><span class="ch-name">${escapeHtml(_chMeta.n)}</span><span class="ch-icon" aria-hidden="true">${_chMeta.i}</span></div>
              <div class="qd-chat-body">
                <span class="qd-meta">Frase ${index + 1} de ${config.questions.length} · quem disse?</span>
                <div class="qd-msg"><span class="qd-avatar" aria-hidden="true">?</span><div class="qd-bubble">${escapeHtml(question.quote)}</div></div>
              </div>
            </div>
            <div class="intermission-profile-grid" role="group" aria-label="Opções de resposta">
              ${Object.entries(config.profiles).map(([key, profile]) => {
                const isEliminated = eliminatedOptions.includes(key);
                const eliminatedClass = isEliminated ? ' intermission-profile-btn--eliminated' : '';
                return `<button class="intermission-profile-btn${eliminatedClass}" data-profile="${escapeHtml(key)}" aria-label="Selecionar ${escapeHtml(profile.label)}" ${isEliminated ? 'disabled aria-disabled="true"' : ''}>${escapeHtml(profile.label)}</button>`;
              }).join('')}
            </div>
            ${feedback ? `<div class="intermission-quem-disse-explanation" role="status" aria-live="polite"><p>${escapeHtml(feedback)}</p></div>` : ''}
          </div>
        `;
        this.board().querySelectorAll('.intermission-profile-btn').forEach(button => {
          button.addEventListener('click', () => {
            const selected = button.dataset.profile;
            answers[index] = selected;
            const correct = selected === question.correct;
            this.board().querySelectorAll('.intermission-profile-btn').forEach(btn => {
              btn.disabled = true;
              if (btn.dataset.profile === question.correct) btn.classList.add('correct');
              if (btn === button && !correct) btn.classList.add('wrong');
            });
            
            const correctCount = answers.filter((ans, i) => ans === config.questions[i].correct).length;
            this.updateScoreDisplay(correctCount, config.questions.length);
            
            root.setTimeout(async () => {
              if (index >= config.questions.length - 1) {
                this.completeGame({ answers }, { attempts_used: answers.length });
              } else {
                this.board().classList.add('ig-fade-out');
                await delay(300);

                index++;
                currentHintMessage = '';
                eliminatedOptions = [];

                this.board().classList.remove('ig-fade-out');
                await draw(question.explanation);

                this.board().classList.add('ig-fade-in');
              }
            }, 850);
          });
        });
        qs('intermission-hint-btn')?.addEventListener('click', async () => {
          if (!hintSystem) return;

          const hintResult = hintSystem.useHint({
            currentQuestion: {
              ...question,
              options: Object.keys(config.profiles || {}),
              profiles: config.profiles || {}
            },
            eliminatedOptions
          });

          if (hintResult.success) {
            currentHintMessage = hintResult.hint.message;
            if (hintResult.hint.eliminatedOption && !eliminatedOptions.includes(hintResult.hint.eliminatedOption)) {
              eliminatedOptions.push(hintResult.hint.eliminatedOption);
            }

            const users = getUsersData();
            if (users[this.loggedInUser]) {
              users[this.loggedInUser].xp = hintResult.remainingXP;
              saveUsersData(users);

              const xpCount = qs('xp-count');
              if (xpCount) xpCount.textContent = hintResult.remainingXP;
            }

            if (this.scoreTracker) {
              this.scoreTracker.hintsUsed = hintSystem.hintsUsed;
              const correctCount = answers.filter((ans, i) => ans === config.questions[i].correct).length;
              this.updateScoreDisplay(correctCount, config.questions.length);
            }

            await draw(currentHintMessage);
          } else {
            currentHintMessage = hintResult.error || 'Nao foi possivel usar a dica.';
            await draw(currentHintMessage);
          }
        });
      };
      await draw();
    }

    async renderSequencia(config) {
      this.showLoadingState();
      await delay(100); // Curto atraso para mostrar o estado de carregamento
      
      const users = getUsersData();
      const userXP = users[this.loggedInUser]?.xp || 0;
      const hintSystem = root.HintSystem ? new root.HintSystem('sequencia-cx', userXP) : null;
      let currentHintMessage = '';
      let revealedStepId = null; // Rastreia qual etapa foi revelada por dica

      let index = 0;
      const submissions = [];
      let isFirstRender = true; // Rastreia se esta é a primeira renderização
      
      const draw = async () => {
        const seq = config.sequences[index];
        let order = [];
        let pool = shuffle(seq.steps, `${this.sessionId}-${seq.id}`);
        let draggingStepId = null;
        let draggingFromSlot = -1;
        const redraw = async () => {
          const hintPanelHtml = hintSystem ? this.renderHintPanel(hintSystem, currentHintMessage) : '';

          if (isFirstRender) {
            await this.hideLoadingState();
            isFirstRender = false;
          }

          this.root.querySelector('.intermission-play-header')?.remove();
          this.root.querySelector('.intermission-game-footer')?.remove();
          this.board().innerHTML = `
            <div class="intermission-v2-shell intermission-seq-layout intermission-game-layout ig-stack-lg ig-fade-in">
              ${this.renderV2Shell({ title: 'SEQUENCIA', sector: this.v2Sector(), subtitle: 'Ordene as etapas do atendimento.' })}
              ${hintPanelHtml ? `<div class="intermission-seq-hint">${hintPanelHtml}</div>` : ''}
              <div class="intermission-seq-brief ig-panel-lg" role="region" aria-label="Informacoes da sequencia">
                <div class="intermission-seq-kicker ig-row-between">
                  <span>Sequencia ${index + 1} de ${config.sequences.length}</span>
                  <span>${seq.steps.length} etapas</span>
                </div>
                <h3 class="intermission-seq-title ig-heading-bold">${escapeHtml(seq.title)}</h3>
                ${seq.context ? `<p class="intermission-seq-context ig-body">${escapeHtml(seq.context)}</p>` : ''}
              </div>

              <div class="intermission-seq-board">
                <div class="intermission-seq-section ig-panel" role="region" aria-label="Ordem correta das etapas">
                  <div class="intermission-seq-label">Ordem correta</div>
                  <div class="intermission-seq-slots" role="list" aria-label="Slots para ordenacao">
                    ${seq.steps.map((_, slotIndex) => {
                      const hasStep = order[slotIndex];
                      const slotClass = hasStep ? ' intermission-seq-slot--filled' : '';
                      return `<div class="intermission-seq-slot ig-card${slotClass}" data-slot-index="${slotIndex}"${hasStep ? ' draggable="true"' : ''} role="listitem" aria-label="Posicao ${slotIndex + 1}: ${hasStep ? escapeHtml(order[slotIndex].text) : 'vazio'}">${escapeHtml(order[slotIndex]?.text || `Etapa ${slotIndex + 1}`)}</div>`;
                    }).join('')}
                  </div>
                </div>

                <div class="intermission-seq-section ig-panel" role="region" aria-label="Etapas disponiveis para selecao">
                  <div class="intermission-seq-label">Etapas disponiveis</div>
                  <div class="intermission-seq-pool" role="group" aria-label="Etapas para ordenar">
                    ${pool.map(step => {
                      const isRevealed = revealedStepId === step.id;
                      const revealedClass = isRevealed ? ' intermission-seq-step--revealed' : '';
                      return `<button class="intermission-seq-step ig-card${revealedClass}" draggable="true" data-step="${escapeHtml(step.id)}" aria-label="Adicionar etapa: ${escapeHtml(step.text)}">${escapeHtml(step.text)}</button>`;
                    }).join('')}
                  </div>
                </div>
              </div>

              <div class="intermission-seq-actions ig-row">
                <button class="ig-btn ig-btn--ghost" id="intermission-seq-clear" aria-label="Limpar todas as etapas selecionadas">Limpar</button>
                <button class="ig-btn ig-btn--primary" id="intermission-seq-submit" aria-label="Confirmar ordem das etapas" ${order.length < seq.steps.length ? 'disabled aria-disabled="true"' : ''}>Confirmar Ordem</button>
              </div>
            </div>
          `;

          this.board().querySelectorAll('.intermission-seq-step').forEach(button => {
            button.addEventListener('click', () => {
              const step = pool.find(item => item.id === button.dataset.step);
              if (!step) return;
              order.push(step);
              pool = pool.filter(item => item.id !== step.id);
              if (revealedStepId === step.id) revealedStepId = null;
              redraw();
            });
            button.addEventListener('dragstart', (e) => {
              draggingStepId = button.dataset.step;
              draggingFromSlot = -1;
              button.classList.add('dragging');
              e.dataTransfer.effectAllowed = 'move';
            });
            button.addEventListener('dragend', () => button.classList.remove('dragging'));
          });

          this.board().querySelectorAll('.intermission-seq-slot').forEach((slot, slotIdx) => {
            if (order[slotIdx]) {
              slot.addEventListener('dragstart', (e) => {
                draggingStepId = order[slotIdx].id;
                draggingFromSlot = slotIdx;
                slot.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
              });
              slot.addEventListener('dragend', () => slot.classList.remove('dragging'));
              slot.addEventListener('click', () => {
                const step = order[slotIdx];
                if (!step) return;
                order.splice(slotIdx, 1);
                pool = [...pool, step];
                redraw();
              });
            }
            slot.addEventListener('dragover', (e) => {
              e.preventDefault();
              slot.classList.add('drag-over');
            });
            slot.addEventListener('dragleave', () => slot.classList.remove('drag-over'));
            slot.addEventListener('drop', (e) => {
              e.preventDefault();
              slot.classList.remove('drag-over');
              if (!draggingStepId) return;
              const step = [...pool, ...order].find(s => s.id === draggingStepId);
              if (!step) return;
              if (draggingFromSlot >= 0) {
                order.splice(draggingFromSlot, 1);
              } else {
                pool = pool.filter(s => s.id !== step.id);
              }
              order.splice(slotIdx, 0, step);
              if (order.length > seq.steps.length) {
                const extra = order.splice(seq.steps.length);
                pool = [...pool, ...extra];
              }
              if (revealedStepId === step.id) revealedStepId = null;
              draggingStepId = null;
              draggingFromSlot = -1;
              redraw();
            });
          });

          const poolArea = this.board().querySelector('.intermission-seq-pool');
          if (poolArea) {
            poolArea.addEventListener('dragover', (e) => {
              if (draggingFromSlot >= 0) { e.preventDefault(); poolArea.classList.add('drag-over'); }
            });
            poolArea.addEventListener('dragleave', () => poolArea.classList.remove('drag-over'));
            poolArea.addEventListener('drop', (e) => {
              e.preventDefault();
              poolArea.classList.remove('drag-over');
              if (draggingFromSlot < 0 || !draggingStepId) return;
              const step = order[draggingFromSlot];
              if (!step) return;
              order.splice(draggingFromSlot, 1);
              pool = [...pool, step];
              draggingStepId = null;
              draggingFromSlot = -1;
              redraw();
            });
          }

          qs('intermission-seq-clear')?.addEventListener('click', () => {
            pool = shuffle(seq.steps, `${this.sessionId}-${seq.id}`);
            order = [];
            revealedStepId = null;
            currentHintMessage = '';
            redraw();
          });

          qs('intermission-seq-submit')?.addEventListener('click', async () => {
            submissions[index] = order.map(step => step.id);

            const correctSequence = seq.steps.map(s => s.id);
            const isCorrect = JSON.stringify(submissions[index]) === JSON.stringify(correctSequence);
            
            const correctCount = submissions.filter((sub, i) => {
              const correctSeq = config.sequences[i].steps.map(s => s.id);
              return JSON.stringify(sub) === JSON.stringify(correctSeq);
            }).length;
            this.updateScoreDisplay(correctCount, config.sequences.length);
            
            if (index >= config.sequences.length - 1) {
              this.completeGame({ sequences: submissions }, { rounds_played: submissions.length });
            } else {
              this.board().classList.add('ig-fade-out');
              await delay(300);

              index++;
              currentHintMessage = '';
              revealedStepId = null;

              this.board().classList.remove('ig-fade-out');
              draw();

              this.board().classList.add('ig-fade-in');
            }
          });

          const hintBtn = qs('intermission-hint-btn');
          if (hintBtn && hintSystem) {
            hintBtn.addEventListener('click', () => {
              const gameState = {
                correctSequence: seq.steps,
                userOrder: order
              };

              const hintResult = hintSystem.useHint(gameState);

              if (hintResult.success) {
                currentHintMessage = hintResult.hint.message;

                revealedStepId = hintResult.hint.stepId;

                const users = getUsersData();
                if (users[this.loggedInUser]) {
                  users[this.loggedInUser].xp = hintResult.remainingXP;
                  saveUsersData(users);
                  
                  const xpCount = qs('xp-count');
                  if (xpCount) xpCount.textContent = hintResult.remainingXP;
                }

                if (this.scoreTracker) {
                  this.scoreTracker.hintsUsed = hintSystem.hintsUsed;
                  const correctCount = submissions.filter((sub, i) => {
                    const correctSeq = config.sequences[i].steps.map(s => s.id);
                    return JSON.stringify(sub) === JSON.stringify(correctSeq);
                  }).length;
                  this.updateScoreDisplay(correctCount, config.sequences.length);
                }

                redraw();
              } else {
                currentHintMessage = hintResult.error || 'Não foi possível usar a dica';
                redraw();
              }
            });
          }
        };
        await redraw();
      };
      await draw();
    }

    async renderConexo(config) {
      this.showLoadingState();
      await delay(100); // Curto atraso para mostrar o estado de carregamento

      const CONEXO_COLORS = ['#F5C518', '#22c55e', '#3B82F6', '#8B5CF6'];

      const users = getUsersData();
      const userXP = users[this.loggedInUser]?.xp || 0;
      const hintSystem = root.HintSystem ? new root.HintSystem('conexo-cx', userXP) : null;
      let currentHintMessage = '';
      let revealedWords = [];

      const allWords = config.categories.flatMap(category => category.words);
      let remaining = shuffle(allWords, this.sessionId);
      let selected = [];
      let solvedGroups = [];
      let mistakes = 0;
      const maxMistakes = config.max_mistakes || 4;
      const categoryFor = word => config.categories.find(category => category.words.includes(word));
      let isFirstRender = true; // Rastreia se esta é a primeira renderização
      
      const draw = async (message = '') => {
        const hintPanelHtml = hintSystem ? this.renderHintPanel(hintSystem, currentHintMessage) : '';

        if (isFirstRender) {
          await this.hideLoadingState();
          isFirstRender = false;
        }

        this.root.querySelector('.intermission-play-header')?.remove();
        this.root.querySelector('.intermission-game-footer')?.remove();
        this.board().innerHTML = `
          <div class="intermission-v2-shell intermission-conexo-layout intermission-game-layout ig-stack-lg ig-fade-in">
            ${this.renderV2Shell({ title: 'CONEXO', sector: this.v2Sector(), subtitle: 'Agrupe as palavras nas categorias certas.' })}
            ${hintPanelHtml}
            <div class="ig-panel-lg" role="region" aria-label="Informações do jogo Conexo">
              <div class="ig-row-between" style="margin-bottom: var(--space-3);">
                <span class="ig-text-muted" style="font-size: var(--text-sm); font-family: var(--font-heading); font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase;">Conexo CX</span>
                <span class="intermission-conexo-lives" aria-label="${mistakes} erros de ${maxMistakes} permitidos">${Array.from({length: maxMistakes}, (_, i) => `<span class="intermission-conexo-life${i < mistakes ? ' intermission-conexo-life--lost' : ''}"></span>`).join('')}</span>
              </div>
              <h3 class="ig-heading-bold" style="font-size: var(--text-2xl); color: var(--ig-text-primary); margin-bottom: var(--space-2);">Agrupe as palavras por categoria</h3>
              <p class="ig-body" style="font-size: var(--text-base); color: var(--ig-text-secondary); line-height: 1.6;">Selecione 4 palavras que pertencem ao mesmo grupo</p>
              ${message ? `<p class="ig-body" style="font-size: var(--text-sm); color: var(--intermission-game-color, #D85A30); margin-top: var(--space-2);" role="status" aria-live="polite">${escapeHtml(message)}</p>` : ''}
            </div>
            
            ${solvedGroups.map(group => `
              <div class="intermission-conexo-solved-group" data-color="${group.colorIndex}" role="status" aria-label="Grupo resolvido: ${escapeHtml(group.label)}">
                <strong>${escapeHtml(group.label)}</strong>
                <p>${escapeHtml(group.words.join(' / '))}</p>
              </div>
            `).join('')}
            
            <div class="intermission-conexo-grid" role="group" aria-label="Grade de palavras para agrupar">
              ${remaining.map(word => {
                const isRevealed = revealedWords.includes(word);
                const revealedClass = isRevealed ? ' intermission-tile-btn--revealed' : '';
                const isSelected = selected.includes(word);
                return `<button class="intermission-tile-btn${revealedClass} ${isSelected ? 'selected' : ''}" data-word="${escapeHtml(word)}" aria-label="${isSelected ? 'Desselecionar' : 'Selecionar'} palavra ${escapeHtml(word)}" aria-pressed="${isSelected}">${escapeHtml(word)}</button>`;
              }).join('')}
            </div>
            
            <div class="intermission-conexo-actions">
              <button class="ig-btn ig-btn--ghost" id="intermission-conexo-shuffle" aria-label="Embaralhar palavras na grade">Embaralhar</button>
              <button class="ig-btn ig-btn--primary" id="intermission-conexo-submit" aria-label="Agrupar ${selected.length} palavras selecionadas" ${selected.length !== 4 ? 'disabled aria-disabled="true"' : ''}>Agrupar (${selected.length}/4)</button>
            </div>
          </div>
        `;
        this.board().querySelectorAll('.intermission-tile-btn').forEach(button => {
          button.addEventListener('click', () => {
            const word = button.dataset.word;
            selected = selected.includes(word)
              ? selected.filter(item => item !== word)
              : selected.length < 4 ? [...selected, word] : selected;
            draw(message);
          });
        });
        qs('intermission-conexo-shuffle')?.addEventListener('click', () => {
          remaining = shuffle(remaining, `${Date.now()}`);
          draw(message);
        });
        qs('intermission-conexo-submit')?.addEventListener('click', () => {
          const categories = selected.map(categoryFor);
          const first = categories[0];
          const ok = first && categories.every(category => category?.id === first.id);
          if (ok) {
            solvedGroups.push({ label: first.label || first.name, words: [...selected], colorIndex: solvedGroups.length });
            remaining = remaining.filter(word => !selected.includes(word));
            selected = [];
            revealedWords = revealedWords.filter(word => remaining.includes(word));
            
            this.updateScoreDisplay(solvedGroups.length, config.categories.length);
            
            if (remaining.length === 0) return this.completeGame({ groups: solvedGroups, mistakes }, { groups_found: solvedGroups.length, mistakes });
            draw('Grupo correto. Continue...');
          } else {
            mistakes++;
            selected = [];
            if (mistakes >= maxMistakes) return this.completeGame({ groups: solvedGroups, mistakes }, { groups_found: solvedGroups.length, mistakes });
            draw('Ainda nao e esse grupo. Tente novamente.');
          }
        });

        const hintBtn = qs('intermission-hint-btn');
        if (hintBtn && hintSystem) {
          hintBtn.addEventListener('click', () => {
            const gameState = {
              categories: config.categories,
              solvedGroups: solvedGroups,
              remaining: remaining
            };

            const hintResult = hintSystem.useHint(gameState);

            if (hintResult.success) {
              currentHintMessage = hintResult.hint.message;

              if (hintResult.hint.word && !revealedWords.includes(hintResult.hint.word)) {
                revealedWords.push(hintResult.hint.word);
              }

              const users = getUsersData();
              if (users[this.loggedInUser]) {
                users[this.loggedInUser].xp = hintResult.remainingXP;
                saveUsersData(users);
                
                const xpCount = qs('xp-count');
                if (xpCount) xpCount.textContent = hintResult.remainingXP;
              }

              if (this.scoreTracker) {
                this.scoreTracker.hintsUsed = hintSystem.hintsUsed;
                this.updateScoreDisplay(solvedGroups.length, config.categories.length);
              }

              draw(message);
            } else {
              currentHintMessage = hintResult.error || 'Não foi possível usar a dica';
              draw(message);
            }
          });
        }
      };
      await draw();
    }

    async renderTermo(config) {
      this.showLoadingState();
      await delay(100); // Curto atraso para mostrar o estado de carregamento
      
      let currentHintMessage = '';
      let termoState = null;
      let submitting = false;
      let finalizationQueued = false;
      let isFirstRender = true; // Rastreia se esta é a primeira renderização

      const syncTermoState = (nextState = {}) => {
        const wordLength = Number(nextState.word_length || config.word_length || 5);
        const maxAttempts = Number(nextState.max_attempts || config.max_attempts || 6);
        const maxHints = Number(nextState.max_hints || 3);
        termoState = {
          word_length: wordLength,
          max_attempts: maxAttempts,
          max_hints: maxHints,
          hints_used: Number(nextState.hints_used || 0),
          revealed_positions: Array.isArray(nextState.revealed_positions) ? nextState.revealed_positions : [],
          revealed_letters: Array.isArray(nextState.revealed_letters) ? nextState.revealed_letters : [],
          guesses: Array.isArray(nextState.guesses) ? nextState.guesses : [],
          completed: Boolean(nextState.completed),
          outcome: nextState.outcome || null,
          final_answer: nextState.final_answer || null,
          attempts_used: Number(nextState.attempts_used || (Array.isArray(nextState.guesses) ? nextState.guesses.length : 0))
        };
        this.session.termo_state = termoState;
        return termoState;
      };

      const getLocalSummary = () => ({
        attempts_used: Number(termoState?.attempts_used || 0),
        total_attempts: Number(termoState?.max_attempts || config.max_attempts || 6),
        revealed_answer: termoState?.final_answer || '',
        outcome: termoState?.outcome || 'miss'
      });

      const renderHintPanel = () => {
        const hintsUsed = Number(termoState?.hints_used || 0);
        const maxHints = Number(termoState?.max_hints || 0);
        const hintsLeft = Math.max(0, maxHints - hintsUsed);
        const showHintAction = hintsLeft > 0;
        const hintDisabled = submitting || Boolean(termoState?.completed);
        const revealedLetters = Array.isArray(termoState?.revealed_letters) ? termoState.revealed_letters : [];
        const revealedHtml = revealedLetters.length
          ? `
            <div class="hint-message" role="status" aria-live="polite">
              ${revealedLetters.map(entry => `Letra ${Number(entry.position) + 1}: ${escapeHtml(entry.letter)}`).join(' | ')}
            </div>
          `
          : '';

        return `
          <div class="hint-panel" role="complementary" aria-label="Painel de dicas">
            <div class="hint-header">
              <span class="hint-title">Dicas do servidor</span>
              <span class="hint-counter" aria-label="${hintsUsed} dicas usadas de ${maxHints} disponiveis">${hintsUsed}/${maxHints}</span>
            </div>
            ${showHintAction ? `
              <button
                class="hint-btn"
                id="intermission-hint-btn"
                aria-label="Solicitar dica do Termo"
                ${hintDisabled ? 'disabled' : ''}
              >
                ${submitting ? 'Processando...' : 'Pedir dica'}
              </button>
            ` : ''}
            ${currentHintMessage ? `<div class="hint-message" role="status" aria-live="polite">${escapeHtml(currentHintMessage)}</div>` : ''}
            ${revealedHtml}
          </div>
        `;
      };

      const queueCompletion = async () => {
        if (finalizationQueued || this.completed || !termoState?.completed) {
          return;
        }
        finalizationQueued = true;
        await delay(250);
        return this.completeGame(
          { guesses: (termoState.guesses || []).map(entry => entry.word) },
          getLocalSummary()
        );
      };

      syncTermoState(this.session?.termo_state || {});

      const draw = async (message = '') => {
        const rows = Number(termoState?.max_attempts || config.max_attempts || 6);
        const wordLength = Number(termoState?.word_length || config.word_length || 5);
        const guesses = Array.isArray(termoState?.guesses) ? termoState.guesses : [];
        const revealedMap = new Map(
          (Array.isArray(termoState?.revealed_letters) ? termoState.revealed_letters : [])
            .filter(entry => Number.isFinite(Number(entry?.position)) && entry?.letter)
            .map(entry => [Number(entry.position), String(entry.letter).toUpperCase()])
        );
        const hintPanelHtml = renderHintPanel();

        if (isFirstRender) {
          await this.hideLoadingState();
          isFirstRender = false;
        }

        const board = Array.from({ length: rows }, (_, rowIndex) => {
          const guessEntry = guesses[rowIndex] || null;
          const guessWord = guessEntry?.word || '';
          const feedback = Array.isArray(guessEntry?.feedback) ? guessEntry.feedback : [];
          const isCurrentRow = rowIndex === guesses.length && !termoState.completed;
          const cells = Array.from({ length: wordLength }, (_, col) => {
            const revealedLetter = isCurrentRow ? (revealedMap.get(col) || '') : '';
            const letter = guessWord[col] || revealedLetter || '';
            const stateClass = feedback[col] || '';
            const hintClass = !guessWord && revealedLetter ? ' intermission-termo-cell--hint' : '';
            return `<div class="intermission-termo-cell ${stateClass}${hintClass}">${escapeHtml(letter)}</div>`;
          }).join('');
          return `<div class="intermission-termo-row">${cells}</div>`;
        }).join('');
        const v2Board = Array.from({ length: rows }, (_, rowIndex) => {
          const guessEntry = guesses[rowIndex] || null;
          const guessWord = guessEntry?.word || '';
          const feedback = Array.isArray(guessEntry?.feedback) ? guessEntry.feedback : [];
          const isCurrentRow = rowIndex === guesses.length && !termoState.completed;
          const cells = Array.from({ length: wordLength }, (_, col) => {
            const revealedLetter = isCurrentRow ? (revealedMap.get(col) || '') : '';
            const letter = guessWord[col] || revealedLetter || '';
            const stateClass = feedback[col] || '';
            const hintClass = !guessWord && revealedLetter ? ' intermission-termo-cell--hint' : '';
            return `<div class="intermission-termo-cell cell ${stateClass}${hintClass}">${escapeHtml(letter)}</div>`;
          }).join('');
          return `
            <div class="intermission-v2-termo-row">
              <span class="rownum">${String(rowIndex + 1).padStart(2, '0')}</span>
              <div class="cells">${cells}</div>
            </div>
          `;
        }).join('');
        const hintsUsed = Number(termoState?.hints_used || 0);
        const maxHints = Number(termoState?.max_hints || 0);
        const hintsLeft = Math.max(0, maxHints - hintsUsed);
        const showHintAction = hintsLeft > 0;
        const hintDisabled = submitting || Boolean(termoState?.completed);

        this.board().innerHTML = `
          <div class="intermission-termo-layout intermission-game-layout ig-stack-lg ig-fade-in">
            ${hintPanelHtml}
            <div class="ig-panel-lg" role="region" aria-label="Informações do jogo Termo">
              <div class="ig-row-between" style="margin-bottom: var(--space-3);">
                <span class="ig-text-muted" style="font-size: var(--text-sm); font-family: var(--font-heading); font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase;">Tentativa ${Math.min(guesses.length + 1, rows)} de ${rows}</span>
                <span class="ig-text-muted" style="font-size: var(--text-xs); font-family: var(--font-body);">${wordLength} letras</span>
              </div>
              <h3 class="ig-heading-bold" style="font-size: var(--text-xl); color: var(--ig-text-primary); margin-bottom: var(--space-2);">Digite uma palavra do universo CX</h3>
              ${message ? `<p class="ig-body" style="font-size: var(--text-sm); color: var(--ig-text-secondary); line-height: 1.6;" role="status" aria-live="polite">${escapeHtml(message)}</p>` : ''}
            </div>
            
            <div class="intermission-termo-board" role="region" aria-label="Tabuleiro de tentativas">${board}</div>
            
            <div class="ig-panel" style="background: var(--ig-bg-tertiary);">
              <div class="intermission-termo-input-container">
                <input id="intermission-termo-input" class="intermission-termo-input" maxlength="${wordLength}" autocomplete="off" inputmode="text" placeholder="DIGITE" aria-label="Digite sua tentativa de ${wordLength} letras" ${termoState.completed ? 'disabled' : ''}>
                <button id="intermission-termo-submit" class="ig-btn ig-btn--primary" aria-label="Enviar tentativa" ${submitting || termoState.completed ? 'disabled' : ''}>${submitting ? 'Enviando...' : 'Enviar'}</button>
              </div>
            </div>
          </div>
        `;
        this.root.querySelector('.intermission-play-header')?.remove();
        this.root.querySelector('.intermission-game-footer')?.remove();
        this.board().innerHTML = this.renderTermoV2({
          board: v2Board,
          currentAttempt: Math.min(guesses.length + 1, rows),
          currentHintMessage,
          hintDisabled,
          maxHints,
          message,
          rows,
          showHintAction,
          submitting,
          termoCompleted: Boolean(termoState?.completed),
          wordLength
        });
        const input = qs('intermission-termo-input');
        input?.focus();
        input?.addEventListener('input', () => {
          input.value = input.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, wordLength);
        });
        input?.addEventListener('keydown', event => {
          if (event.key === 'Enter') qs('intermission-termo-submit')?.click();
        });
        qs('intermission-termo-submit')?.addEventListener('click', async () => {
          if (submitting || termoState.completed) return;
          const guess = input.value.toUpperCase();
          if (guess.length !== wordLength) {
            return draw(`Use exatamente ${wordLength} letras.`);
          }
          submitting = true;
          try {
            const data = await this.fetchJson(`${this.apiBase}/api/intermission/sessions/${encodeURIComponent(this.sessionId)}/guess`, {
              method: 'POST',
              body: JSON.stringify({ guess })
            });
            syncTermoState(data.termo_state || {});
            currentHintMessage = data.message || '';
            const attemptCount = Array.isArray(termoState.guesses) ? termoState.guesses.length : 0;
            const correctnessScore = termoState.outcome === 'hit'
              ? rows
              : Math.max(0, rows - attemptCount);
            this.updateScoreDisplay(correctnessScore, rows);
            await draw(currentHintMessage);
            if (termoState.completed) {
              return queueCompletion();
            }
          } catch (error) {
            await draw(error.message || 'Nao foi possivel registrar sua tentativa.');
          } finally {
            submitting = false;
            if (!termoState.completed) {
              const refreshedMessage = currentHintMessage;
              currentHintMessage = '';
              await draw(refreshedMessage);
            }
          }
        });

        qs('intermission-hint-btn')?.addEventListener('click', async () => {
          if (submitting || termoState.completed) return;
          submitting = true;
          try {
            const data = await this.fetchJson(`${this.apiBase}/api/intermission/sessions/${encodeURIComponent(this.sessionId)}/hint`, {
              method: 'POST',
              body: JSON.stringify({})
            });
            syncTermoState(data.termo_state || {});
            currentHintMessage = data.hint?.message || data.message || '';
            await draw(currentHintMessage);
          } catch (error) {
            await draw(error.message || 'Nao foi possivel carregar a dica.');
          } finally {
            submitting = false;
            if (!termoState.completed) {
              const refreshedMessage = currentHintMessage;
              currentHintMessage = '';
              await draw(refreshedMessage);
            }
          }
        });

        if (termoState.completed) {
          return queueCompletion();
        }
      };
      await draw();
    }

    showSavingModal() {
      // EC: sem modal/spinner — chip inline discreto (sobre o background).
      if (root.document.getElementById('intermission-saving-modal')) return;
      const chip = root.document.createElement('div');
      chip.id = 'intermission-saving-modal';
      chip.className = 'ig-saving-chip ig-fade-in';
      chip.setAttribute('role', 'status');
      chip.setAttribute('aria-live', 'polite');
      chip.textContent = 'Salvando progresso…';
      root.document.body.appendChild(chip);
    }

    hideSavingModal() {
      const modal = root.document.getElementById('intermission-saving-modal');
      if (modal) {
        modal.classList.add('ig-fade-out');
        root.setTimeout(() => modal.remove(), 300);
      }
    }

    async completeGame(result, localSummary = {}) {
      if (this.completed) return;
      this.completed = true;
      
      this.stopTimeDisplay();

      if (this.scoreTracker) {
        this.scoreTracker.stopTimer();
      }
      
      // Show saving modal BEFORE API call
      this.showSavingModal();

      try {
        const data = await this.fetchJson(`${this.apiBase}/api/intermission/sessions/${encodeURIComponent(this.sessionId)}/complete`, {
          method: 'POST',
          headers: { 'X-Idempotency-Key': `intermission-${this.sessionId}` },
          body: JSON.stringify({ result, idempotency_key: `intermission-${this.sessionId}` })
        });
        this.syncLocalProgress(data.progress);
        
        const flowChallengeId = resolveFlowChallengeId(this.session) || resolveFlowChallengeId(this.currentNode);
        if (this.progressBar && flowChallengeId) {
          this.progressBar.revealPhase(flowChallengeId);
        }
        
        if (root.AchievementNotifications?.check) {
          await Promise.race([
            root.AchievementNotifications.check(),
            new Promise(resolve => root.setTimeout(resolve, 1800))
          ]);
        }
        
        this.hideSavingModal();
        
        this.renderFinalResult(data);
      } catch (error) {
        console.error('[IntermissionGame] Completion failed:', error);
        
        this.hideSavingModal();
        
        this.renderFinalResult({
          success: false,
          score: { percent: 0, score: 0, max_score: 0 },
          xp_earned: 0,
          result_summary: { ...localSummary, outcome: localSummary.outcome || 'miss' },
          error: 'Erro ao salvar. Vamos seguir sem travar sua jornada.'
        });
      }
    }

    renderSavingResult(summary = {}) {
      this.root.innerHTML = `
        <section class="intermission-result-card intermission-result-card--saving">
          <div class="intermission-card-stripe"></div>
          <div class="intermission-result-icon">${escapeHtml(this.meta.letter)}</div>
          <h2>Resultado registrado</h2>
          <p>Salvando progresso...</p>
          ${this.renderResultDetails(summary)}
          <div class="intermission-saving-line">Salvando progresso...</div>
        </section>
      `;
    }

    ensurePhaseToken(target) {
      // A VPS e dona do fluxo e ja devolve o phase token no next_target.
      // Este metodo so e rede de seguranca para o fallback local: anexa o
      // phase_session_id quando o alvo e um desafio sem token e a sessao
      // pertence a uma phase session (ph_...). Nunca toca alvos de game_session_id.
      if (!target || typeof target !== 'string') return target;
      if ((!target.includes('challenge.html') && !target.includes('/challenge')) || target.includes('game_session_id')) return target;
      if (target.includes('phase_session_id=')) return target;
      const phaseSessionId = this.session?.progress?.manifest_id || this.session?.progress?.phase_session_id;
      if (typeof phaseSessionId !== 'string' || !phaseSessionId.startsWith('ph_')) return target;
      const separator = target.includes('?') ? '&' : '?';
      return `${target}${separator}phase_session_id=${encodeURIComponent(phaseSessionId)}`;
    }

    normalizeNavigationTarget(target) {
      if (!target || typeof target !== 'string') {
        return '/app';
      }

      const isFileMode = root.location?.protocol === 'file:';
      const fallback = isFileMode ? 'app.html' : '/app';

      try {
        const baseUrl = root.location?.href || 'https://www.expconnect.com.br/app';
        const parsed = new URL(target, baseUrl);
        const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
        const searchAndHash = `${parsed.search || ''}${parsed.hash || ''}`;

        const challengePath = pathname.endsWith('/challenge.html') || pathname.endsWith('/challenge');
        const appPath = pathname === '/'
          || pathname.endsWith('/home.html')
          || pathname.endsWith('/app.html')
          || pathname.endsWith('/home')
          || pathname.endsWith('/app');

        if (challengePath) {
          return isFileMode ? `challenge.html${searchAndHash}` : `/challenge${searchAndHash}`;
        }
        if (appPath) {
          return isFileMode ? `app.html${searchAndHash}` : `/app${searchAndHash}`;
        }
      } catch (error) {
        if (target.startsWith('challenge.html')) {
          return isFileMode ? target : `/${target.replace(/^challenge\.html/, 'challenge')}`;
        }
      }

      return fallback;
    }

    renderFinalResult(data) {
      this.stopTimeDisplay();

      const summary = data.result_summary || {};
      const nextTarget = this.normalizeNavigationTarget(
        this.ensurePhaseToken(data.navigation?.next_target || this.getNextTarget(data))
      );
      
      const percentage = data.score?.percent || 0;
      const finalScore = data.score?.score || 0;
      const maxScore = data.score?.max_score || 0;
      const xpEarned = Number(data.xp_earned || 0);
      
      let performanceBadge = this.meta?.letter || 'CX';
      let performanceTitle = 'Revise os Conceitos';
      let performanceColor = '#D85A30';
      
      if (percentage === 100) {
        performanceTitle = 'Perfeito!';
        performanceColor = '#B8481F'; // coral deep
      } else if (percentage >= 75) {
        performanceTitle = 'Quase la!';
        performanceColor = '#D85A30'; // coral
      } else if (percentage >= 50) {
        performanceTitle = 'Pode Melhorar';
        performanceColor = '#B8481F'; // coral deep
      }
      
      let baseScore = finalScore;
      let timeBonus = 0;
      let hintDeduction = 0;
      let hintsUsed = 0;
      
      if (this.scoreTracker) {
        const timeSpent = this.scoreTracker.getCurrentTime();
        hintsUsed = this.scoreTracker.hintsUsed;
        
        const breakdown = this.scoreTracker.getBreakdown();
        if (breakdown) {
          baseScore = breakdown.baseScore || 0;
          timeBonus = breakdown.timeBonus || 0;
          hintDeduction = breakdown.hintDeduction || 0;
        }
      }
      
      const explanation = this.getGameExplanation(this.meta.id, percentage);
      
      this.root.innerHTML = `
        <div class="intermission-result-screen" role="main" aria-label="Tela de resultados">
          <div class="result-card">
            <div class="result-emoji result-mark" aria-hidden="true">${escapeHtml(performanceBadge)}</div>
            <div class="result-title" style="color: ${performanceColor}">
              ${escapeHtml(performanceTitle)}
            </div>
            <div class="result-score" role="status" aria-label="Pontuação final: ${finalScore} de ${maxScore} pontos">
              ${finalScore}
              <span class="result-score-max">de ${maxScore} pts</span>
            </div>
            
            <!-- Progress bar -->
            <div class="result-progress-track" role="progressbar" aria-valuenow="${percentage}" aria-valuemin="0" aria-valuemax="100" aria-label="Aproveitamento de ${percentage} por cento">
              <div class="result-progress-fill" style="width: ${percentage}%; background: ${performanceColor}"></div>
            </div>
            <div class="result-percentage">${percentage}% de aproveitamento</div>
            
            <!-- Breakdown -->
            <div class="result-breakdown" role="region" aria-label="Detalhamento da pontuação">
              <div class="breakdown-row">
                <span>Pontuação base</span>
                <span>+${baseScore}</span>
              </div>
              ${timeBonus > 0 ? `
                <div class="breakdown-row success">
                  <span>Bonus de velocidade</span>
                  <span>+${timeBonus}</span>
                </div>
              ` : ''}
              ${hintsUsed > 0 ? `
                <div class="breakdown-row penalty">
                  <span>Dicas usadas (${hintsUsed})</span>
                  <span>-${hintDeduction}</span>
                </div>
              ` : ''}
              <div class="breakdown-row total">
                <span>XP ganho</span>
                <span>+${xpEarned} XP</span>
              </div>
            </div>
            
            <!-- Game-specific details -->
            ${this.renderResultDetails(summary)}
            
            <!-- Explanation -->
            ${explanation ? `
              <div class="result-explanation" role="region" aria-label="Aprendizado">
                <div class="explanation-label">APRENDIZADO</div>
                <div class="explanation-text">${escapeHtml(explanation)}</div>
              </div>
            ` : ''}
            
            <!-- Status message -->
            <div class="result-status" role="status" aria-live="polite">${data.error ? escapeHtml(data.error) : 'Progresso salvo!'}</div>
            
            <!-- Actions -->
            <button class="result-btn-primary" id="intermission-next-btn" aria-label="Continuar para próxima fase">
              CONTINUAR ->
            </button>
          </div>
        </div>
      `;
      
      qs('intermission-next-btn')?.addEventListener('click', () => {
        root.location.href = nextTarget;
      });
    }

    renderResultDetails(summary = {}) {
      if (!summary || Object.keys(summary).length === 0) {
        return '';
      }
      
      let detailsHtml = '<div class="result-game-details">';
      
      if (summary.revealed_answer) {
        const tiles = String(summary.revealed_answer).split('').map(letter => 
          `<span class="result-letter-tile">${escapeHtml(letter)}</span>`
        ).join('');
        detailsHtml += `
          <div class="result-detail-section">
            <div class="result-detail-label">Palavra Correta</div>
            <div class="result-reveal-tiles">${tiles}</div>
          </div>
        `;
      }
      
      if (summary.attempts_used !== undefined) {
        const total = summary.total_attempts || summary.total_questions || summary.attempts_used || 0;
        detailsHtml += `
          <div class="result-detail-row">
            <span>Tentativas usadas</span>
            <span>${Number(summary.attempts_used || 0)} / ${Number(total)}</span>
          </div>
        `;
      }
      
      if (summary.groups_found !== undefined) {
        detailsHtml += `
          <div class="result-detail-row">
            <span>Grupos encontrados</span>
            <span>${Number(summary.groups_found || 0)} / ${Number(summary.total_groups || 4)}</span>
          </div>
          <div class="result-detail-row">
            <span>Erros cometidos</span>
            <span>${Number(summary.mistakes || 0)}</span>
          </div>
        `;
      }
      
      if (summary.rounds_played !== undefined) {
        detailsHtml += `
          <div class="result-detail-row">
            <span>Rodadas jogadas</span>
            <span>${Number(summary.rounds_played || 0)} / ${Number(summary.total_rounds || summary.rounds_played || 0)}</span>
          </div>
        `;
      }
      
      detailsHtml += '</div>';
      return detailsHtml;
    }
    
    getGameExplanation(gameId, percentage) {
      const explanations = {
        'termo-cx': {
          high: 'Excelente! Você demonstrou ótimo vocabulário e raciocínio lógico. Continue praticando para manter suas habilidades afiadas.',
          medium: 'Bom trabalho! Para melhorar, tente começar com palavras que contenham vogais comuns e consoantes frequentes como R, S, T, N.',
          low: 'Continue praticando! Dica: comece sempre com palavras que tenham letras comuns e use o feedback de cores para eliminar possibilidades.'
        },
        'sequencia-cx': {
          high: 'Perfeito! Você entende muito bem os processos e fluxos de trabalho. Essa habilidade é essencial para organização e eficiência.',
          medium: 'Bom! Para melhorar, tente visualizar o fluxo completo antes de ordenar e pense na lógica de causa e efeito entre as etapas.',
          low: 'Continue tentando! Dica: leia todas as etapas primeiro e identifique qual deve ser a primeira e a última, depois organize as intermediárias.'
        },
        'conexo-cx': {
          high: 'Excelente! Sua capacidade de identificar padrões e conexões está muito desenvolvida. Isso é fundamental para análise e categorização.',
          medium: 'Bom trabalho! Para melhorar, tente identificar primeiro os grupos mais óbvios e deixe os mais sutis para o final.',
          low: 'Continue praticando! Dica: procure por temas comuns como categorias, sinônimos ou palavras relacionadas ao mesmo contexto.'
        },
        'quem-disse-cx': {
          high: 'Perfeito! Você tem ótima memória e compreensão de contexto. Essas habilidades são valiosas para comunicação efetiva.',
          medium: 'Bom! Para melhorar, preste atenção aos detalhes das frases e ao contexto em que foram ditas.',
          low: 'Continue tentando! Dica: leia as frases com atenção e tente associar o estilo de comunicação com cada perfil.'
        }
      };
      
      const gameExplanations = explanations[gameId] || explanations['termo-cx'];
      
      if (percentage >= 75) {
        return gameExplanations.high;
      } else if (percentage >= 50) {
        return gameExplanations.medium;
      } else {
        return gameExplanations.low;
      }
    }

    syncLocalProgress(progress) {
      if (!this.loggedInUser || !progress) return;
      const users = getUsersData();
      if (!users[this.loggedInUser]) users[this.loggedInUser] = {};
      const progressFlow = root.ProgressFlow || null;
      const mergedProgress = progressFlow?.mergeProgressSources
        ? progressFlow.mergeProgressSources(users[this.loggedInUser], progress)
        : null;
      users[this.loggedInUser].xp = mergedProgress?.xp ?? progress.xp ?? users[this.loggedInUser].xp ?? 0;
      users[this.loggedInUser].level = mergedProgress?.level ?? progress.level ?? users[this.loggedInUser].level ?? 1;
      users[this.loggedInUser].completedChallenges = mergedProgress?.completedChallenges
        || progress.completed_challenges
        || users[this.loggedInUser].completedChallenges
        || [];
      users[this.loggedInUser].completedMinigames = mergedProgress?.completedMinigames
        || progress.completed_minigames
        || users[this.loggedInUser].completedMinigames
        || [];
      users[this.loggedInUser].failedChallenges = mergedProgress?.failedChallenges
        || users[this.loggedInUser].failedChallenges
        || [];
      saveUsersData(users);

      const xpCount = qs('xp-count');
      if (xpCount) xpCount.textContent = users[this.loggedInUser].xp || 0;
    }

    renderError(message) {
      this.root.innerHTML = `
        <section class="intermission-result-card" role="alert" aria-label="Erro ao carregar jogo">
          <div class="intermission-result-icon" aria-hidden="true">!</div>
          <h2>Nao foi possivel carregar o game</h2>
          <p>${escapeHtml(message)}</p>
          <button class="intermission-btn" onclick="window.location.href='/app'" aria-label="Voltar para página inicial">Voltar ao inicio</button>
        </section>
      `;
    }

    showGameSplash() {
      const splash = qs('intermission-splash');
      if (!splash) {
        const splashEl = root.document.createElement('div');
        splashEl.id = 'intermission-splash';
        splashEl.className = 'intermission-splash';
        splashEl.innerHTML = `
          <div class="intermission-splash-content">
            <div class="intermission-splash-icon">CX</div>
            <div class="intermission-splash-title">FASE ESPECIAL</div>
            <div class="intermission-splash-subtitle">Prepare-se para o desafio</div>
          </div>
        `;
        root.document.body.appendChild(splashEl);
      }
      
      const splashElement = qs('intermission-splash');
      splashElement.classList.add('show');
      
      root.setTimeout(() => {
        splashElement.classList.remove('show');
      }, 2500);
    }

    initializeProgressBar() {
      if (!root.MysteryProgressBar) {
        return;
      }
      
      const manifest = this.manifest || this.findManifestForSession();
      if (!manifest) {
        return;
      }

      const currentChallengeId = resolveFlowChallengeId(this.session?.progress) || resolveFlowChallengeId(this.currentNode);
      
      const phases = root.MysteryProgressBar.fromIntermissionManifest(
        manifest,
        [],
        currentChallengeId,
        new Map()
      );
      
      if (!this.progressBar) {
        this.progressBar = new root.MysteryProgressBar('mystery-progress-bar');
      }
      
      if (this.progressBar && phases.length > 0) {
        this.progressBar.update(phases);
      }
    }
  }

  function toggleFullscreen() {
    const playCard = root.document.querySelector('.intermission-play-card');
    if (!playCard) return;

    if (!root.document.fullscreenElement) {
      if (playCard.requestFullscreen) {
        playCard.requestFullscreen();
      } else if (playCard.webkitRequestFullscreen) {
        playCard.webkitRequestFullscreen();
      } else if (playCard.msRequestFullscreen) {
        playCard.msRequestFullscreen();
      }
    } else {
      if (root.document.exitFullscreen) {
        root.document.exitFullscreen();
      } else if (root.document.webkitExitFullscreen) {
        root.document.webkitExitFullscreen();
      } else if (root.document.msExitFullscreen) {
        root.document.msExitFullscreen();
      }
    }
  }

  return {
    InlineIntermissionGame,
    toggleFullscreen
  };
});
