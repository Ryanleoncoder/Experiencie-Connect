/**
 * Experience Connect Firebase Loader Module
 * 
 * Purpose: Load public game data from Firebase Firestore
 * - Seasons metadata
 * - Level documents (grouped challenges)
 * - Achievements catalog
 * 
 * Features:
 * - Three-layer caching (sessionStorage → LevelCache → Firestore)
 * - Grouped level structure (1 read per level instead of 10+)
 * - 3-second timeout with local JSON fallback
 * - Schema version validation
 * - Parallel preloading
 * 
 * Security:
 * - Firestore contains only PUBLIC data
 * - No answers, no user progress
 * - Read-only access enforced by Firestore rules
 * 
 */

function firebaseDebugLog(...args) {
  if (typeof window !== 'undefined' && window.CX_DEBUG === true) {
    console.debug(...args);
  }
}

// CONSTANTS

const EXPECTED_SCHEMA_VERSION = 1;
const FIRESTORE_TIMEOUT_MS = 3000;  // 3s for mobile 4G compatibility
const MAX_CACHED_LEVELS = 5;  // Limit: current-2, current-1, current, current+1, current+2
let firestoreModulePromise = null;
const inflightLevelLoads = new Map();
const inflightHomeBundles = new Map();

// GAMESTATE SINGLETON

/**
 * Global game state object
 * Replaces scattered window.__ globals
 */
const GameState = {
  // Firebase reference
  db: null,  // Instância do Firestore
  
  // Dados da temporada
  season: null,
  
  // Desafios do nível atual (selecionados 20 de 30)
  questions: [],
  
  // Pool completo de desafios (todos os 30 desafios)
  allQuestions: [],
  
  // Available achievements
  achievements: [],
  
  // In-memory level cache
  levelCache: {},

  // Cached home bundles by season/setor
  homeBundles: {}
};

// Make GameState globally accessible
window.GameState = GameState;

// INITIALIZATION

/**
 * Initialize Firebase and GameState
 * 
 * 
 * @returns {Promise<void>}
 */
async function initializeApp() {
  try {
    firebaseDebugLog('[Firebase] 🔧 Starting Firebase initialization...');
    firebaseDebugLog('[Firebase] Checking window.firebaseApp:', !!window.firebaseApp);
    firebaseDebugLog('[Firebase] Checking window.firebaseDb:', !!window.firebaseDb);
    
    // Firebase should already be initialized in HTML
    // We just need to get the references
    if (!window.firebaseApp || !window.firebaseDb) {
      console.error('[Firebase] ❌ Firebase not initialized!');
      console.error('[Firebase] window.firebaseApp:', window.firebaseApp);
      console.error('[Firebase] window.firebaseDb:', window.firebaseDb);
      throw new Error('Firebase not initialized. Check HTML script tags.');
    }
    
    if (GameState.db === window.firebaseDb) {
      firebaseDebugLog('[Firebase] Firebase_Loader already initialized for this page');
      return;
    }

    GameState.db = window.firebaseDb;
    GameState.levelCache = GameState.levelCache || {};
    GameState.homeBundles = GameState.homeBundles || {};
    
    firebaseDebugLog('[Firebase] ✅ Firebase_Loader initialized successfully');
    firebaseDebugLog('[Firebase] ✅ GameState ready');
    firebaseDebugLog('[Firebase] Database reference:', GameState.db ? 'OK' : 'MISSING');
    
  } catch (error) {
    console.error('[Firebase] ❌ Initialization failed:', error);
    console.error('[Firebase] Error stack:', error.stack);
    throw error;
  }
}

function getFirestoreModule() {
  if (!firestoreModulePromise) {
    firestoreModulePromise = import('https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js');
  }

  return firestoreModulePromise;
}

function getLevelCacheKey(level, setor, seasonId) {
  return `level_${seasonId}_${setor}_${level}`;
}

function getLevelStateKey(level, setor) {
  return `${setor}_${level}`;
}

function getHomeBundleCacheKey(seasonId, setor) {
  return `home_bundle_${seasonId}_${setor}`;
}

function extractLevelMetadata(fullData = {}, level, setor) {
  return {
    nome: fullData.nome || `Nível ${level}`,
    icone: fullData.icone || (level === 1 ? '🟢' : level === 2 ? '🟡' : '🔴'),
    descricao: fullData.descricao || `Desafios do nível ${level}`,
    nivel: fullData.nivel || level,
    setor: fullData.setor || setor,
    challenge_count: fullData.challenge_count,
    schema_version: fullData.schema_version
  };
}

function hydrateLevelCacheFromBundle(bundle = {}) {
  Object.entries(bundle.levels || {}).forEach(([level, levelData]) => {
    if (!levelData) return;
    GameState.levelCache[getLevelStateKey(level, bundle.setor || levelData.setor || 'CX')] = levelData;
  });
}

// SEASON LOADING

/**
 * Load active season with caching
 * Uses direct document access (no query, no index needed)
 * 
 * 
 * @returns {Promise<Object|null>} Season data or null
 */
async function loadActiveSeason() {
  try {
    firebaseDebugLog('[Firebase] 🔍 Loading active season...');
    
    // Layer 1: Check sessionStorage
    const cached = sessionStorage.getItem('season_active');
    if (cached) {
      firebaseDebugLog('[Firebase] Found cached season in sessionStorage');
      const data = JSON.parse(cached);
      firebaseDebugLog('[Firebase] Cached season schema version:', data.schema_version);
      firebaseDebugLog('[Firebase] Expected schema version:', EXPECTED_SCHEMA_VERSION);
      
      if (data.schema_version === EXPECTED_SCHEMA_VERSION) {
        firebaseDebugLog('[Firebase] ✅ Season loaded from sessionStorage');
        firebaseDebugLog('[Firebase] Season ID:', data.id);
        firebaseDebugLog('[Firebase] Season name:', data.nome);
        GameState.season = data;
        return data;
      } else {
        firebaseDebugLog('[Firebase] ⚠️ Cache invalidated - schema version mismatch');
        sessionStorage.removeItem('season_active');
      }
    } else {
      firebaseDebugLog('[Firebase] No cached season found in sessionStorage');
    }
    
    // Layer 3: Direct document access (no query, no index needed)
    firebaseDebugLog('[Firebase] 📡 Fetching season from Firestore...');
    const { doc, getDoc } = await getFirestoreModule();
    
    // Try S-2025-01 first (correct ID), fallback to "active" for backward compatibility
    firebaseDebugLog('[Firebase] Trying season ID: S-2025-01');
    let docRef = doc(GameState.db, "seasons", "S-2025-01");
    let docSnap = await withTimeout(getDoc(docRef), FIRESTORE_TIMEOUT_MS);
    
    if (!docSnap.exists()) {
      firebaseDebugLog('[Firebase] ⚠️ S-2025-01 not found, trying "active"...');
      docRef = doc(GameState.db, "seasons", "active");
      docSnap = await withTimeout(getDoc(docRef), FIRESTORE_TIMEOUT_MS);
    }
    
    if (!docSnap.exists()) {
      console.error('[Firebase] ❌ No active season found in Firestore');
      console.error('[Firebase] Tried IDs: S-2025-01, active');
      return null;
    }
    
    const season = docSnap.data();
    firebaseDebugLog('[Firebase] ✅ Season loaded from Firestore');
    firebaseDebugLog('[Firebase] Season ID:', season.id);
    firebaseDebugLog('[Firebase] Season name:', season.nome);
    firebaseDebugLog('[Firebase] Total levels:', season.total_levels);
    
    GameState.season = season;
    sessionStorage.setItem('season_active', JSON.stringify(season));
    
    return season;
    
  } catch (error) {
    console.error('[Firebase] ❌ Error loading season:', error);
    console.error('[Firebase] Error type:', error.name);
    console.error('[Firebase] Error message:', error.message);
    console.error('[Firebase] Error stack:', error.stack);
    // Could implement fallback to local JSON here if needed
    throw error;
  }
}

// LEVEL LOADING

/**
 * Load level metadata only (without challenges) for lightweight loading
 * Used in home.js to show locked levels without loading all challenges
 * 
 * @param {string} setor - Sector (CX, EX)
 * @param {string} seasonId - Season ID
 * @returns {Promise<Object>} Level metadata (nome, icone, descricao, etc) without questions array
 */
async function loadLevelMetadata(level, setor, seasonId) {
  try {
    const levelData = await loadLevel(level, setor, seasonId);
    const metadata = extractLevelMetadata(levelData, level, setor);
    firebaseDebugLog(`[Firebase] Level ${setor}_${level} metadata derived from cached level bundle`);
    return metadata;
  } catch (error) {
    console.warn(`[Firebase] Erro ao carregar metadados para nivel ${level}:`, error);
    return extractLevelMetadata({}, level, setor);
  }
}
/**
 * Load level with three-layer caching
 * Cache keys include season ID to prevent stale cache
 * 
 * 
 * @param {string} setor - Sector (CX, EX)
 * @param {string} seasonId - Season ID
 * @returns {Promise<Object>} Level document with questions array
 */
async function loadLevel(level, setor, seasonId) {
  const stateKey = getLevelStateKey(level, setor);
  const cacheKey = getLevelCacheKey(level, setor, seasonId);

  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const data = JSON.parse(cached);
      if (data.schema_version === EXPECTED_SCHEMA_VERSION) {
        firebaseDebugLog(`[Firebase] Level ${stateKey} loaded from sessionStorage`);
        GameState.questions = data.questions;
        GameState.levelCache[stateKey] = data;
        return data;
      }

      firebaseDebugLog('[Firebase] Cache invalidated - schema version mismatch');
      sessionStorage.removeItem(cacheKey);
    }

    if (GameState.levelCache[stateKey]) {
      firebaseDebugLog(`[Firebase] Level ${stateKey} loaded from LevelCache`);
      GameState.questions = GameState.levelCache[stateKey].questions;
      return GameState.levelCache[stateKey];
    }

    if (inflightLevelLoads.has(cacheKey)) {
      firebaseDebugLog(`[Firebase] Reusing inflight level request for ${stateKey}`);
      return inflightLevelLoads.get(cacheKey);
    }

    const levelLoadPromise = (async () => {
      let levelData = null;
      const sbContent = (typeof window !== 'undefined') ? window.SupabaseContent : null;
      if (sbContent && sbContent.isEnabled()) {
        try {
          levelData = await sbContent.loadLevelDoc(seasonId, setor, Number(level));
        } catch (e) {
          console.warn('[Content] Supabase load_level falhou, fallback Firebase:', e && e.message);
          levelData = null;
        }
      }
      if (!levelData) {
        const { doc, getDoc } = await getFirestoreModule();
        const docRef = doc(GameState.db, `seasons/${seasonId}/levels/${stateKey}`);
        const docSnap = await withTimeout(getDoc(docRef), FIRESTORE_TIMEOUT_MS);
        if (!docSnap.exists()) {
          throw new Error(`Level ${stateKey} not found`);
        }
        levelData = docSnap.data();
      }

      GameState.questions = levelData.questions;
      GameState.levelCache[stateKey] = levelData;
      sessionStorage.setItem(cacheKey, JSON.stringify(levelData));
      enforceCacheSizeLimit(seasonId, setor, Number(level));

      firebaseDebugLog(`[Content] Level ${stateKey} pronto (${levelData.challenge_count} questions)`);
      return levelData;
    })();

    inflightLevelLoads.set(cacheKey, levelLoadPromise);
    return await levelLoadPromise;
  } catch (error) {
    console.error('[Firebase] Error loading level:', error);
    throw error;
  } finally {
    inflightLevelLoads.delete(cacheKey);
  }
}

async function loadHomeBundle(seasonId, setor = 'CX', levels = [1, 2, 3]) {
  const cacheKey = getHomeBundleCacheKey(seasonId, setor);
  const normalizedLevels = [...new Set(
    (Array.isArray(levels) ? levels : [1, 2, 3])
      .map(level => Number(level))
      .filter(level => Number.isFinite(level) && level > 0)
  )];
  const levelStateKeys = normalizedLevels.map(level => getLevelStateKey(level, setor));

  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const data = JSON.parse(cached);
      if (data.schema_version === EXPECTED_SCHEMA_VERSION) {
        GameState.homeBundles[cacheKey] = data;
        hydrateLevelCacheFromBundle(data);
        firebaseDebugLog(`[Firebase] Home bundle ${setor}/${seasonId} loaded from sessionStorage`);
        return data;
      }

      sessionStorage.removeItem(cacheKey);
    }

    if (GameState.homeBundles[cacheKey]) {
      hydrateLevelCacheFromBundle(GameState.homeBundles[cacheKey]);
      firebaseDebugLog(`[Firebase] Home bundle ${setor}/${seasonId} loaded from memory`);
      return GameState.homeBundles[cacheKey];
    }

    if (inflightHomeBundles.has(cacheKey)) {
      firebaseDebugLog(`[Firebase] Reusing inflight home bundle for ${setor}/${seasonId}`);
      return inflightHomeBundles.get(cacheKey);
    }

    const bundlePromise = (async () => {
      const dataByStateKey = new Map();
      const sbContent = (typeof window !== 'undefined') ? window.SupabaseContent : null;
      let usedSupabase = false;
      if (sbContent && sbContent.isEnabled()) {
        try {
          await Promise.all(normalizedLevels.map(async (level) => {
            const stateKey = getLevelStateKey(level, setor);
            dataByStateKey.set(stateKey, await sbContent.loadLevelDoc(seasonId, setor, Number(level)));
          }));
          usedSupabase = true;
        } catch (e) {
          console.warn('[Content] Supabase home bundle falhou, fallback Firebase:', e && e.message);
          dataByStateKey.clear();
        }
      }
      if (!usedSupabase) {
        const { collection, query, where, documentId, getDocs } = await getFirestoreModule();
        const levelsRef = collection(GameState.db, `seasons/${seasonId}/levels`);
        const levelQuery = query(levelsRef, where(documentId(), 'in', levelStateKeys));
        const snapshot = await withTimeout(getDocs(levelQuery), FIRESTORE_TIMEOUT_MS);
        snapshot.forEach(docSnap => {
          dataByStateKey.set(docSnap.id, docSnap.data());
        });
      }

      const resolvedLevels = normalizedLevels.map(level => {
        const stateKey = getLevelStateKey(level, setor);
        const levelData = dataByStateKey.get(stateKey);

        if (!levelData) {
          throw new Error(`Level ${stateKey} not found in home bundle`);
        }

        GameState.levelCache[stateKey] = levelData;
        sessionStorage.setItem(getLevelCacheKey(level, setor, seasonId), JSON.stringify(levelData));
        return [String(level), levelData];
      });

      const bundle = {
        seasonId,
        setor,
        schema_version: EXPECTED_SCHEMA_VERSION,
        levels: Object.fromEntries(resolvedLevels)
      };

      GameState.homeBundles[cacheKey] = bundle;
      hydrateLevelCacheFromBundle(bundle);
      sessionStorage.setItem(cacheKey, JSON.stringify(bundle));
      firebaseDebugLog(`[Firebase] Home bundle ${setor}/${seasonId} loaded from Firestore query (${resolvedLevels.length} levels)`);
      return bundle;
    })();

    inflightHomeBundles.set(cacheKey, bundlePromise);
    return await bundlePromise;
  } catch (error) {
    console.error('[Firebase] Error loading home bundle:', error);
    throw error;
  } finally {
    inflightHomeBundles.delete(cacheKey);
  }
}
/**
 * Preload next level in background
 * Cache keys include season ID
 * 
 * 
 * @param {number} currentLevel - Current level number
 * @param {string} setor - Sector
 * @param {string} seasonId - Season ID
 */
async function preloadNextLevel(currentLevel, setor, seasonId) {
  const nextLevel = currentLevel + 1;
  
  if (!GameState.season || nextLevel > GameState.season.total_levels) {
    firebaseDebugLog('[Firebase] Last level reached - no preload');
    return;
  }
  
  const levelKey = `${setor}_${nextLevel}`;
  const cacheKey = `level_${seasonId}_${levelKey}`;
  
  // Skip if already cached
  if (sessionStorage.getItem(cacheKey) || GameState.levelCache[levelKey]) {
    firebaseDebugLog(`[Firebase] Level ${levelKey} already cached - skip preload`);
    return;
  }
  
  try {
    await loadLevel(nextLevel, setor, seasonId);
    firebaseDebugLog(`[Firebase] Level ${levelKey} preloaded`);
  } catch (error) {
    // Silent failure - will load on demand
    firebaseDebugLog(`[Firebase] Preload failed for ${levelKey}`);
  }
}

/**
 * Parallel load current + next level
 * 
 * 
 * @param {number} currentLevel - Current level
 * @param {string} setor - Sector
 * @param {string} seasonId - Season ID
 * @returns {Promise<Array>} [currentLevelData, nextLevelData]
 */
async function loadLevelWithPreload(currentLevel, setor, seasonId) {
  const nextLevel = currentLevel + 1;
  
  if (!GameState.season || nextLevel > GameState.season.total_levels) {
    return [await loadLevel(currentLevel, setor, seasonId), null];
  }
  
  const [current, next] = await Promise.all([
    loadLevel(currentLevel, setor, seasonId),
    loadLevel(nextLevel, setor, seasonId).catch(() => null)
  ]);
  
  firebaseDebugLog('[Firebase] Parallel loading complete');
  return [current, next];
}

// CACHE MANAGEMENT

/**
 * Enforce cache size limit (max 5 levels)
 * Keeps: current-2, current-1, current, current+1, current+2
 * 
 * 
 * @param {string} seasonId - Season ID
 * @param {string} setor - Sector
 * @param {number} currentLevel - Current level number
 */
function enforceCacheSizeLimit(seasonId, setor, currentLevel) {
  const levelsToKeep = [
    currentLevel - 2,  // Dois níveis atrás (para navegação)
    currentLevel - 1,  // Anterior (para navegação para trás)
    currentLevel,      // Atual
    currentLevel + 1,  // Next (preloaded)
    currentLevel + 2   // Backup preload
  ];
  
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    if (key && key.startsWith(`level_${seasonId}_${setor}_`)) {
      const levelNum = parseInt(key.split('_').pop());
      if (!levelsToKeep.includes(levelNum)) {
        sessionStorage.removeItem(key);
        firebaseDebugLog(`[Firebase] Removed old cache: ${key}`);
      }
    }
  }
  
  for (let key in GameState.levelCache) {
    if (key.startsWith(`${setor}_`)) {
      const levelNum = parseInt(key.split('_').pop());
      if (!levelsToKeep.includes(levelNum)) {
        delete GameState.levelCache[key];
      }
    }
  }
}

// ACHIEVEMENTS LOADING

/**
 * Load achievements with caching
 * 
 * 
 * @param {string} setor - Sector
 * @returns {Promise<Array>} Array of achievements
 */
async function loadAchievements(setor) {
  try {
    const cacheKey = `achievements_${setor}`;
    
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      const data = JSON.parse(cached);
      firebaseDebugLog(`[Firebase] Achievements ${setor} loaded from cache`);
      GameState.achievements = data;
      return data;
    }
    
    const { collection, query, where, limit, getDocs } = await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js');
    
    const q = query(
      collection(GameState.db, "achievements"),
      where("setor", "==", setor),
      where("ativo", "==", true),
      limit(50)
    );
    
    const snapshot = await getDocs(q);
    const achievements = [];
    snapshot.forEach(doc => achievements.push(doc.data()));
    
    GameState.achievements = achievements;
    sessionStorage.setItem(cacheKey, JSON.stringify(achievements));
    
    firebaseDebugLog(`[Firebase] ${achievements.length} achievements loaded`);
    return achievements;
    
  } catch (error) {
    console.error('[Firebase] Error loading achievements:', error);
    // Non-blocking - return empty array
    return [];
  }
}

// Fallback system removed as challenges.json is deprecated.

// FUNÇÕES UTILITÁRIAS

/**
 * Add timeout to promise
 * 
 * 
 * @param {number} ms - Timeout in milliseconds
 */
function withTimeout(promise, ms) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Timeout')), ms)
  );
  return Promise.race([promise, timeout]);
}

// EXPORTS

// Tornar funções globalmente acessíveis
window.FirebaseLoader = {
  initializeApp,
  loadActiveSeason,
  loadLevel,
  loadHomeBundle,
  loadLevelMetadata,
  preloadNextLevel,
  loadLevelWithPreload,
  loadAchievements,
  GameState
};

firebaseDebugLog('[Firebase] firebase-loader.js loaded');
