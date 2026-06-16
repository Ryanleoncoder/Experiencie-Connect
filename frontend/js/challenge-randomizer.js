/**
 * Deterministic challenge selection per user, season and level.
 * Intermission games use the persisted phase order when available.
 */

const ProgressFlowApi = (typeof module !== 'undefined' && module.exports)
  ? require('./services/ProgressFlow')
  : (typeof window !== 'undefined' ? window.ProgressFlow : null);
const RANDOMIZER_SELECTION_SCHEMA_VERSION = 4;

function getProgressFlowApi() {
  return ProgressFlowApi || (typeof window !== 'undefined' ? window.ProgressFlow : null);
}

function getSessionValue(key) {
  if (typeof window === 'undefined') return '';

  const sessionValue = window.CxSession?.getSessionValue?.(key);
  if (sessionValue) return sessionValue;

  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(key)) {
      return sessionStorage.getItem(key);
    }
  } catch (error) {
    // Ignore storage access errors and continue with other fallbacks.
  }

  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem(key)) {
      return localStorage.getItem(key);
    }
  } catch (error) {
    // Ignore storage access errors and continue with other fallbacks.
  }

  return '';
}

function getSelectionCacheKey(userId, seasonId, level, setor) {
  return `selection_${seasonId}_${setor}_${level}_${userId}`;
}

function getSelectionIdentityCandidates(userId) {
  const candidates = [];
  const seen = new Set();

  const pushCandidate = (value) => {
    if (typeof value !== 'string') return;
    const normalizedValue = value.trim();
    if (!normalizedValue || seen.has(normalizedValue)) return;
    seen.add(normalizedValue);
    candidates.push(normalizedValue);
  };

  pushCandidate(userId);
  pushCandidate(getSessionValue('cx_logged_in_user'));
  pushCandidate(getSessionValue('cx_ranking_code'));

  return candidates;
}

// HASH FUNCTION

/**
 * Generate deterministic hash from string
 * Uses simple but effective hash algorithm
 * 
 * 
 * @param {string} str - Input string
 * @returns {number} Hash value (32-bit integer)
 */
function hashString(str) {
  let hash = 0;
  
  if (str.length === 0) return hash;
  
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return Math.abs(hash);
}

// SEEDED RANDOM NUMBER GENERATOR

/**
 * Seeded RNG using Linear Congruential Generator (LCG)
 * Provides deterministic pseudo-random numbers
 * 
 * @param {number} seed - Initial seed value
 * @returns {Function} RNG function that returns [0, 1)
 */
function createSeededRNG(seed) {
  let state = seed;
  
  // LCG parameters (from Numerical Recipes)
  const a = 1664525;
  const c = 1013904223;
  const m = Math.pow(2, 32);
  
  return function() {
    state = (a * state + c) % m;
    return state / m;
  };
}

// SEEDED SHUFFLE

/**
 * Fisher-Yates shuffle with seeded RNG
 * Deterministic: same seed = same shuffle order
 * 
 * 
 * @param {Array} array - Array to shuffle (will be modified)
 * @param {number} seed - Seed for RNG
 * @returns {Array} Shuffled array (same reference)
 */
function seededShuffle(array, seed) {
  const rng = createSeededRNG(seed);
  const arr = [...array]; // Create copy to avoid mutating original
  
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  
  return arr;
}

// CHALLENGE SELECTION

/**
 * Select random subset of challenges for user
 * 
 * 
 * @param {Array} allChallenges - Full pool (30 challenges)
 * @param {string} userId - User ID
 * @param {string} seasonId - Season ID
 * @param {number} level - Level number
 * @param {number} count - Number to select (default: 20)
 * @returns {Array} Selected challenges
 */
function selectRandomQuestions(allChallenges, userId, seasonId, level, count = 20) {
  // Validate input
  if (!allChallenges || allChallenges.length === 0) {
    console.error('[Randomizer] No challenges provided');
    return [];
  }

  const progressFlow = getProgressFlowApi();
  if (progressFlow && progressFlow.buildPlayableFlow) {
    const normalCount = allChallenges.filter(challenge => !progressFlow.isIntermissionChallenge(challenge)).length;
    if (normalCount < count) {
      console.warn(`[Randomizer] Only ${normalCount} normal challenges available, requested ${count}`);
    }

    const selectedFlow = progressFlow.buildPlayableFlow(allChallenges, {
      userId,
      seasonId,
      level,
      count
    });

    const selectedNormalCount = selectedFlow.filter(challenge => !progressFlow.isIntermissionChallenge(challenge)).length;
    const intermissionCount = selectedFlow.length - selectedNormalCount;

    return selectedFlow;
  }

  if (allChallenges.length < count) {
    console.warn(`[Randomizer] Only ${allChallenges.length} challenges available, requested ${count}`);
    return allChallenges;
  }
  
  // Generate deterministic seed
  const seedString = `${userId}_${seasonId}_${level}`;
  const seed = hashString(seedString);
  
  // Shuffle with seed
  const shuffled = seededShuffle(allChallenges, seed);
  
  // Select first N challenges
  const selected = shuffled.slice(0, count);
  
  // Sort by ordem field to maintain intended difficulty progression
  selected.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
  
  return selected;
}

// CACHE MANAGEMENT

/**
 * Get cached selection for user
 * 
 * 
 * @param {string} userId - User ID
 * @param {string} seasonId - Season ID
 * @param {number} level - Level number
 * @param {string} setor - Sector
 * @returns {Array|null} Cached selection or null
 */
function getCachedSelection(userId, seasonId, level, setor) {
  const canonicalCacheKey = getSelectionCacheKey(userId, seasonId, level, setor);
  const identityCandidates = getSelectionIdentityCandidates(userId);

  for (const identity of identityCandidates) {
    const cacheKey = getSelectionCacheKey(identity, seasonId, level, setor);
    const cached = sessionStorage.getItem(cacheKey);

    if (!cached) {
      continue;
    }

    try {
      const data = JSON.parse(cached);
      if (data.schema_version !== RANDOMIZER_SELECTION_SCHEMA_VERSION) {
        sessionStorage.removeItem(cacheKey);
        continue;
      }

      if (cacheKey !== canonicalCacheKey) {
        sessionStorage.setItem(canonicalCacheKey, JSON.stringify(data));
        sessionStorage.removeItem(cacheKey);
      }

      return data.questions;
    } catch (error) {
      console.error('[Randomizer] Error parsing cached selection:', error);
      sessionStorage.removeItem(cacheKey);
    }
  }

  return null;
}

/**
 * Cache selection for user
 * 
 * 
 * @param {string} userId - User ID
 * @param {string} seasonId - Season ID
 * @param {number} level - Level number
 * @param {string} setor - Sector
 * @param {Array} questions - Selected questions
 */
function cacheSelection(userId, seasonId, level, setor, questions) {
  const cacheKey = getSelectionCacheKey(userId, seasonId, level, setor);
  const data = {
    questions,
    timestamp: Date.now(),
    schema_version: RANDOMIZER_SELECTION_SCHEMA_VERSION
  };
  
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify(data));
  } catch (error) {
    console.error('[Randomizer] Error caching selection:', error);
  }
}

function buildSelectedFlowFromQuestions(allQuestions, userId, seasonId, level, setor = 'CX', count = 20, metadata = {}) {
  const cached = getCachedSelection(userId, seasonId, level, setor);
  if (cached) {
    if (typeof window !== 'undefined' && window.GameState) {
      window.GameState.questions = cached;
      window.GameState.allQuestions = Array.isArray(allQuestions) ? allQuestions : [];
    }

    return {
      ...metadata,
      level,
      setor,
      questions: cached,
      challenge_count: cached.length,
      total_xp: cached.reduce((sum, q) => sum + (q.xp || 0), 0)
    };
  }

  const selected = selectRandomQuestions(
    Array.isArray(allQuestions) ? allQuestions : [],
    userId,
    seasonId,
    level,
    count
  );

  if (typeof window !== 'undefined' && window.GameState) {
    window.GameState.questions = selected;
    window.GameState.allQuestions = Array.isArray(allQuestions) ? allQuestions : [];
  }

  cacheSelection(userId, seasonId, level, setor, selected);

  return {
    ...metadata,
    level,
    setor,
    questions: selected,
    challenge_count: selected.length,
    total_xp: selected.reduce((sum, q) => sum + (q.xp || 0), 0)
  };
}

// INTEGRATION WITH FIREBASE LOADER

/**
 * Load level with randomization
 * Integrates with Firebase_Loader
 * 
 * 
 * @param {number} level - Level number
 * @param {string} setor - Sector
 * @param {string} seasonId - Season ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Level data with selected questions
 */
async function loadLevelWithRandomization(level, setor, seasonId, userId) {
  // Load full level from Firebase
  const levelData = await window.FirebaseLoader.loadLevel(level, setor, seasonId);

  return buildSelectedFlowFromQuestions(
    levelData.questions,
    userId,
    seasonId,
    level,
    setor,
    20,
    levelData
  );
}

/**
 * Constroi o flow do nivel a partir da PHASE persistida na VPS (fonte de verdade da ordem).
 * Mapeia cada no da phase para o objeto de questao COMPLETO do Firebase por id (sel-/lg-/ig-).
 * Cai no randomizer local (buildSelectedFlowFromQuestions) APENAS se a phase nao carregar.
 * @returns {Promise<Object>} { ...metadata, questions, challenge_count, total_xp, phase_session_id }
 */
async function buildFlowFromPhase(allQuestions, userId, seasonId, level, setor = 'CX', metadata = {}, options = {}) {
  const create = options.create !== false; // app: create:false (so LE); challenge: cria/usa
  try {
    const svc = (typeof window !== 'undefined' && window.IntermissionFlowService)
      ? new window.IntermissionFlowService()
      : null;
    const phase = svc
      ? await svc.loadPhaseSession({ userId, seasonId, level, setor, create })
      : null;
    const nodes = phase && Array.isArray(phase.nodes) ? phase.nodes : null;

    if (nodes && nodes.length > 0) {
      const byId = new Map((Array.isArray(allQuestions) ? allQuestions : []).map(q => [q.id, q]));
      const ordered = [...nodes]
        .sort((a, b) => Number(a.order_index ?? 0) - Number(b.order_index ?? 0))
        .map(node => {
          const id = node.type === 'game'
            ? (node.flow_challenge_id || node.challenge_id || node.id)
            : (node.content_id || node.challenge_id || node.id);
          // A phase foi construida do nivel do Firebase: o id sempre existe no pool de conteudo.
          return byId.get(id) || {
            id,
            type: node.type === 'game' ? 'intermission' : 'challenge',
            ordem: Number(node.order_index ?? 0) + 1
          };
        });

      if (typeof window !== 'undefined' && window.GameState) {
        window.GameState.questions = ordered;
        window.GameState.allQuestions = Array.isArray(allQuestions) ? allQuestions : [];
      }

      return {
        ...metadata,
        level,
        setor,
        questions: ordered,
        challenge_count: ordered.length,
        total_xp: ordered.reduce((sum, q) => sum + (q.xp || 0), 0),
        phase_session_id: phase.phase_session_id || null
      };
    }
    console.warn('[Randomizer] phase sem nos; usando selecao local (fallback)');
  } catch (error) {
    console.warn('[Randomizer] falha ao consumir phase; usando selecao local (fallback):', error?.message);
  }
  // Fallback controlado: nunca quebra o render (mas registra que nao consumiu a phase).
  return buildSelectedFlowFromQuestions(allQuestions, userId, seasonId, level, setor, 20, metadata);
}

// EXPORTS

const ChallengeRandomizer = {
  hashString,
  seededShuffle,
  selectRandomQuestions,
  getCachedSelection,
  cacheSelection,
  buildSelectedFlowFromQuestions,
  buildFlowFromPhase,
  loadLevelWithRandomization
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChallengeRandomizer;
}

if (typeof window !== 'undefined') {
  window.ChallengeRandomizer = ChallengeRandomizer;
}
