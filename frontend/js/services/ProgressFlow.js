function progressFlowDebugLog(...args) {
  if (typeof window !== 'undefined' && window.CX_DEBUG === true) {
    console.debug(...args);
  }
}

(function initProgressFlow(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.ProgressFlow = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function createProgressFlow() {
  const INTERMISSION_SUCCESS_PERCENT = 60;
  const FLOW_LOG_PREFIX = '[FlowBuilder]';
  const PINNED_LOGUN_STAGE_BY_LEVEL = {
    1: 3
  };

  function getChallengeId(challenge) {
    if (!challenge) return null;
    if (typeof challenge === 'string') return challenge;
    return challenge.id || challenge.challenge_id || challenge.challengeId || null;
  }

  function normalizeChallengeId(challengeId) {
    if (typeof challengeId !== 'string' || !challengeId) return challengeId;
    if (isIntermissionId(challengeId)) return challengeId;
    return challengeId.replace(/-v\d+$/, '');
  }

  function areSameChallenge(leftChallengeId, rightChallengeId) {
    if (!leftChallengeId || !rightChallengeId) return false;
    return normalizeChallengeId(leftChallengeId) === normalizeChallengeId(rightChallengeId);
  }

  function resolveChallengeIdForCollection(challenges, requestedChallengeId) {
    if (!requestedChallengeId) return null;

    const exactMatch = (Array.isArray(challenges) ? challenges : [])
      .map(getChallengeId)
      .find(challengeId => challengeId === requestedChallengeId);

    if (exactMatch) {
      return exactMatch;
    }

    return (Array.isArray(challenges) ? challenges : [])
      .map(getChallengeId)
      .find(challengeId => areSameChallenge(challengeId, requestedChallengeId)) || null;
  }

  function isIntermissionId(challengeId) {
    return typeof challengeId === 'string' && challengeId.startsWith('ig-');
  }

  function isIntermissionChallenge(challenge) {
    const challengeId = getChallengeId(challenge);
    if (isIntermissionId(challengeId)) return true;
    if (!challenge || typeof challenge !== 'object') return false;

    const rawType = challenge.tipo || challenge.type || challenge.kind || challenge.node_type;
    return rawType === 'intermission' || rawType === 'game';
  }

  function isLogunChallenge(challenge) {
    const challengeId = getChallengeId(challenge);
    if (typeof challengeId === 'string' && (challengeId.startsWith('txt-') || challengeId.startsWith('lg-'))) {
      return true;
    }

    if (!challenge || typeof challenge !== 'object') return false;
    const rawType = challenge.tipo || challenge.type || challenge.kind || challenge.node_type;
    return rawType === 'texto' || rawType === 'text';
  }

  function hashString(str) {
    let hash = 0;

    if (!str || str.length === 0) return hash;

    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }

    return Math.abs(hash);
  }

  function createSeededRNG(seed) {
    let state = seed;
    const a = 1664525;
    const c = 1013904223;
    const m = Math.pow(2, 32);

    return function rng() {
      state = (a * state + c) % m;
      return state / m;
    };
  }

  function seededShuffle(array, seed) {
    const rng = createSeededRNG(seed);
    const arr = [...array];

    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }

    return arr;
  }

  function getOrderValue(challenge, fallbackIndex) {
    if (challenge && typeof challenge === 'object') {
      const raw = challenge.ordem ?? challenge.order ?? challenge.order_index ?? challenge.position;
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) return parsed;
    }

    return fallbackIndex + 1;
  }

  function normalizeFlowNode(challenge, order) {
    if (challenge && typeof challenge === 'object') {
      return {
        ...challenge,
        id: getChallengeId(challenge),
        ordem: order
      };
    }

    return {
      id: String(challenge),
      ordem: order
    };
  }

  function getIntermissionSlotIndex(challenge, fallbackIndex = null) {
    const challengeId = getChallengeId(challenge);
    const match = String(challengeId || '').match(/^ig-L\d+-slot(\d+)$/);
    if (match) {
      return Number(match[1]);
    }

    const explicitSlot = Number(challenge?.slot_index ?? challenge?.slotIndex);
    if (Number.isFinite(explicitSlot) && explicitSlot > 0) {
      return explicitSlot;
    }

    return fallbackIndex;
  }

  function sortIndexedChallenges(a, b) {
    if (a.order !== b.order) {
      return a.order - b.order;
    }

    return a.originalIndex - b.originalIndex;
  }

  function getCanonicalIntermissionInsertAfter(normalCount) {
    if (normalCount <= 0) return [];

    const first = Math.max(1, Math.min(normalCount, Math.round(normalCount * 0.4)));
    let second = Math.max(first + 1, Math.min(normalCount, Math.round(normalCount * 0.8)));
    if (second > normalCount) {
      second = normalCount;
    }

    return [first, second];
  }

  function getPinnedNormalChallenges(normalPool, level) {
    const targetStage = PINNED_LOGUN_STAGE_BY_LEVEL[Number(level)];
    if (!targetStage) return [];

    const firstLogun = [...normalPool]
      .sort(sortIndexedChallenges)
      .find(item => isLogunChallenge(item.challenge));

    return firstLogun ? [firstLogun] : [];
  }

  function applyCanonicalNormalPlacements(selectedNormals, level) {
    const reordered = [...selectedNormals];
    const pinnedPositions = [];
    const targetStage = PINNED_LOGUN_STAGE_BY_LEVEL[Number(level)];

    if (targetStage) {
      const logunIndex = reordered.findIndex(item => isLogunChallenge(item.challenge));
      if (logunIndex >= 0) {
        const [logunItem] = reordered.splice(logunIndex, 1);
        const targetIndex = Math.max(0, Math.min(reordered.length, targetStage - 1));
        reordered.splice(targetIndex, 0, logunItem);
        pinnedPositions.push({
          id: logunItem.id,
          type: 'logun',
          stagePosition: targetIndex + 1
        });
      }
    }

    return {
      reordered,
      pinnedPositions
    };
  }

  function buildPlayableFlow(allChallenges, options = {}) {
    const {
      userId = 'anonymous',
      seasonId = 'S-2025-01',
      level = 1,
      count = 20
    } = options;

    const indexed = (Array.isArray(allChallenges) ? allChallenges : [])
      .map((challenge, index) => ({
        challenge,
        id: getChallengeId(challenge),
        originalIndex: index,
        order: getOrderValue(challenge, index)
      }))
      .filter(item => item.id);

    const normalPool = indexed.filter(item => !isIntermissionChallenge(item.challenge));
    const intermissions = indexed.filter(item => isIntermissionChallenge(item.challenge));
    const pinnedNormals = getPinnedNormalChallenges(normalPool, level);
    const pinnedIds = new Set(pinnedNormals.map(item => item.id));
    const remainingNormalPool = normalPool.filter(item => !pinnedIds.has(item.id));
    const remainingCount = Math.max(0, count - pinnedNormals.length);

    const sampledNormals = remainingNormalPool.length > remainingCount
      ? seededShuffle(remainingNormalPool, hashString(`${userId}_${seasonId}_${level}`)).slice(0, remainingCount)
      : [...remainingNormalPool];

    const selectedNormals = [...pinnedNormals, ...sampledNormals];

    const selectedNormalIds = new Set(selectedNormals.map(item => item.id));
    const orderedSelectedNormals = indexed
      .filter(item => selectedNormalIds.has(item.id))
      .sort(sortIndexedChallenges);
    const { reordered: sortedSelectedNormals, pinnedPositions } = applyCanonicalNormalPlacements(
      orderedSelectedNormals,
      level
    );
    const sortedIntermissions = [...intermissions].sort((a, b) => {
      const aSlot = getIntermissionSlotIndex(a.challenge, a.originalIndex + 1) || 0;
      const bSlot = getIntermissionSlotIndex(b.challenge, b.originalIndex + 1) || 0;
      return aSlot - bSlot;
    });
    const intermissionBySlot = new Map();

    sortedIntermissions.forEach((item, index) => {
      const slotIndex = getIntermissionSlotIndex(item.challenge, index + 1);
      if (!slotIndex || intermissionBySlot.has(slotIndex)) return;
      intermissionBySlot.set(slotIndex, item.challenge);
    });

    const insertAfter = getCanonicalIntermissionInsertAfter(sortedSelectedNormals.length);
    const flowItems = [];
    const canonicalPositions = [];

    sortedSelectedNormals.forEach((item, index) => {
      flowItems.push(item.challenge);

      const normalCountSoFar = index + 1;
      insertAfter.forEach((targetNormalCount, slotOffset) => {
        const slotIndex = slotOffset + 1;
        if (normalCountSoFar !== targetNormalCount) {
          return;
        }

        const intermissionChallenge = intermissionBySlot.get(slotIndex);
        if (!intermissionChallenge) {
          return;
        }

        flowItems.push(intermissionChallenge);
        canonicalPositions.push({
          id: getChallengeId(intermissionChallenge),
          slotIndex,
          stagePosition: flowItems.length,
          afterNormalCount: normalCountSoFar
        });
      });
    });

    const normalizedFlow = flowItems.map((item, index) => normalizeFlowNode(item, index + 1));
    const rawIntermissionPositions = sortedIntermissions.map((item, index) => ({
      id: item.id,
      slotIndex: getIntermissionSlotIndex(item.challenge, index + 1),
      rawPosition: item.originalIndex + 1
    }));

    progressFlowDebugLog(`${FLOW_LOG_PREFIX} Rebuilt canonical flow`, {
      userId,
      seasonId,
      level,
      selectedNormalCount: sortedSelectedNormals.length,
      pinnedNormalPositions: pinnedPositions,
      rawIntermissionPositions,
      canonicalIntermissionPositions: canonicalPositions,
      selectedChallengeIds: normalizedFlow.map(item => item.id)
    });

    return normalizedFlow;
  }

  function normalizeMinigameCompletionId(minigameId) {
    const match = String(minigameId || '').match(/^intermission:[^:]+:L(\d+):slot(\d+)$/);
    if (!match) return null;

    return `ig-L${match[1]}-slot${match[2]}`;
  }

  function buildLogicalCompletedSet(completedChallenges = [], completedMinigames = []) {
    const completedSet = new Set();

    (completedChallenges || []).forEach(challengeId => {
      const normalizedId = normalizeChallengeId(challengeId);
      if (normalizedId) {
        completedSet.add(normalizedId);
      }
    });

    (completedMinigames || []).forEach(minigameId => {
      const intermissionId = normalizeMinigameCompletionId(minigameId);
      if (intermissionId) {
        completedSet.add(intermissionId);
      }
    });

    return completedSet;
  }

  function buildCompletedBaseSet(completedChallenges = [], completedMinigames = []) {
    const completedSet = new Set((completedChallenges || []).filter(Boolean));

    (completedMinigames || []).forEach(minigameId => {
      const intermissionId = normalizeMinigameCompletionId(minigameId);
      if (intermissionId) {
        completedSet.add(intermissionId);
      }
    });

    return completedSet;
  }

  function getStatusRank(status) {
    switch (status) {
      case 'completed':
        return 3;
      case 'failed':
        return 2;
      case 'in_progress':
        return 1;
      default:
        return 0;
    }
  }

  function shouldPreferStatusEntry(currentEntry, nextEntry) {
    if (!currentEntry) return true;

    const currentRank = getStatusRank(currentEntry?.status);
    const nextRank = getStatusRank(nextEntry?.status);
    if (nextRank !== currentRank) {
      return nextRank > currentRank;
    }

    return Number(nextEntry?.attempts_used || 0) >= Number(currentEntry?.attempts_used || 0);
  }

  function buildStatusMap(challengeStatusEntries = []) {
    const map = new Map();
    const entries = challengeStatusEntries instanceof Map
      ? Array.from(challengeStatusEntries.values())
      : (challengeStatusEntries || []);

    entries.forEach(entry => {
      const challengeId = entry && (entry.challenge_id || entry.challengeId || entry.id);
      if (!challengeId) return;

      if (shouldPreferStatusEntry(map.get(challengeId), entry)) {
        map.set(challengeId, entry);
      }

      const normalizedId = normalizeChallengeId(challengeId);
      if (normalizedId && normalizedId !== challengeId) {
        const aliasEntry = {
          ...entry,
          challenge_id: normalizedId,
          canonical_challenge_id: challengeId
        };
        if (shouldPreferStatusEntry(map.get(normalizedId), aliasEntry)) {
          map.set(normalizedId, aliasEntry);
        }
      }
    });

    return map;
  }

  function buildIntermissionStatusMap(intermissionStatusEntries = []) {
    if (intermissionStatusEntries instanceof Map) {
      return intermissionStatusEntries;
    }

    const map = new Map();
    (intermissionStatusEntries || []).forEach(entry => {
      const challengeId = entry && (entry.challenge_id || entry.challengeId || entry.id);
      if (!challengeId) return;

      const percentValue = Number(entry.percent ?? entry.score_percent ?? entry.percentage);
      const percent = Number.isFinite(percentValue) ? percentValue : 0;
      const processed = entry.processed !== undefined
        ? Boolean(entry.processed)
        : true;
      const success = entry.success !== undefined
        ? Boolean(entry.success)
        : percent >= INTERMISSION_SUCCESS_PERCENT;

      map.set(challengeId, {
        ...entry,
        challenge_id: challengeId,
        percent,
        processed,
        success
      });
    });

    return map;
  }

  function inferLevelFromChallengeId(challengeId) {
    const id = String(challengeId || '');
    const intermissionMatch = id.match(/^ig-L(\d+)-slot\d+$/);
    if (intermissionMatch) {
      return Number(intermissionMatch[1]);
    }

    const match = id.match(/-(\d)\d{2}/);
    return match ? Number(match[1]) : null;
  }

  function statusEntriesForLevel(statusMap, level, statusName) {
    if (!level) return [];

    const seenLogicalIds = new Set();

    return Array.from(statusMap.entries()).filter(([challengeId, entry]) => {
      if (isIntermissionId(challengeId)) return false;
      const logicalId = normalizeChallengeId(challengeId);
      if (!logicalId || seenLogicalIds.has(logicalId)) return false;
      if (inferLevelFromChallengeId(logicalId) !== Number(level)) return false;

      seenLogicalIds.add(logicalId);
      return getStatusForId(challengeId, statusMap) === statusName
        || (entry && entry.status === statusName);
    });
  }

  function getStatusForId(challengeId, statusMap) {
    const entry = statusMap.get(challengeId) || statusMap.get(normalizeChallengeId(challengeId));
    if (!entry) return null;
    if (typeof entry === 'string') return entry;
    return entry.status || null;
  }

  function mergeUniqueStrings(...lists) {
    const merged = [];
    const seen = new Set();

    lists.forEach(list => {
      (Array.isArray(list) ? list : []).forEach(value => {
        if (typeof value !== 'string' || !value || seen.has(value)) return;
        seen.add(value);
        merged.push(value);
      });
    });

    return merged;
  }

  function mergeUniqueChallengeIds(...lists) {
    const merged = [];
    const seen = new Set();

    lists.forEach(list => {
      (Array.isArray(list) ? list : []).forEach(value => {
        if (typeof value !== 'string' || !value) return;

        const normalizedValue = normalizeChallengeId(value);
        if (!normalizedValue || seen.has(normalizedValue)) return;

        seen.add(normalizedValue);
        merged.push(normalizedValue);
      });
    });

    return merged;
  }

  function mergeAttemptHistory(...lists) {
    const merged = [];
    const seen = new Set();

    lists.forEach(list => {
      (Array.isArray(list) ? list : []).forEach(entry => {
        if (!entry || typeof entry !== 'object') return;

        const key = [
          entry.challenge_id || '',
          entry.timestamp || '',
          entry.correct,
          entry.score,
          entry.time_used,
          entry.answer || ''
        ].join('|');

        if (seen.has(key)) return;
        seen.add(key);
        merged.push(entry);
      });
    });

    return merged.sort((a, b) => {
      const aTime = new Date(a?.timestamp || 0).getTime();
      const bTime = new Date(b?.timestamp || 0).getTime();
      return aTime - bTime;
    });
  }

  function getProgressArray(progress, camelKey, snakeKey) {
    return progress?.[camelKey] || progress?.[snakeKey] || [];
  }

  function getProgressNumber(progress, key) {
    const value = Number(progress?.[key]);
    return Number.isFinite(value) ? value : 0;
  }

  function mergeProgressSources(localSource = {}, remoteSource = {}) {
    const xp = Math.max(
      getProgressNumber(localSource, 'xp'),
      getProgressNumber(remoteSource, 'xp')
    );
    const inferredLevel = Math.floor(Math.max(xp, 0) / 500) + 1;
    const level = Math.max(
      1,
      inferredLevel,
      getProgressNumber(localSource, 'level'),
      getProgressNumber(remoteSource, 'level')
    );

    return {
      userId: remoteSource?.user_id || localSource?.id || localSource?.user_id || null,
      xp,
      level,
      completedChallenges: mergeUniqueChallengeIds(
        getProgressArray(localSource, 'completedChallenges', 'completed_challenges'),
        getProgressArray(remoteSource, 'completedChallenges', 'completed_challenges')
      ),
      completedMinigames: mergeUniqueStrings(
        getProgressArray(localSource, 'completedMinigames', 'completed_minigames'),
        getProgressArray(remoteSource, 'completedMinigames', 'completed_minigames')
      ),
      failedChallenges: mergeUniqueChallengeIds(
        getProgressArray(localSource, 'failedChallenges', 'failed_challenges'),
        getProgressArray(remoteSource, 'failedChallenges', 'failed_challenges')
      ),
      attemptHistory: mergeAttemptHistory(
        getProgressArray(localSource, 'attemptHistory', 'attempt_history'),
        getProgressArray(remoteSource, 'attemptHistory', 'attempt_history')
      )
    };
  }

  function calculateLevelProgress(challenges, sources = {}) {
    const flow = (Array.isArray(challenges) ? challenges : [])
      .filter(challenge => getChallengeId(challenge));
    const completedBaseSet = buildCompletedBaseSet(
      sources.completedChallenges || [],
      sources.completedMinigames || []
    );
    const completedLogicalSet = buildLogicalCompletedSet(
      sources.completedChallenges || [],
      sources.completedMinigames || []
    );
    const statusMap = buildStatusMap(sources.challengeStatusEntries || sources.challengeStatusMap || []);
    const intermissionStatusMap = buildIntermissionStatusMap(sources.intermissionStatusEntries || sources.intermissionStatusMap || []);
    const normalFlowCount = flow.filter(challenge => !isIntermissionChallenge(challenge)).length;
    const completedStatusEntriesForLevel = statusEntriesForLevel(
      statusMap,
      sources.level,
      'completed'
    );
    const allNormalChallengesCompletedByStatus = normalFlowCount > 0
      && completedStatusEntriesForLevel.length >= normalFlowCount;

    const successIds = [];
    const processedIds = [];
    const successChallenges = [];
    const processedChallenges = [];

    flow.forEach(challenge => {
      const challengeId = getChallengeId(challenge);
      const isNormalChallenge = !isIntermissionChallenge(challenge);
      let isSuccess = false;
      let isProcessed = false;

      if (isNormalChallenge) {
        const status = getStatusForId(challengeId, statusMap);
        if (status) {
          isSuccess = status === 'completed';
          isProcessed = status === 'completed' || status === 'failed';
        } else {
          const logicalId = normalizeChallengeId(challengeId);
          isSuccess = completedLogicalSet.has(logicalId) || completedBaseSet.has(challengeId) || allNormalChallengesCompletedByStatus;
          isProcessed = isSuccess;
        }
      } else {
        const intermissionStatus = intermissionStatusMap.get(challengeId);
        if (intermissionStatus) {
          isSuccess = Boolean(intermissionStatus.success);
          isProcessed = Boolean(intermissionStatus.processed || intermissionStatus.success);
        } else {
          isSuccess = completedBaseSet.has(challengeId);
          isProcessed = isSuccess;
        }
      }

      if (isSuccess) {
        successIds.push(challengeId);
        successChallenges.push(challenge);
      }

      if (isProcessed) {
        processedIds.push(challengeId);
        processedChallenges.push(challenge);
      }
    });

    const totalChallenges = flow.length;
    const successRate = totalChallenges > 0
      ? Math.round((successIds.length / totalChallenges) * 100)
      : 0;

    return {
      totalChallenges,
      successCount: successIds.length,
      processedCount: processedIds.length,
      successIds,
      processedIds,
      successChallenges,
      processedChallenges,
      allChallengesProcessed: totalChallenges > 0 && processedIds.length >= totalChallenges,
      successRate,
      completedCount: successIds.length,
      completedIds: successIds,
      completedChallenges: successChallenges,
      completionRate: successRate
    };
  }

  function listInvalidCompletedIds(completedChallenges = [], validChallengeIds = new Set()) {
    const validSet = validChallengeIds instanceof Set
      ? validChallengeIds
      : new Set(validChallengeIds || []);
    const validLogicalSet = new Set(Array.from(validSet).map(normalizeChallengeId).filter(Boolean));

    return (completedChallenges || []).filter(challengeId => {
      if (!challengeId || isIntermissionId(challengeId)) return false;
      return !validSet.has(challengeId) && !validLogicalSet.has(normalizeChallengeId(challengeId));
    });
  }

  function normalizeAlternatives(challenge) {
    if (!challenge || typeof challenge !== 'object') return {};
    if (challenge.alternativas && typeof challenge.alternativas === 'object' && !Array.isArray(challenge.alternativas)) {
      return challenge.alternativas;
    }

    if (Array.isArray(challenge.alternativas)) {
      return Object.fromEntries(
        challenge.alternativas.map((value, index) => [String.fromCharCode(97 + index), value])
      );
    }

    if (Array.isArray(challenge.options)) {
      return Object.fromEntries(
        challenge.options.map((value, index) => [String.fromCharCode(97 + index), value])
      );
    }

    return {};
  }

  function normalizeChallengeData(challenge) {
    if (!challenge || typeof challenge !== 'object') return null;

    const id = getChallengeId(challenge);
    const rawType = challenge.tipo || challenge.type || challenge.kind;
    const tipo = rawType === 'text' || rawType === 'texto' ? 'texto' : 'selecao';
    const titulo = challenge.titulo || challenge.title || '';
    const descricao = challenge.descricao || challenge.description || '';
    const alternativas = normalizeAlternatives(challenge);
    const isPlaceholder = challenge.type === 'unknown'
      || rawType === 'unknown'
      || !titulo
      || (!descricao && Object.keys(alternativas).length === 0);

    return {
      ...challenge,
      id,
      tipo,
      titulo,
      descricao,
      alternativas,
      resposta_correta: challenge.resposta_correta || challenge.correctAnswer || challenge.correct_answer || null,
      xp: Number(challenge.xp ?? challenge.points ?? 0),
      tempo_limite: Number(challenge.tempo_limite ?? challenge.timeLimit ?? challenge.time_limit ?? 300),
      categoria: challenge.categoria || challenge.category || 'Geral',
      isPlaceholder
    };
  }

  return {
    getChallengeId,
    normalizeChallengeId,
    areSameChallenge,
    resolveChallengeIdForCollection,
    isIntermissionId,
    isIntermissionChallenge,
    isLogunChallenge,
    hashString,
    seededShuffle,
    buildPlayableFlow,
    getCanonicalIntermissionInsertAfter,
    normalizeMinigameCompletionId,
    buildLogicalCompletedSet,
    inferLevelFromChallengeId,
    buildCompletedBaseSet,
    buildStatusMap,
    buildIntermissionStatusMap,
    mergeProgressSources,
    calculateLevelProgress,
    getStatusForId,
    listInvalidCompletedIds,
    normalizeChallengeData
  };
});
