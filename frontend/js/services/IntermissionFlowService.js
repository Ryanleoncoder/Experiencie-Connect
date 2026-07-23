(function initIntermissionFlow(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.IntermissionFlowService = api.IntermissionFlowService;
    root.IntermissionFlow = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function buildIntermissionFlow(root) {
  const ProgressFlowApi = (typeof module !== 'undefined' && module.exports)
    ? require('./ProgressFlow')
    : (root?.ProgressFlow || null);
  const STORAGE_PREFIX = 'intermission_manifest_';
  const STORAGE_BY_ID_PREFIX = 'intermission_manifest_id_';
  const PHASE_STORAGE_PREFIX = 'phase_session_';
  const DEFAULT_API_BASE = 'https://api.expconnect.com.br';
  const MANIFEST_SCHEMA_VERSION = 3;
  const PHASE_SESSION_SCHEMA_VERSION = 2;

  function normalizeApiBase(apiBase) {
    const base = apiBase || root?.CXGAME_VPS_API_BASE || root?.__APP_CONFIG__?.CXGAME_VPS_API_BASE || DEFAULT_API_BASE;
    return String(base).replace(/\/+$/, '');
  }

  function getProgressFlowApi() {
    return root?.ProgressFlow || ProgressFlowApi || null;
  }

  function getStoredSessionToken({ localStorageRef, sessionStorageRef } = {}) {
    return null;
  }

  function challengeSignature(challengeIds = []) {
    const raw = Array.isArray(challengeIds) ? challengeIds.join('|') : '';
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
    }
    return Math.abs(hash).toString(36);
  }

  function normalizeManifestChallengeIds(challengeIds = []) {
    return (Array.isArray(challengeIds) ? challengeIds : [])
      .filter(challengeId => typeof challengeId === 'string' && !challengeId.startsWith('ig-'));
  }

  function resolveFlowChallengeId(nodeOrProgress) {
    if (!nodeOrProgress) return null;

    if (typeof nodeOrProgress === 'string') {
      if (nodeOrProgress.startsWith('ig-')) return nodeOrProgress;
      const legacyMatch = nodeOrProgress.match(/^game:L(\d+):slot(\d+):/);
      return legacyMatch ? `ig-L${legacyMatch[1]}-slot${legacyMatch[2]}` : null;
    }

    const flowChallengeId = nodeOrProgress.flow_challenge_id || nodeOrProgress.flowChallengeId;
    if (typeof flowChallengeId === 'string' && flowChallengeId.startsWith('ig-')) {
      return flowChallengeId;
    }

    const syntheticChallengeId = nodeOrProgress.synthetic_challenge_id || nodeOrProgress.syntheticChallengeId;
    if (typeof syntheticChallengeId === 'string') {
      if (syntheticChallengeId.startsWith('ig-')) return syntheticChallengeId;
      const legacyMatch = syntheticChallengeId.match(/^game:L(\d+):slot(\d+):/);
      if (legacyMatch) return `ig-L${legacyMatch[1]}-slot${legacyMatch[2]}`;
    }

    return null;
  }

  function getChallengeIdForNode(node) {
    if (!node || typeof node !== 'object') return null;
    return node.challenge_id || node.challengeId || node.content_id || node.contentId || node.id || null;
  }

  function getLogicalChallengeIdForNode(node) {
    if (!node || typeof node !== 'object') return null;
    const progressFlow = getProgressFlowApi();
    const raw = node.logical_id || node.logicalId || getChallengeIdForNode(node);
    return progressFlow?.normalizeChallengeId?.(raw) || raw;
  }

  function normalizeManifest(manifest) {
    if (!manifest || !Array.isArray(manifest.nodes)) return null;

    const normalizedNodes = manifest.nodes.map(node => {
      if (!node) return node;
      if (node.type === 'challenge') {
        const contentId = getChallengeIdForNode(node);
        const logicalId = getLogicalChallengeIdForNode(node);
        return {
          ...node,
          challenge_id: contentId,
          logical_id: logicalId,
          content_id: contentId
        };
      }
      if (node.type !== 'game') return node;
      return {
        ...node,
        flow_challenge_id: resolveFlowChallengeId(node)
      };
    });

    return {
      ...manifest,
      schema_version: manifest.schema_version,
      nodes: normalizedNodes
    };
  }

  function hasResolvableGameNodes(manifest) {
    return (manifest?.nodes || [])
      .filter(node => node?.type === 'game')
      .every(node => Boolean(resolveFlowChallengeId(node)));
  }

  function getNodeForChallenge(manifest, challengeId) {
    return (manifest?.nodes || []).find(node => {
      if (node.type !== 'challenge') return false;
      if (getChallengeIdForNode(node) === challengeId) return true;
      if (getLogicalChallengeIdForNode(node) === challengeId) return true;
      return Boolean(
        getProgressFlowApi()?.areSameChallenge?.(getChallengeIdForNode(node), challengeId)
      );
    }) || null;
  }

  function findGameNodeByFlowChallengeId(manifest, challengeId) {
    if (!challengeId) return null;
    return (manifest?.nodes || []).find(node => (
      node?.type === 'game' && resolveFlowChallengeId(node) === challengeId
    )) || null;
  }

  function getNextNodeAfterChallenge(manifest, challengeId) {
    const currentNode = getNodeForChallenge(manifest, challengeId);
    if (!currentNode) return null;
    return (manifest.nodes || []).find(node => node.order_index > currentNode.order_index) || null;
  }

  function getProgressForChallenge(manifest, challengeId) {
    const node = getNodeForChallenge(manifest, challengeId);
    if (!node) return null;
    return {
      current: (node.order_index || 0) + 1,
      total: manifest.total_nodes || (manifest.nodes || []).length,
      node
    };
  }

  function buildNavigationTarget(node, manifest = null) {
    if (!node) return null;
    const phaseSessionId = node.phase_session_id || node.phaseSessionId || manifest?.phase_session_id || manifest?.phaseSessionId || null;
    if (node.type === 'game') {
      if (node.session_id) {
        return `challenge.html?game_session_id=${encodeURIComponent(node.session_id)}`;
      }
      const flowChallengeId = resolveFlowChallengeId(node);
      if (!flowChallengeId) return null;
      const query = new URLSearchParams({ id: flowChallengeId });
      if (phaseSessionId) query.set('phase_session_id', phaseSessionId);
      return `challenge.html?${query.toString()}`;
    }
    if (node.type === 'challenge') {
      const challengeId = getChallengeIdForNode(node);
      if (!challengeId) return null;
      const query = new URLSearchParams({ id: challengeId });
      if (phaseSessionId) query.set('phase_session_id', phaseSessionId);
      return `challenge.html?${query.toString()}`;
    }
    return null;
  }

  function getGameSessionIdFromUrl(urlOrSearch) {
    const raw = String(urlOrSearch || root?.location?.search || '');
    const query = raw.includes('?') ? raw.slice(raw.indexOf('?')) : raw;
    const params = new URLSearchParams(query);
    return params.get('game_session_id');
  }

  function isProcessedStatus(status) {
    return Boolean(
      status
      && (
        status.status === 'completed'
        || status.status === 'failed'
        || status.processed === true
        || status.completed_at
        || status.completedAt
      )
    );
  }

  function isNodeCompleted(node, completedChallenges = [], challengeStatusMap = new Map()) {
    if (!node) return true;
    if (node.type === 'game') {
      const flowChallengeId = resolveFlowChallengeId(node);
      const status = flowChallengeId ? challengeStatusMap.get(flowChallengeId) : null;
      return Boolean(
        flowChallengeId
        && (
          completedChallenges.includes(flowChallengeId)
          || isProcessedStatus(status)
        )
      );
    }

    const normalizedChallengeId = getProgressFlowApi()?.normalizeChallengeId?.(node.challenge_id) || node.challenge_id;
    const status = challengeStatusMap.get(node.challenge_id)
      || challengeStatusMap.get(normalizedChallengeId);
    const isCompleted = (Array.isArray(completedChallenges) ? completedChallenges : []).some(challengeId => (
      getProgressFlowApi()?.areSameChallenge?.(challengeId, node.challenge_id) || challengeId === node.challenge_id
    ));

    return isCompleted || isProcessedStatus(status);
  }

  function findFirstAvailableNode(manifest, completedChallenges = [], challengeStatusMap = new Map()) {
    return (manifest?.nodes || []).find(node => !isNodeCompleted(node, completedChallenges, challengeStatusMap)) || null;
  }

  function findNextAvailableNodeAfterChallenge(manifest, challengeId, completedChallenges = [], challengeStatusMap = new Map()) {
    const currentNode = getNodeForChallenge(manifest, challengeId);
    if (!currentNode) return null;
    return (manifest.nodes || []).find(node => node.order_index > currentNode.order_index && !isNodeCompleted(node, completedChallenges, challengeStatusMap)) || null;
  }

  function getManifestIdStorageKey(manifestId) {
    return `${STORAGE_BY_ID_PREFIX}${manifestId}`;
  }

  function cacheManifestById(manifest, sessionStorageRef = root?.sessionStorage) {
    const normalized = normalizeManifest(manifest);
    if (
      !normalized
      || normalized.schema_version !== MANIFEST_SCHEMA_VERSION
      || !normalized.manifest_id
      || !hasResolvableGameNodes(normalized)
    ) {
      return null;
    }

    try {
      sessionStorageRef?.setItem?.(getManifestIdStorageKey(normalized.manifest_id), JSON.stringify(normalized));
    } catch (error) {
      console.warn('[IntermissionFlow] Failed to cache manifest by id:', error);
    }

    return normalized;
  }

  function readCachedManifestById(manifestId, sessionStorageRef = root?.sessionStorage) {
    if (!manifestId) return null;
    const raw = sessionStorageRef?.getItem?.(getManifestIdStorageKey(manifestId));
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);
      const normalized = normalizeManifest(parsed);
      if (
        !normalized
        || normalized.schema_version !== MANIFEST_SCHEMA_VERSION
        || normalized.manifest_id !== manifestId
        || !hasResolvableGameNodes(normalized)
      ) {
        sessionStorageRef?.removeItem?.(getManifestIdStorageKey(manifestId));
        return null;
      }

      return normalized;
    } catch (error) {
      sessionStorageRef?.removeItem?.(getManifestIdStorageKey(manifestId));
      return null;
    }
  }

  function pruneCachedManifestEntries(sessionStorageRef = root?.sessionStorage) {
    if (!sessionStorageRef || typeof sessionStorageRef.length !== 'number' || typeof sessionStorageRef.key !== 'function') {
      return;
    }

    const keys = [];
    for (let i = 0; i < sessionStorageRef.length; i++) {
      const key = sessionStorageRef.key(i);
      if (key && (key.startsWith(STORAGE_PREFIX) || key.startsWith(STORAGE_BY_ID_PREFIX))) {
        keys.push(key);
      }
    }

    keys.forEach(key => {
      try {
        const parsed = JSON.parse(sessionStorageRef.getItem(key));
        const normalized = normalizeManifest(parsed);
        if (
          !normalized
          || normalized.schema_version !== MANIFEST_SCHEMA_VERSION
          || !normalized.manifest_id
          || !hasResolvableGameNodes(normalized)
        ) {
          sessionStorageRef.removeItem(key);
        }
      } catch (error) {
        sessionStorageRef.removeItem(key);
      }
    });
  }

  class IntermissionFlowService {
    constructor(options = {}) {
      this.apiBase = normalizeApiBase(options.apiBase);
      this.fetchImpl = options.fetchImpl || (root?.fetch ? (u, o) => root.fetch(u, o) : null);
      this.sessionStorageRef = options.sessionStorageRef || root?.sessionStorage;
      this.manifest = null;
      this.phaseSession = null;
      this.pruneCachedManifestEntries();
    }

    getStorageKey({ userId, seasonId, level, setor, challengeIds }) {
      return `${STORAGE_PREFIX}${seasonId}_${setor || 'CX'}_${level}_${userId}_${challengeSignature(challengeIds)}`;
    }

    getManifestIdStorageKey(manifestId) {
      return getManifestIdStorageKey(manifestId);
    }

    getPhaseSessionStorageKey({ userId = 'auth', seasonId, level, setor }) {
      return `${PHASE_STORAGE_PREFIX}${seasonId}_${setor || 'CX'}_${level}_${userId || 'auth'}`;
    }

    pruneCachedManifestEntries() {
      pruneCachedManifestEntries(this.sessionStorageRef);
    }

    readCachedManifest(params) {
      const raw = this.sessionStorageRef?.getItem?.(this.getStorageKey(params));
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.schema_version !== MANIFEST_SCHEMA_VERSION) {
          this.sessionStorageRef?.removeItem?.(this.getStorageKey(params));
          return null;
        }

        const normalized = normalizeManifest(parsed);
        if (!normalized || !normalized.manifest_id || !hasResolvableGameNodes(normalized)) {
          this.sessionStorageRef?.removeItem?.(this.getStorageKey(params));
          return null;
        }

        return normalized;
      } catch (error) {
        this.sessionStorageRef?.removeItem?.(this.getStorageKey(params));
        return null;
      }
    }

    readCachedManifestById(manifestId) {
      return readCachedManifestById(manifestId, this.sessionStorageRef);
    }

    readCachedPhaseSession(params) {
      const raw = this.sessionStorageRef?.getItem?.(this.getPhaseSessionStorageKey(params));
      if (!raw) return null;

      try {
        const parsed = JSON.parse(raw);
        const normalized = normalizeManifest(parsed);
        if (
          !normalized
          || normalized.schema_version !== PHASE_SESSION_SCHEMA_VERSION
          || !normalized.phase_session_id
        ) {
          this.sessionStorageRef?.removeItem?.(this.getPhaseSessionStorageKey(params));
          return null;
        }

        return normalized;
      } catch (error) {
        this.sessionStorageRef?.removeItem?.(this.getPhaseSessionStorageKey(params));
        return null;
      }
    }

    writeCachedPhaseSession(params, phaseSession) {
      const normalized = normalizeManifest(phaseSession);
      if (!normalized || normalized.schema_version !== PHASE_SESSION_SCHEMA_VERSION || !normalized.phase_session_id) {
        return null;
      }

      try {
        this.sessionStorageRef?.setItem?.(this.getPhaseSessionStorageKey(params), JSON.stringify(normalized));
      } catch (error) {
        console.warn('[IntermissionFlow] Failed to cache phase session:', error);
      }

      return normalized;
    }

    writeCachedManifest(params, manifest) {
      try {
        const normalized = cacheManifestById(manifest, this.sessionStorageRef);
        if (!normalized) return;
        this.sessionStorageRef?.setItem?.(this.getStorageKey(params), JSON.stringify(normalized));
      } catch (error) {
        console.warn('[IntermissionFlow] Failed to cache manifest:', error);
      }
    }

    async loadManifest({ userId, seasonId, level, setor = 'CX', challengeIds, force = false }) {
      const manifestChallengeIds = normalizeManifestChallengeIds(challengeIds);
      const params = { userId, seasonId, level, setor, challengeIds: manifestChallengeIds };
      if (!force) {
        const cached = this.readCachedManifest(params);
        if (cached) {
          this.manifest = cached;
          return cached;
        }
      }

      const token = getStoredSessionToken({
        sessionStorageRef: this.sessionStorageRef
      });
      const authed = root?.CxSession?.hasActiveSession ? root.CxSession.hasActiveSession() : !!token;

      if (!authed || !this.fetchImpl) {
        console.warn('[IntermissionFlow] Sessao ou fetch indisponivel; usando fluxo challenge-only');
        return null;
      }

      const response = await this.fetchImpl(`${this.apiBase}/api/intermission/manifest`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          user_id: userId,
          season_id: seasonId,
          level,
          setor,
          challenge_ids: manifestChallengeIds
        })
      });

      if (!response.ok) {
        throw new Error(`Intermission manifest failed: HTTP ${response.status}`);
      }

      const manifest = normalizeManifest(await response.json());
      if (!manifest || manifest.schema_version !== MANIFEST_SCHEMA_VERSION || !manifest.manifest_id || !hasResolvableGameNodes(manifest)) {
        throw new Error('Intermission manifest missing resolvable flow challenge ids');
      }

      this.manifest = manifest;
      this.writeCachedManifest(params, manifest);
      return manifest;
    }

    async loadPhaseSession({ userId = 'auth', seasonId, level, setor = 'CX', force = false, create = true }) {
      const params = { userId, seasonId, level, setor };
      if (!force) {
        const cached = this.readCachedPhaseSession(params);
        if (cached) {
          this.phaseSession = cached;
          this.manifest = cached;
          return cached;
        }
      }

      const token = getStoredSessionToken({
        sessionStorageRef: this.sessionStorageRef
      });
      const authed = root?.CxSession?.hasActiveSession ? root.CxSession.hasActiveSession() : !!token;

      if (!authed || !this.fetchImpl) {
        console.warn('[IntermissionFlow] Sessao ou fetch indisponivel; phase session indisponivel');
        return null;
      }

      let response;
      if (create) {
        // ENTRADA no desafio: cria-ou-reusa a phase autoritativa (POST).
        response = await this.fetchImpl(`${this.apiBase}/api/phase/sessions`, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ season_id: seasonId, level, setor })
        });
      } else {
        // APP (read-only): LE a phase active SEM criar; 204 = nivel nao iniciado -> null.
        // AbortController evita pendurar o load do app se a VPS demorar.
        const ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
        const timer = ctrl ? setTimeout(() => ctrl.abort(), 6000) : null;
        try {
          const q = `season_id=${encodeURIComponent(seasonId)}&level=${encodeURIComponent(level)}&setor=${encodeURIComponent(setor || 'CX')}`;
          response = await this.fetchImpl(`${this.apiBase}/api/phase/sessions/active?${q}`, {
            method: 'GET',
            credentials: 'include',
            signal: ctrl ? ctrl.signal : undefined
          });
        } finally {
          if (timer) clearTimeout(timer);
        }
        if (response.status === 204) {
          return null;
        }
      }

      if (!response.ok) {
        throw new Error(`Phase session failed: HTTP ${response.status}`);
      }

      const phaseSession = this.writeCachedPhaseSession(params, await response.json());
      if (!phaseSession) {
        throw new Error('Phase session response is invalid');
      }

      this.phaseSession = phaseSession;
      this.manifest = phaseSession;
      return phaseSession;
    }

    async resolveIntermissionSession({ phaseSessionId, flowChallengeId }) {
      const token = getStoredSessionToken({
        sessionStorageRef: this.sessionStorageRef
      });
      const authed = root?.CxSession?.hasActiveSession ? root.CxSession.hasActiveSession() : !!token;

      if (!authed || !this.fetchImpl || !phaseSessionId || !flowChallengeId) {
        return null;
      }

      const response = await this.fetchImpl(
        `${this.apiBase}/api/phase/sessions/${encodeURIComponent(phaseSessionId)}/intermission/${encodeURIComponent(flowChallengeId)}/resolve`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      if (!response.ok) {
        throw new Error(`Intermission resolve failed: HTTP ${response.status}`);
      }

      return response.json();
    }

    getNextNodeAfterChallenge(challengeId, completedChallenges = [], challengeStatusMap = new Map()) {
      return findNextAvailableNodeAfterChallenge(this.manifest, challengeId, completedChallenges, challengeStatusMap);
    }

    buildNavigationTarget(node) {
      return buildNavigationTarget(node, this.phaseSession || this.manifest);
    }

    findManifestById(manifestId) {
      const manifest = this.readCachedManifestById(manifestId);
      if (manifest) {
        this.manifest = manifest;
      }
      return manifest;
    }
  }

  return {
    IntermissionFlowService,
    buildNavigationTarget,
    findFirstAvailableNode,
    findGameNodeByFlowChallengeId,
    findNextAvailableNodeAfterChallenge,
    getNextNodeAfterChallenge,
    getNodeForChallenge,
    getProgressForChallenge,
    getGameSessionIdFromUrl,
    getStoredSessionToken,
    getChallengeIdForNode,
    getLogicalChallengeIdForNode,
    PHASE_SESSION_SCHEMA_VERSION,
    normalizeManifestChallengeIds,
    resolveFlowChallengeId,
    isNodeCompleted,
    cacheManifestById,
    normalizeManifest,
    findManifestById: readCachedManifestById,
    pruneCachedManifestEntries
  };
});
