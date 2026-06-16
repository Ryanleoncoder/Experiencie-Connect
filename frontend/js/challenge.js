const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function challengeDebugLog(...args) {
    if (typeof window !== 'undefined' && window.CX_DEBUG === true) {
        console.debug(...args);
    }
}
const CX_AML_SYMBOLS = {
    ec:       '<text x="14" y="19" font-family="DM Sans" font-weight="800" font-size="13" fill="currentColor" stroke="none" text-anchor="middle" class="aml-letters">EC</text>',
    sentury:  '<rect x="6" y="9" width="16" height="12" rx="3" class="aml-draw" style="--len:60"/><line x1="14" y1="5" x2="14" y2="9" class="aml-draw" style="--len:6"/><circle cx="14" cy="4" r="1.4" fill="currentColor" stroke="none"/><circle cx="10.5" cy="15" r="1.3" fill="currentColor" stroke="none"/><circle cx="17.5" cy="15" r="1.3" fill="currentColor" stroke="none"/>',
    thinking: '<rect x="6" y="9" width="16" height="12" rx="3" class="aml-draw" style="--len:60"/><line x1="14" y1="5" x2="14" y2="9"/><circle cx="14" cy="4" r="1.4" fill="currentColor" stroke="none"/><line x1="10" y1="15" x2="12" y2="15" class="aml-draw" style="--len:3"/><line x1="16" y1="15" x2="18" y2="15" class="aml-draw" style="--len:3"/>',
    check:    '<polyline points="6,14.5 12,20 22,8" class="aml-draw" style="--len:26"/>'
};
const CX_AML_SPARK = '<svg class="aml-spark" viewBox="0 0 28 28"><line x1="14" y1="1" x2="14" y2="4"/><line x1="14" y1="24" x2="14" y2="27"/><line x1="1" y1="14" x2="4" y2="14"/><line x1="24" y1="14" x2="27" y2="14"/><line x1="5" y1="5" x2="7" y2="7"/><line x1="21" y1="21" x2="23" y2="23"/><line x1="23" y1="5" x2="21" y2="7"/><line x1="7" y1="21" x2="5" y2="23"/></svg>';
const CX_AML_IA_FLOW = ['ec', 'sentury', 'thinking'];

let _submitAmlGen = 0;

function cxAmlDrawOne(stage, sym, onDone) {
    const gen = _submitAmlGen;
    stage.innerHTML =
        '<div style="position:relative;width:28px;height:28px">' +
        '<svg class="aml-sym" viewBox="0 0 28 28">' + CX_AML_SYMBOLS[sym] + '</svg>' +
        CX_AML_SPARK + '</div>';
    const wrap = stage.firstChild;
    const svg = wrap.querySelector('.aml-sym');
    const spark = wrap.querySelector('.aml-spark');
    setTimeout(() => {
        if (_submitAmlGen !== gen) return;
        svg.classList.add('aml-pulse');
        if (spark) spark.classList.add('on');
        setTimeout(() => {
            if (_submitAmlGen !== gen) return;
            onDone();
        }, 360);
    }, 420);
}

function startSubmitAml(stage, flow) {
    _submitAmlGen++;
    const gen = _submitAmlGen;
    let idx = 0;
    function step() {
        if (_submitAmlGen !== gen) return;
        cxAmlDrawOne(stage, flow[idx % flow.length], step);
        idx++;
    }
    step();
}

function stopSubmitAml() {
    _submitAmlGen++;
}

let questions = [];
let currentChallengeId = null;
let challengeOrderIndex = 0;
let challengeTotalInLevel = 1;
let nextChallengeId = null;
let intermissionManifest = null;
let nextFlowNode = null;
let intermissionFlowService = null;
let intermissionGameRuntime = null;
let intermissionGameModeActive = false;
let mysteryProgressBar = null;
let currentLevelChallenges = [];
let currentPhaseSessionId = null;
let challengeAppContext = null;
let isNavigatingInPage = false;

let currentQuestion = 0;
let totalXP = 0;
let correctCount = 0;
let selectedOption = null;
let answered = false;
let timerInterval = null;
let timeLeft = 120;
let totalTimeUsed = 0;
let attempts = 0;
const maxAttempts = 3;
const ANSWER_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

const XP_MULTIPLIERS = [1.0, 0.7, 0.4]; // 100%, 70%, 40%

const domCache = {
    timerDisplay: null,
    timer: null,
    feedbackOverlay: null,
    submitBtn: null,
    nextBtn: null,
    xpCount: null,
    attemptsIndicator: null,
    attemptsText: null,
    questionTitle: null,
    questionDesc: null,
    optionsGrid: null,
    textAnswerArea: null,
    textAnswer: null,
    charCount: null,
    actionBar: null,
    nextBar: null,
    feedbackIconCorrect: null,
    feedbackIconWrong: null,
    feedbackTitle: null,
    feedbackText: null,
    feedbackXp: null,
    completionOverlay: null,
    compCorrect: null,
    compXp: null,
    compTime: null,
    questionCard: null,
    progressCurrent: null,
    progressTotal: null,
    questionNumber: null,
    questionPoints: null,
    progressFill: null,
    header: null
};

function resetDomCache() {
    Object.keys(domCache).forEach(key => {
        domCache[key] = null;
    });
}

function setChallengeHydrating(isHydrating) {
    const hydrating = Boolean(isHydrating);
    document.body.classList.toggle('challenge-hydrating', hydrating);

    const loading = document.getElementById('challenge-loading');
    if (loading) {
        loading.setAttribute('aria-hidden', hydrating ? 'false' : 'true');
        loading.setAttribute('aria-busy', hydrating ? 'true' : 'false');
    }
}

function setChallengeTransitioning(isTransitioning) {
    document.body.classList.toggle('challenge-transitioning', Boolean(isTransitioning));
}

function buildLocalChallengeStatusMap(progressState) {
    const statusMap = new Map();
    (progressState?.failedChallenges || []).forEach(challengeId => {
        if (!challengeId) return;
        statusMap.set(challengeId, {
            challenge_id: challengeId,
            status: 'failed'
        });
    });
    return statusMap;
}

function getProgressBarState(challengeStatusMap = null) {
    const storage = getStorageType();
    const loggedInUser = storage.getItem('cx_logged_in_user');
    const users = getUsersData();
    const user = users[loggedInUser] || {};
    const progressFlow = window.ProgressFlow || null;
    const mergedProgress = progressFlow?.mergeProgressSources
        ? progressFlow.mergeProgressSources(user, window.progressSync?.lastSyncedState || {})
        : null;
    const completedChallenges = mergedProgress
        ? Array.from(
            progressFlow?.buildCompletedBaseSet
                ? progressFlow.buildCompletedBaseSet(
                    mergedProgress.completedChallenges,
                    mergedProgress.completedMinigames
                )
                : mergedProgress.completedChallenges
        )
        : (user?.completedChallenges || []);
    const effectiveStatusMap = buildLocalChallengeStatusMap(mergedProgress || user);

    if (challengeStatusMap instanceof Map) {
        challengeStatusMap.forEach((value, key) => {
            effectiveStatusMap.set(key, value);
        });
    }

    return {
        completedChallenges,
        challengeStatusMap: effectiveStatusMap
    };
}

function getLevelFromChallengeId(challengeId, fallbackLevel = 1) {
    const inferredLevel = window.ProgressFlow?.inferLevelFromChallengeId?.(challengeId);
    return inferredLevel || fallbackLevel;
}

function getProgressFlowApi() {
    return window.ProgressFlow || null;
}

function normalizeChallengeId(challengeId) {
    return getProgressFlowApi()?.normalizeChallengeId?.(challengeId) || challengeId;
}

function areSameLogicalChallenge(leftChallengeId, rightChallengeId) {
    return getProgressFlowApi()?.areSameChallenge?.(leftChallengeId, rightChallengeId)
        || leftChallengeId === rightChallengeId;
}

function resolveChallengeIdFromSelection(challengeId, selection, source = 'selection') {
    const resolvedId = window.ProgressFlow?.resolveChallengeIdForCollection?.(selection, challengeId) || null;
    if (resolvedId && resolvedId !== challengeId) {
        logChallengeTrace('log', 'Resolved logical challenge id to selected variant', {
            requestedId: challengeId,
            resolvedId,
            source
        });
    }
    return resolvedId;
}

function isChallengeDebugEnabled() {
    return sessionStorage.getItem('cx_debug_challenge_validation') === '1'
        || window.__CX_DEBUG_CHALLENGE__ === true;
}

function logChallengeTrace(level, message, details = {}, always = false) {
    if (!always && !isChallengeDebugEnabled()) {
        return;
    }

    console[level](`[ChallengeTrace] ${message}`, details);
}

function getCachedSeasonId() {
    if (window.currentLevelMetadata?.seasonId) {
        return window.currentLevelMetadata.seasonId;
    }

    try {
        const rawSeason = sessionStorage.getItem('season_active');
        if (!rawSeason) {
            return 'S-2025-01';
        }

        const parsedSeason = JSON.parse(rawSeason);
        return parsedSeason?.id || 'S-2025-01';
    } catch (error) {
        return 'S-2025-01';
    }
}

function getChallengeSelectionContext({ loggedInUser, userId = null, level, seasonId = 'S-2025-01', setor = 'CX', fallbackSelection = null } = {}) {
    if (Array.isArray(fallbackSelection) && fallbackSelection.length > 0) {
        return {
            selection: fallbackSelection,
            source: 'firebase'
        };
    }

    if (Array.isArray(window.currentLevelChallenges) && window.currentLevelChallenges.length > 0) {
        const hasMatchingLevel = window.currentLevelChallenges.some(challenge =>
            getLevelFromChallengeId(challenge?.id || challenge?.challenge_id) === Number(level)
        );

        if (hasMatchingLevel) {
            return {
                selection: window.currentLevelChallenges,
                source: 'memory'
            };
        }
    }

    const selectionUserId = userId || loggedInUser;
    const cachedSelection = window.ChallengeRandomizer?.getCachedSelection?.(
        selectionUserId,
        seasonId,
        Number(level),
        setor
    );

    if (Array.isArray(cachedSelection) && cachedSelection.length > 0) {
        return {
            selection: cachedSelection,
            source: 'cache'
        };
    }

    return {
        selection: [],
        source: 'none'
    };
}

function resolveChallengeIdForContext(challengeId, context = {}) {
    const selectionContext = getChallengeSelectionContext(context);
    return {
        resolvedId: resolveChallengeIdFromSelection(
            challengeId,
            selectionContext.selection,
            selectionContext.source
        ),
        selectionSource: selectionContext.source
    };
}

function replaceChallengeHistoryId(challengeId) {
    if (!challengeId || !window.history?.replaceState) {
        return;
    }

    window.history.replaceState(
        { challengeId },
        '',
        buildChallengeTargetWithPhase(challengeId)
    );
}

function getChallengeStatus(statusMap, challengeId) {
    if (!(statusMap instanceof Map) || !challengeId) {
        return null;
    }

    return statusMap.get(challengeId) || statusMap.get(normalizeChallengeId(challengeId)) || null;
}

function hasCompletedChallenge(completedChallenges, challengeId) {
    return Array.isArray(completedChallenges)
        && completedChallenges.some(completedId => areSameLogicalChallenge(completedId, challengeId));
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

function shouldPreferStatusAlias(currentEntry, nextEntry) {
    if (!currentEntry) return true;

    const currentRank = getStatusRank(currentEntry.status);
    const nextRank = getStatusRank(nextEntry?.status);
    if (nextRank !== currentRank) {
        return nextRank > currentRank;
    }

    return Number(nextEntry?.attempts_used || 0) > Number(currentEntry?.attempts_used || 0);
}

function getProgressUserId(user = null) {
    const syncedUserId = window.progressSync?.lastSyncedState?.user_id;
    if (syncedUserId) {
        return syncedUserId;
    }

    if (user?.id) {
        return user.id;
    }

    const storage = getStorageType();
    const loggedInUser = storage.getItem('cx_logged_in_user');
    const users = getUsersData();
    return users[loggedInUser]?.id || null;
}

function getChallengeRandomizationUserId(user = null) {
    return getProgressUserId(user)
        || user?.id
        || window.CxSession?.getSessionValue?.('cx_ranking_code')
        || window.CxSession?.getSessionValue?.('cx_logged_in_user')
        || sessionStorage.getItem('cx_logged_in_user')
        || 'anonymous';
}

function getCxSessionToken() {
    return window.CxSession?.getSessionValue?.('cx_session_token') || sessionStorage.getItem('cx_session_token') || localStorage.getItem('cx_session_token') || '';
}

function buildProtectedHeaders(extraHeaders = {}) {
    const token = getCxSessionToken();
    return token
        ? { ...extraHeaders, Authorization: `Bearer ${token}` }
        : { ...extraHeaders };
}

function getPhaseSessionIdFromUrl(search = window.location.search) {
    try {
        return new URLSearchParams(search || '').get('phase_session_id') || null;
    } catch (error) {
        return null;
    }
}

function getCurrentPhaseSessionId() {
    currentPhaseSessionId = getPhaseSessionIdFromUrl() || currentPhaseSessionId;
    return currentPhaseSessionId;
}

function setCurrentPhaseSessionId(phaseSessionId) {
    if (phaseSessionId) {
        currentPhaseSessionId = phaseSessionId;
    }
    return currentPhaseSessionId;
}

function buildChallengeTargetWithPhase(challengeId) {
    const query = new URLSearchParams({ id: challengeId });
    const phaseSessionId = getCurrentPhaseSessionId();
    if (phaseSessionId) {
        query.set('phase_session_id', phaseSessionId);
    }
    return `challenge.html?${query.toString()}`;
}

function appendPhaseSessionToTarget(target) {
    const phaseSessionId = getCurrentPhaseSessionId();
    if (!target || !phaseSessionId) return target;

    try {
        const url = new URL(target, window.location.href);
        const isChallengeTarget = url.pathname.endsWith('/challenge.html') || url.pathname.endsWith('/challenge');
        if (!isChallengeTarget || url.searchParams.get('game_session_id')) {
            return target;
        }

        if (!url.searchParams.get('phase_session_id')) {
            url.searchParams.set('phase_session_id', phaseSessionId);
        }

        return `${url.pathname.split('/').pop()}${url.search}${url.hash}`;
    } catch (error) {
        return target;
    }
}

async function loadServerChallengeStatusMap(seasonId = 'S-2025-01') {
    const statusMap = new Map();
    const token = getCxSessionToken();
    if (!token) {
        console.warn('[Challenge] Missing session token, cannot load server challenge status');
        return statusMap;
    }

    const response = await fetch(`/api/user-flow-status?seasonId=${encodeURIComponent(seasonId || 'S-2025-01')}`, {
        method: 'GET',
        headers: buildProtectedHeaders({ Accept: 'application/json' }),
        signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
        throw new Error(`status_api_${response.status}`);
    }

    const data = await response.json();
    const challengeStatuses = Array.isArray(data?.challenge_statuses) ? data.challenge_statuses : [];
    const intermissionStatuses = Array.isArray(data?.intermission_statuses) ? data.intermission_statuses : [];
    challengeStatuses.forEach(item => {
        if (!item?.challenge_id) return;

        statusMap.set(item.challenge_id, item);

        const normalizedId = normalizeChallengeId(item.challenge_id);
        if (normalizedId && normalizedId !== item.challenge_id) {
            const currentAlias = statusMap.get(normalizedId);
            if (shouldPreferStatusAlias(currentAlias, item)) {
                statusMap.set(normalizedId, {
                    ...item,
                    challenge_id: normalizedId,
                    canonical_challenge_id: item.challenge_id
                });
            }
        }
    });
    intermissionStatuses.forEach(item => {
        if (!item?.challenge_id) return;

        statusMap.set(item.challenge_id, {
            ...item,
            status: item.processed === false ? 'in_progress' : 'completed',
            processed: item.processed !== false,
            intermission_game: true
        });
    });

    return statusMap;
}

function getCachedElement(key, selector) {
    if (!domCache[key]) {
        domCache[key] = document.getElementById(selector);
    }
    return domCache[key];
}

function cleanupChallenge() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
        challengeDebugLog('[Challenge] Timer cleared on navigation');
    }

    // CORREÇÃO DE BUG 12.3.4: Limpar dados de desafio pré-carregados
    if (window.currentLevelChallenges) {
        window.currentLevelChallenges = null;
        challengeDebugLog('[Challenge] Cleaned up pre-loaded challenge data');
    }
    if (window.currentLevelMetadata) {
        window.currentLevelMetadata = null;
        challengeDebugLog('[Challenge] Cleaned up level metadata');
    }
    window.progressSync?.releaseChallengeLock?.();
}

window.addEventListener('beforeunload', cleanupChallenge);

let logumModeActive = false;
let logumSplashShown = false;
let logumCompletionInProgress = false;

function activateLogumMode() {
    if (logumModeActive) return; // Já ativo

    logumModeActive = true;

    const bgEffects = document.getElementById('bg-effects');
    const progressBar = document.getElementById('challenge-progress-bar');

    if (bgEffects) bgEffects.classList.add('logum-mode');
    if (progressBar) progressBar.classList.add('logum-mode');

    // Mostrar tela de apresentação apenas uma vez por sessão
    if (!logumSplashShown) {
        showLogumSplash();
        logumSplashShown = true;
    }
}

function deactivateLogumMode() {
    logumModeActive = false;

    const bgEffects = document.getElementById('bg-effects');
    const progressBar = document.getElementById('challenge-progress-bar');

    if (bgEffects) bgEffects.classList.remove('logum-mode');
    if (progressBar) progressBar.classList.remove('logum-mode');
}

function showLogumSplash() {
    const splash = document.getElementById('logum-splash');
    if (!splash) return;

    splash.classList.add('show');

    setTimeout(() => {
        splash.classList.remove('show');
    }, 2500);
}

function updateAttemptsCard() {
    return;
}

function getStorageType() {
    return sessionStorage;
}

function getUsersData() {
    const storage = getStorageType();
    return JSON.parse(storage.getItem('cx_users') || '{}');
}

function saveUsersData(users) {
    const storage = getStorageType();
    storage.setItem('cx_users', JSON.stringify(users));
}

function queueLogumProgressSync({
    awarded,
    answer,
    visualCorrect,
    triggerCriticalEvent = false,
    logPrefix = '[Challenge] Logum progress queued for sync'
} = {}) {
    const progress = window.progressSync;

    if (!progress || typeof progress.queueChange !== 'function') {
        console.warn('[Challenge] ProgressSyncService unavailable, progress saved locally only');
        return false;
    }

    progress.queueChange('xp_gain', {
        amount: awarded || 0,
        source: 'logun_challenge',
        challenge_id: currentChallengeId
    });

    progress.queueChange('challenge_complete', {
        challenge_id: currentChallengeId,
        challenge_type: 'logun'
    });

    const attemptRecord = {
        challenge_id: currentChallengeId,
        timestamp: new Date().toISOString(),
        correct: true,
        time_used: totalTimeUsed * 1000,
        score: awarded || 0
    };

    if (typeof visualCorrect === 'boolean') {
        attemptRecord.logum_visual_correct = visualCorrect;
        attemptRecord.logum_completed = true;
    }

    if (answer !== undefined) {
        attemptRecord.answer = answer;
    }

    progress.queueChange('attempt_record', attemptRecord);

    if (triggerCriticalEvent && typeof progress.onCriticalEvent === 'function') {
        progress.onCriticalEvent();
    }

    challengeDebugLog(logPrefix);
    return true;
}

function getIntermissionFlowService() {
    if (!window.IntermissionFlowService) return null;
    if (!intermissionFlowService) {
        intermissionFlowService = new window.IntermissionFlowService();
    }
    return intermissionFlowService;
}

async function ensurePhaseSessionForLevel({ loggedInUser, user = null, seasonId, level, setor = 'CX', force = false } = {}) {
    const service = getIntermissionFlowService();
    if (!service?.loadPhaseSession || !seasonId || !level) return null;

    try {
        const phaseSession = await service.loadPhaseSession({
            userId: getChallengeRandomizationUserId(user) || loggedInUser || 'auth',
            seasonId,
            level,
            setor,
            force
        });

        if (phaseSession?.phase_session_id) {
            setCurrentPhaseSessionId(phaseSession.phase_session_id);
            intermissionManifest = phaseSession;

            try {
                const url = new URL(window.location.href);
                if (!url.searchParams.get('phase_session_id')) {
                    url.searchParams.set('phase_session_id', phaseSession.phase_session_id);
                    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
                    challengeDebugLog('[Challenge] URL updated with phase_session_id:', phaseSession.phase_session_id);
                }
            } catch (urlError) {
                console.warn('[Challenge] Failed to update URL with phase_session_id:', urlError);
            }

            return phaseSession;
        }
    } catch (error) {
        console.warn('[Challenge] Phase session unavailable; falling back when possible:', error);
    }

    return null;
}

function initializeMysteryProgressBar(challengeStatusMap = null) {
    if (!window.MysteryProgressBar) {
        console.warn('[Challenge] MysteryProgressBar component not available');
        return;
    }

    if (!intermissionManifest && currentLevelChallenges.length === 0) {
        console.warn('[Challenge] Cannot initialize MysteryProgressBar without manifest or local challenges');
        return;
    }

    const progressBarState = getProgressBarState(challengeStatusMap);

    // Converte o manifesto em fases ou recorre a desafios locais quando o VPS está indisponível.
    const phases = intermissionManifest
        ? window.MysteryProgressBar.fromIntermissionManifest(
            intermissionManifest,
            progressBarState.completedChallenges,
            currentChallengeId,
            progressBarState.challengeStatusMap
        )
        : window.MysteryProgressBar.fromChallengeList(
            currentLevelChallenges,
            progressBarState.completedChallenges,
            currentChallengeId,
            progressBarState.challengeStatusMap
        );

    if (!mysteryProgressBar) {
        mysteryProgressBar = new window.MysteryProgressBar('mystery-progress-bar');
        // Make it globally accessible for game runtime
        window.mysteryProgressBar = mysteryProgressBar;
    }

    mysteryProgressBar.update(phases);
    challengeDebugLog('[Challenge] MysteryProgressBar initialized with', phases.length, 'phases');
}

async function loadIntermissionManifestForLevel({ loggedInUser, seasonId, level, setor = 'CX', allLevelChallenges, force = false }) {
    currentLevelChallenges = Array.isArray(allLevelChallenges) ? allLevelChallenges : [];
    const service = getIntermissionFlowService();
    if (!service) {
        initializeMysteryProgressBar();
        return null;
    }

    try {
        const phaseSession = await ensurePhaseSessionForLevel({
            loggedInUser,
            seasonId,
            level,
            setor,
            force
        });

        if (phaseSession) {
            initializeMysteryProgressBar();
            return phaseSession;
        }
    } catch (error) {
        console.warn('[Challenge] Phase session load failed:', error);
    }

    try {
        const manifest = await service.loadManifest({
            userId: loggedInUser,
            seasonId,
            level,
            setor,
            challengeIds: currentLevelChallenges.map(challenge => challenge.id).filter(Boolean),
            force
        });

        intermissionManifest = manifest;

        initializeMysteryProgressBar();

        return manifest;
    } catch (error) {
        console.warn('[Challenge] Intermission manifest unavailable; continuing without games:', error);
        intermissionManifest = null;
        initializeMysteryProgressBar();
        return null;
    }
}

function isFlowNodeCompleted(node, completedChallenges, challengeStatusMap) {
    return window.IntermissionFlow?.isNodeCompleted
        ? window.IntermissionFlow.isNodeCompleted(node, completedChallenges, challengeStatusMap)
        : false;
}

function findFirstAvailableFlowNode(completedChallenges, challengeStatusMap) {
    if (!intermissionManifest || !window.IntermissionFlow?.findFirstAvailableNode) return null;
    return window.IntermissionFlow.findFirstAvailableNode(intermissionManifest, completedChallenges, challengeStatusMap);
}

function findNextAvailableFlowNode(completedChallenges, challengeStatusMap) {
    if (!intermissionManifest || !window.IntermissionFlow?.findNextAvailableNodeAfterChallenge) return null;
    return window.IntermissionFlow.findNextAvailableNodeAfterChallenge(
        intermissionManifest,
        currentChallengeId,
        completedChallenges,
        challengeStatusMap
    );
}

function getFlowNavigationTarget(node) {
    return window.IntermissionFlow?.buildNavigationTarget?.(node) || null;
}

function hardNavigateToTarget(target) {
    window.location.href = target;
}

function getChallengeIdFromNavigationTarget(target) {
    if (!target) return null;

    try {
        const url = new URL(target, window.location.href);
        const path = url.pathname.replace(/\/+$/, '');
        const isChallengePath = path.endsWith('/challenge') || path.endsWith('/challenge.html') || path === '';
        return isChallengePath ? url.searchParams.get('id') : null;
    } catch (error) {
        const params = new URLSearchParams(String(target).split('?')[1] || '');
        return params.get('id');
    }
}

function shouldBlockChallengeRedirect(targetChallengeId, reason, details = {}) {
    const normalizedCurrentId = normalizeChallengeId(currentChallengeId);
    const normalizedRedirectId = normalizeChallengeId(targetChallengeId);

    if (!normalizedCurrentId || !normalizedRedirectId || normalizedCurrentId !== normalizedRedirectId) {
        return false;
    }

    console.warn('[Challenge] Redirect blocked because it points to the same logical challenge', {
        event: 'challenge_redirect_loop_blocked',
        reason,
        challengeId: currentChallengeId,
        redirectTargetId: targetChallengeId,
        normalizedCurrentId,
        normalizedRedirectId,
        ...details
    });
    logChallengeTrace('warn', 'Redirect blocked because it points to the same logical challenge', {
        event: 'challenge_redirect_loop_blocked',
        reason,
        challengeId: currentChallengeId,
        redirectTargetId: targetChallengeId,
        normalizedCurrentId,
        normalizedRedirectId,
        ...details
    }, true);

    return true;
}

function navigateToChallengeId(targetChallengeId, reason, details = {}) {
    if (!targetChallengeId || shouldBlockChallengeRedirect(targetChallengeId, reason, details)) {
        return false;
    }

    hardNavigateToTarget(buildChallengeTargetWithPhase(targetChallengeId));
    return true;
}

function navigateToFlowTarget(target, reason, details = {}) {
    const targetChallengeId = getChallengeIdFromNavigationTarget(target);
    if (targetChallengeId && shouldBlockChallengeRedirect(targetChallengeId, reason, details)) {
        return false;
    }

    hardNavigateToTarget(appendPhaseSessionToTarget(target));
    return true;
}

function resetChallengeStateForLoad({ preserveCompletionOverlay = false } = {}) {
    cleanupChallenge();

    questions = [];
    currentQuestion = 0;
    totalXP = 0;
    correctCount = 0;
    selectedOption = null;
    answered = false;
    attempts = 0;
    timeLeft = 120;
    totalTimeUsed = 0;
    isProcessingNext = false;
    logumCompletionInProgress = false;

    const feedbackOverlay = getCachedElement('feedbackOverlay', 'feedback-overlay');
    if (feedbackOverlay) feedbackOverlay.classList.remove('show');

    if (!preserveCompletionOverlay) {
        const completionOverlay = getCachedElement('completionOverlay', 'completion-overlay');
        if (completionOverlay) completionOverlay.classList.remove('show');
    }

    const nextBtn = getCachedElement('nextBtn', 'btn-next');
    if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.style.opacity = '';
        nextBtn.style.cursor = '';
        nextBtn.dataset.retry = 'false';
        nextBtn.dataset.exhausted = 'false';
    }

    const submitBtn = getCachedElement('submitBtn', 'btn-submit');
    if (submitBtn) {
        stopSubmitAml();
        submitBtn.classList.remove('loading');
        submitBtn.disabled = true;
    }
}

async function navigateToChallengeInPage(challengeId, target, shouldAnimate = false) {
    if (!challengeId || isNavigatingInPage) return;

    const nextTarget = appendPhaseSessionToTarget(target || buildChallengeTargetWithPhase(challengeId));
    isNavigatingInPage = true;
    setChallengeTransitioning(true);

    try {
        if (window.history?.pushState) {
            window.history.pushState({ challengeId }, '', nextTarget);
        }

        await loadChallengeById(challengeId, {
            animate: shouldAnimate,
            preserveCompletionOverlay: false
        });

        const savingIndicator = document.getElementById('saving-indicator');
        if (savingIndicator) savingIndicator.remove();

        const completionOverlay = getCachedElement('completionOverlay', 'completion-overlay');
        if (completionOverlay) completionOverlay.classList.remove('show');
    } catch (error) {
        console.error('[Challenge] In-page navigation failed, falling back to hard navigation:', error);
        hardNavigateToTarget(nextTarget);
    } finally {
        setChallengeTransitioning(false);
        isNavigatingInPage = false;
    }
}

async function navigateToNextNode() {
    const target = getFlowNavigationTarget(nextFlowNode);
    const shouldAnimate = true;
    const targetChallengeId = nextFlowNode?.type === 'challenge'
        ? nextFlowNode.challenge_id
        : getChallengeIdFromNavigationTarget(target);

    if (targetChallengeId) {
        await navigateToChallengeInPage(targetChallengeId, target || buildChallengeTargetWithPhase(targetChallengeId), shouldAnimate);
        return;
    }

    if (target) {
        hardNavigateToTarget(appendPhaseSessionToTarget(target));
        return;
    }

    if (nextChallengeId) {
        await navigateToChallengeInPage(nextChallengeId, buildChallengeTargetWithPhase(nextChallengeId), shouldAnimate);
        return;
    }

    showCompletion();
}

function hasNextFlowNode() {
    return !!(nextFlowNode || nextChallengeId);
}

async function startInlineIntermissionGameMode(gameSessionId, loggedInUser) {
    intermissionGameModeActive = true;
    cleanupChallenge();
    deactivateLogumMode();

    if (!window.InlineIntermissionGame) {
        console.error('[Challenge] InlineIntermissionGame runtime unavailable');
        window.location.href = '/app?reason=intermission_runtime_unavailable';
        return;
    }

    intermissionGameRuntime = new window.InlineIntermissionGame({
        sessionId: gameSessionId,
        loggedInUser,
        token: window.IntermissionFlow?.getStoredSessionToken?.(),
        apiBase: window.CXGAME_VPS_API_BASE || window.__APP_CONFIG__?.CXGAME_VPS_API_BASE || 'https://api.expconnect.com.br'
    });

    await intermissionGameRuntime.start();
}

function initializeLogunModalIntegration() {
    if (window.LogunModalIntegration && !window.logunModalInstance) {
        challengeDebugLog('[Challenge] Initializing LogunModalIntegration...');
        window.logunModalInstance = new window.LogunModalIntegration({
            apiEndpoint: 'https://api.expconnect.com.br/logun/validate',
            onValidationComplete: (result) => {
                challengeDebugLog('[Challenge] Logun validation complete:', result);
            },
            onValidationError: (error) => {
                console.error('[Challenge] Logun validation error:', error);
            }
        });
        challengeDebugLog('[Challenge] LogunModalIntegration initialized');
    }
}

async function initializeChallengeApp() {
    if (challengeAppContext) return challengeAppContext;

    initializeLogunModalIntegration();

    const loggedInUser = sessionStorage.getItem('cx_logged_in_user');
    const resolvedLoggedInUser = window.CxSession?.getSessionValue?.('cx_logged_in_user') || loggedInUser;
    if (!resolvedLoggedInUser) {
        window.CxSession?.redirectToLogin?.() || hardNavigateToTarget('login.html');
        return null;
    }

    const users = getUsersData();
    const user = users[resolvedLoggedInUser];
    if (!user) {
        window.CxSession?.clearSessionState?.();
        hardNavigateToTarget('login.html');
        return null;
    }

    const xpEl = document.getElementById('xp-count');
    const levelEl = document.getElementById('header-level');
    if (xpEl) xpEl.textContent = user.xp || 0;
    if (levelEl) levelEl.textContent = user.level || 1;

    // CRÍTICO: Inicializar ProgressSync se necessário
    if (!window.progressSync || !window.progressSync.initialized) {
        challengeDebugLog('[Challenge] ProgressSync not initialized, initializing now...');
        try {
            if (window.progressSync) {
                await window.progressSync.initialize();
                challengeDebugLog('[Challenge] ProgressSync initialized successfully');

                await window.progressSync.loadProgressFromSupabase(resolvedLoggedInUser);
                challengeDebugLog('[Challenge] Progress loaded from Supabase');
            } else {
                console.warn('[Challenge] ProgressSync not available');
            }
        } catch (error) {
            console.error('[Challenge] Failed to initialize ProgressSync:', error);
        }
    }

    // CRÍTICO: Buscar user.id do Supabase ANTES de carregar desafios
    // O ProgressSync pode ter o user_id, vamos tentar usar ele primeiro
    challengeDebugLog('[Challenge] Getting user.id...');
    if (window.progressSync?.lastSyncedState?.user_id) {
        user.id = window.progressSync.lastSyncedState.user_id;
        // Salvar user.id de volta ao storage para uso futuro
        users[resolvedLoggedInUser] = user;
        saveUsersData(users);
        challengeDebugLog('[Challenge] User ID from ProgressSync:', user.id);
    } else {
        // Fallback: loggedInUser já é o UUID do usuário
        user.id = resolvedLoggedInUser;
        users[resolvedLoggedInUser] = user;
        saveUsersData(users);
        challengeDebugLog('[Challenge] Using loggedInUser as user.id:', user.id);
    }


    // CHALLENGE LOCK: verificar se outra aba esta em desafio antes de continuar
    if (window.progressSync?.checkForChallengeLock) {
        const isLocked = await window.progressSync.checkForChallengeLock();
        if (isLocked) {
            console.warn('[Challenge] Another tab has an active challenge. Redirecting to home.');
            window.location.href = 'app.html?reason=duplicate_session';
            return null;
        }
    }
    challengeAppContext = { loggedInUser: resolvedLoggedInUser, user };
    return challengeAppContext;
}

async function loadChallengeFromLocation(options = {}) {
    const urlParams = new URLSearchParams(window.location.search);
    setCurrentPhaseSessionId(urlParams.get('phase_session_id'));
    const gameSessionId = window.IntermissionFlow?.getGameSessionIdFromUrl?.(window.location.search) || urlParams.get('game_session_id');
    if (gameSessionId) {
        setChallengeHydrating(false);
        await startInlineIntermissionGameMode(gameSessionId, challengeAppContext.loggedInUser);
        return;
    }

    const challengeId = urlParams.get('id');
    if (!challengeId) {
        hardNavigateToTarget('/app?reason=no_id_in_url');
        return;
    }

    await loadChallengeById(challengeId, options);
}

async function loadChallengeById(challengeId, options = {}) {
    const context = challengeAppContext || await initializeChallengeApp();
    if (!context) return;

    // validação de fluxo / roteamento: Prevenir carregamento de IDs de jogos intermissão como desafios regulares
    // IDs de intermissão usam prefixo "ig-" (ex: "ig-L1-slot1", "ig-L2-slot2")
    // Estes são IDs GENÉRICOS que não revelam qual jogo foi jogado (suporta aleatoriedade)
    // O jogo específico é rastreado separadamente em completed_minigame_id
    // Estes IDs existem no Firestore como documentos de espaço reservado
    // Quando carregados, devem ser tratados como desafios intermissão especiais
    // NOTA: NÃO bloqueamos estes IDs - eles são desafios válidos no Firestore
    // O sistema os carregará normalmente e os manipulará apropriadamente

    resetChallengeStateForLoad({
        preserveCompletionOverlay: options.preserveCompletionOverlay === true
    });
    setChallengeHydrating(true);
    resetDomCache();

    currentChallengeId = challengeId;
    if (currentChallengeId) {
        window.progressSync?.announceChallengeLock?.(currentChallengeId);
    }

    const { loggedInUser } = context;
    const users = getUsersData();
    const user = users[loggedInUser] || context.user;
    context.user = user;

    const xpEl = document.getElementById('xp-count');
    const levelEl = document.getElementById('header-level');
    if (xpEl) xpEl.textContent = user.xp || 0;
    if (levelEl) levelEl.textContent = user.level || 1;

    currentPhaseSessionId = getPhaseSessionIdFromUrl() || currentPhaseSessionId;
    if (!currentPhaseSessionId && window.IntermissionFlowService) {
        const inferredLevel = getLevelFromChallengeId(currentChallengeId);
        await ensurePhaseSessionForLevel({
            loggedInUser,
            user,
            seasonId: getCachedSeasonId(),
            level: inferredLevel,
            setor: 'CX'
        });
    }

    // VALIDAÇÃO: Verificar se o usuário pode acessar este desafio
    if (window.ChallengeValidator && loggedInUser) {
        try {
            const level = getLevelFromChallengeId(currentChallengeId);
            challengeDebugLog('[Challenge] Validating challenge access...');
            const validationResult = await window.ChallengeValidator.validateChallengeAccess(
                currentChallengeId,
                loggedInUser,
                false,
                { phaseSessionId: getCurrentPhaseSessionId() }
            );
            const normalizedCurrentId = normalizeChallengeId(currentChallengeId);

            logChallengeTrace('log', 'Validation response received', {
                requestId: validationResult.requestId || null,
                challengeId: currentChallengeId,
                phaseSessionId: getCurrentPhaseSessionId(),
                baseId: validationResult.baseId || normalizedCurrentId,
                isValid: validationResult.isValid,
                reason: validationResult.reason,
                redirectTo: validationResult.redirectTo,
                duration: validationResult.performance?.duration || null
            });

            if (!validationResult.isValid) {
                console.error('[Challenge] ❌ ACESSO NEGADO:', validationResult.reason);
                console.error('[Challenge] Challenge ID:', currentChallengeId);
                challengeDebugLog('[Challenge] User present during access denial:', Boolean(loggedInUser));
                console.error('[Challenge] Redirect target:', validationResult.redirectTo);

                if (validationResult.redirectTo) {
                    const { resolvedId: resolvedRedirectId, selectionSource } = resolveChallengeIdForContext(
                        validationResult.redirectTo,
                        {
                            loggedInUser,
                            userId: getChallengeRandomizationUserId(user),
                            level,
                            seasonId: getCachedSeasonId()
                        }
                    );
                    const redirectTargetId = resolvedRedirectId || validationResult.redirectTo;
                    const normalizedRedirectId = normalizeChallengeId(redirectTargetId);

                    if (normalizedRedirectId === normalizedCurrentId) {
                        console.warn('[Challenge] Redirect blocked because it points to the same logical challenge', {
                            event: 'validator_loop_blocked',
                            requestId: validationResult.requestId || null,
                            challengeId: currentChallengeId,
                            redirectTo: validationResult.redirectTo,
                            redirectTargetId,
                            selectionSource
                        });
                        logChallengeTrace('warn', 'Validation redirect blocked because it points to the same logical challenge', {
                            event: 'validator_loop_blocked',
                            requestId: validationResult.requestId || null,
                            challengeId: currentChallengeId,
                            redirectTo: validationResult.redirectTo,
                            redirectTargetId,
                            selectionSource
                        }, true);
                        // Apenas permitir acesso para evitar loop
                    } else {
                        challengeDebugLog('[Challenge] Redirecting to:', redirectTargetId);
                        logChallengeTrace('warn', 'Validation redirected challenge access', {
                            requestId: validationResult.requestId || null,
                            challengeId: currentChallengeId,
                            redirectTo: validationResult.redirectTo,
                            redirectTargetId,
                            selectionSource,
                            reason: validationResult.reason
                        }, true);
                        return navigateToChallengeId(redirectTargetId, 'validation_redirect', {
                            requestId: validationResult.requestId || null,
                            selectionSource
                        });
                    }
                } else {
                    console.error('[Challenge] ❌ No incomplete challenges, redirecting to home');
                    return hardNavigateToTarget(`/app?reason=validator_no_redirect&challenge=${currentChallengeId}&validation=${encodeURIComponent(validationResult.reason)}`);
                }
            }

            challengeDebugLog('[Challenge] Access validated in', validationResult.performance.duration, 'ms');
        } catch (validationError) {
            console.warn('[Challenge] Validation error, allowing access:', validationError);
            // Degradação graciosa: permitir acesso em erro de validação
        }
    } else {
        console.warn('[Challenge] ChallengeValidator not available or user not logged in');
    }

    try {
        // CORREÇÃO DE BUG 12.3.2 & 12.3.3: Verificar se as perguntas já estão pré-carregadas
        // Isso evita múltiplas chamadas do Firebase ao navegar entre perguntas
        if (window.currentLevelChallenges && window.currentLevelChallenges.length > 0) {
            // Extrair nível do challengeId para verificar se estamos no mesmo nível
            const level = getLevelFromChallengeId(currentChallengeId);

            const firstChallengeLevel = window.currentLevelChallenges[0]?.level;
            if (firstChallengeLevel === level) {
                // Encontrar desafio em dados pré-carregados
                const resolvedPreloadedId = resolveChallengeIdFromSelection(
                    currentChallengeId,
                    window.currentLevelChallenges,
                    'memory'
                );
                const challenge = window.currentLevelChallenges.find(q => q.id === (resolvedPreloadedId || currentChallengeId));

                if (challenge) {
                    if (challenge.id !== currentChallengeId) {
                        currentChallengeId = challenge.id;
                        replaceChallengeHistoryId(currentChallengeId);
                    }
                    challengeDebugLog('[Challenge] Using pre-loaded challenge from memory (no Firebase call)');

                    const levelData = window.currentLevelMetadata || {
                        level,
                        setor: 'CX',
                        seasonId: 'S-2025-01',
                        challenge_count: window.currentLevelChallenges.length,
                        total_xp: window.currentLevelChallenges.reduce((sum, q) => sum + (q.xp || 0), 0)
                    };

                    // Processar desafio com dados pré-carregados
                    await processFirebaseChallenge(challenge, levelData, user, loggedInUser, {
                        animate: options.animate !== false
                    });
                    return;
                }
            }
        }

        challengeDebugLog('[Challenge] Tentando carregar do Firebase...');

        if (window.FirebaseLoader) {
            await window.FirebaseLoader.initializeApp();

            const level = getLevelFromChallengeId(currentChallengeId);

            challengeDebugLog(`[Challenge] Carregando level ${level} do Firebase...`);

            const season = await window.FirebaseLoader.loadActiveSeason();
            const seasonId = season ? season.id : 'S-2025-01';
            const randomizationUserId = getChallengeRandomizationUserId(user);
            const rawLevelData = await window.FirebaseLoader.loadLevel(level, 'CX', seasonId);

            challengeDebugLog(`[Challenge] Season ID para valida��o: ${seasonId}`);

            // Consome a ORDEM da phase (VPS = fonte de verdade); fallback local so se falhar.
            const levelData = window.ChallengeRandomizer?.buildFlowFromPhase
                ? await window.ChallengeRandomizer.buildFlowFromPhase(
                    rawLevelData?.questions || [],
                    randomizationUserId,
                    seasonId,
                    level,
                    'CX',
                    rawLevelData
                )
                : await window.ChallengeRandomizer.loadLevelWithRandomization(
                    level,
                    'CX',
                    seasonId,
                    randomizationUserId
                );
            if (levelData && levelData.questions) {
                challengeDebugLog(`[Challenge] ${levelData.questions.length} challenges carregados do Firebase`);

                // CORREÇÃO DE BUG 12.3.2: Armazenar perguntas pré-carregadas na memória
                window.currentLevelChallenges = levelData.questions;
                window.currentLevelMetadata = {
                    level,
                    setor: 'CX',
                    seasonId,
                    challenge_count: levelData.questions.length,
                    total_xp: levelData.questions.reduce((sum, q) => sum + (q.xp || 0), 0)
                };
                challengeDebugLog('[Challenge] Questions pre-loaded and stored in memory');

                // Encontrar o challenge específico
                const { resolvedId: resolvedFirebaseId, selectionSource } = resolveChallengeIdForContext(
                    currentChallengeId,
                    {
                        loggedInUser,
                        userId: randomizationUserId,
                        level,
                        seasonId,
                        fallbackSelection: levelData.questions
                    }
                );
                // A ORDEM e autoritativa (phase persistida na VPS); o Firebase e so o POOL de conteudo.
                // Procura no subset e, se nao achar, no NIVEL COMPLETO — assim qualquer id que a phase
                // indicar (ex.: lg-201) sempre tem conteudo. Elimina o challenge_not_found por divergencia.
                const lookupId = resolvedFirebaseId || currentChallengeId;
                const fullLevelQuestions = rawLevelData?.questions || [];
                const challenge = levelData.questions.find(q => q.id === lookupId)
                    || fullLevelQuestions.find(q => q.id === lookupId);

                if (!challenge) {
                    console.error('[Challenge] ❌ Challenge não encontrado no Firebase (nem no nível completo)');
                    console.error('[Challenge] Challenge ID procurado:', currentChallengeId);
                    console.error('[Challenge] Challenges disponíveis (nível completo):', fullLevelQuestions.map(q => q.id));
                    return hardNavigateToTarget(`/app?reason=challenge_not_found&id=${currentChallengeId}&level=${level}`);
                }

                if (challenge.id !== currentChallengeId) {
                    logChallengeTrace('log', 'Resolved Firebase challenge id before rendering', {
                        requestedId: currentChallengeId,
                        resolvedId: challenge.id,
                        selectionSource
                    }, true);
                    currentChallengeId = challenge.id;
                    replaceChallengeHistoryId(currentChallengeId);
                }

                levelData.seasonId = seasonId;
                levelData.level = level;
                levelData.setor = 'CX';

                // Processar dados do Firebase
                await processFirebaseChallenge(challenge, levelData, user, loggedInUser, {
                    animate: options.animate !== false
                });
                return;
            }
        }

        throw new Error('Firebase not available');

    } catch (firebaseError) {
        console.error('[Challenge] ❌ Firebase falhou:', firebaseError.message);
        console.error('[Challenge] Challenge ID:', currentChallengeId);
        challengeDebugLog('[Challenge] Firebase failure stack:', firebaseError.stack);

        alert("Não foi possível carregar o desafio.");
        return hardNavigateToTarget(`/app?reason=fallback_not_found&id=${encodeURIComponent(currentChallengeId || 'unknown')}`);
    }
}
document.addEventListener('DOMContentLoaded', async () => {
    const context = await initializeChallengeApp();
    if (!context) return;
    await loadChallengeFromLocation({ animate: false });
});

// Processar challenge do Firebase
async function processFirebaseChallenge(challenge, levelData, user, loggedInUser, renderOptions = {}) {
    const allLevelChallenges = levelData.selectedQuestions || levelData.questions || [];
    const extractedLevel = getLevelFromChallengeId(currentChallengeId);
    const flowLevel = levelData.level || extractedLevel;

    // DETECÇÃO DE INTERMISSÃO: Verifica se este é um marcador de jogo de intermissão
    // Intermission IDs use format: ig-L{level}-slot{slot_index} (e.g., ig-L1-slot1, ig-L2-slot2)
    // Estes são marcadores genéricos no Firestore que precisam ser convertidos em sessões de jogo
    if (currentChallengeId && currentChallengeId.startsWith('ig-')) {
        challengeDebugLog('[Challenge] 🎮 Intermission game detected:', currentChallengeId);

        if (!intermissionManifest || !intermissionManifest.nodes) {
            await loadIntermissionManifestForLevel({
                loggedInUser,
                seasonId: levelData.seasonId || 'S-2025-01',
                level: flowLevel,
                setor: levelData.setor || 'CX',
                allLevelChallenges
            });
        }

        if (!intermissionManifest || !intermissionManifest.nodes) {
            console.error('[Challenge] ❌ Intermission manifest not loaded');
            return hardNavigateToTarget(`/app?reason=manifest_not_loaded&id=${encodeURIComponent(currentChallengeId)}`);
        }

        let gameNode = window.IntermissionFlow?.findGameNodeByFlowChallengeId?.(intermissionManifest, currentChallengeId) || null;

        if (gameNode && !gameNode.session_id && intermissionManifest?.phase_session_id) {
            try {
                const resolved = await getIntermissionFlowService()?.resolveIntermissionSession?.({
                    phaseSessionId: intermissionManifest.phase_session_id,
                    flowChallengeId: currentChallengeId
                });

                if (resolved?.game_session_id) {
                    challengeDebugLog('[Challenge] Intermission slot resolved by VPS phase session:', {
                        phase_session_id: intermissionManifest.phase_session_id,
                        flow_challenge_id: currentChallengeId,
                        game_session_id: resolved.game_session_id
                    });
                    return hardNavigateToTarget(`challenge.html?game_session_id=${encodeURIComponent(resolved.game_session_id)}`);
                }
            } catch (error) {
                console.warn('[Challenge] Failed to resolve intermission slot from phase session:', error);
            }
        }

        if (!gameNode || !gameNode.session_id) {
            // Cache do browser pode estar stale (sem o slot ig-/session_id).
            // A VPS reusa a phase persistida; force:true aqui so bypassa cache do browser.
            console.warn('[Challenge] Intermission node missing; bypassing browser cache to reload persisted phase:', currentChallengeId);
            await loadIntermissionManifestForLevel({
                loggedInUser,
                seasonId: levelData.seasonId || 'S-2025-01',
                level: flowLevel,
                setor: levelData.setor || 'CX',
                allLevelChallenges,
                force: true
            });
            gameNode = window.IntermissionFlow?.findGameNodeByFlowChallengeId?.(intermissionManifest, currentChallengeId) || null;
        }

        if (!gameNode || !gameNode.session_id) {
            console.error('[Challenge] ❌ No game session found for intermission:', currentChallengeId);
            console.error('[Challenge] Available nodes:', intermissionManifest.nodes);
            return hardNavigateToTarget(`/app?reason=no_game_session&id=${encodeURIComponent(currentChallengeId)}`);
        }

        challengeDebugLog('[Challenge] ✅ Found game session:', gameNode.session_id);
        challengeDebugLog('[Challenge] Game ID:', gameNode.game_id);
        challengeDebugLog('[IntermissionNav] Resolving slot to game session', {
            manifest_id: intermissionManifest?.manifest_id || null,
            challenge_id: currentChallengeId,
            order_index: gameNode.order_index,
            session_id: gameNode.session_id
        });
        challengeDebugLog('[Challenge] Redirecting to game session...');

        // Redireciona para a sessão de jogo
        return hardNavigateToTarget(`challenge.html?game_session_id=${encodeURIComponent(gameNode.session_id)}`);
    }

    // Buscar status dos desafios do Supabase PRIMEIRO (incluindo tentativas esgotadas)
    let challengeStatusMap = new Map();
    try {
        challengeStatusMap = await loadServerChallengeStatusMap(levelData.seasonId || 'S-2025-01');
        challengeDebugLog('[Challenge] Loaded challenge status from protected API:', challengeStatusMap.size, 'challenges');
    } catch (error) {
        console.warn('[Challenge] Failed to load challenge status:', error);
    }

    const completedChallenges = user.completedChallenges || [];
    // Conjunto completo (desafios uniao minigames -> inclui ids ig-): garante que
    // um intermission ja concluido nunca seja tratado como "disponivel" pela
    // navegacao, fechando a raiz do loop de volta ao intermission.
    const completedBaseSet = window.ProgressFlow?.buildCompletedBaseSet
        ? Array.from(window.ProgressFlow.buildCompletedBaseSet(completedChallenges, user.completedMinigames || []))
        : completedChallenges;
    const currentStatus = getChallengeStatus(challengeStatusMap, currentChallengeId);

    challengeDebugLog('[Challenge] Current challenge ID:', currentChallengeId);
    challengeDebugLog('[Challenge] Current status:', currentStatus);
    challengeDebugLog('[Challenge] Completed challenges:', completedChallenges);

    if (hasCompletedChallenge(completedChallenges, currentChallengeId) || (currentStatus && currentStatus.status === 'completed')) {
        challengeDebugLog('[Challenge] Challenge already completed, finding next available...');
        // Não mostrar alert, apenas redirecionar para próximo disponível
    } else if (currentStatus && currentStatus.status === 'failed') {
        challengeDebugLog('[Challenge] Challenge attempts exhausted, finding next available...');
        // Tentativas esgotadas, redirecionar para próximo disponível
    }

    // Se o desafio atual está completado ou falhado, encontrar o próximo disponível
    await loadIntermissionManifestForLevel({
        loggedInUser,
        seasonId: levelData.seasonId || 'S-2025-01',
        level: flowLevel,
        setor: levelData.setor || 'CX',
        allLevelChallenges
    });

    if (hasCompletedChallenge(completedChallenges, currentChallengeId) || (currentStatus && (currentStatus.status === 'failed' || currentStatus.status === 'completed'))) {
        // Procurar próximo desafio disponível desde o início
        const foundFlowNode = findFirstAvailableFlowNode(completedBaseSet, challengeStatusMap);
        const flowTarget = getFlowNavigationTarget(foundFlowNode);
        if (flowTarget) {
            challengeDebugLog('[Challenge] Redirecting to next available flow node:', foundFlowNode);
            return navigateToFlowTarget(flowTarget, 'firebase_first_available_flow_node', {
                flowNode: foundFlowNode
            });
        }

        let foundNext = null;
        for (let i = 0; i < allLevelChallenges.length; i++) {
            const candidateId = allLevelChallenges[i].id;

            // Pular se já completado
            const status = getChallengeStatus(challengeStatusMap, candidateId);
            if (hasCompletedChallenge(completedChallenges, candidateId) || (status && status.status === 'completed')) continue;

            // Pular se tentativas esgotadas (status 'failed')
            if (status && status.status === 'failed') continue;

            // Desafio disponível encontrado
            foundNext = candidateId;
            break;
        }

        if (foundNext) {
            challengeDebugLog('[Challenge] Redirecting to next available challenge:', foundNext);
            return navigateToChallengeId(foundNext, 'firebase_next_available_challenge');
        } else {
            challengeDebugLog('[Challenge] No more challenges available, redirecting to home');
            return hardNavigateToTarget('/app?reason=no_more_challenges_firebase');
        }
    }

    // GUARD anti skip-ahead: a VPS e dona da ordem do fluxo. Se o usuario abriu
    // (via id manual na URL) um no a frente do primeiro pendente, devolve para o
    // no liberado em vez de deixar pular etapas. Usa o conjunto completo
    // (desafios uniao minigames) para nao reentrar em intermission ja concluido.
    if (intermissionManifest && window.IntermissionFlow?.getNodeForChallenge) {
        const currentNode = window.IntermissionFlow.getNodeForChallenge(intermissionManifest, currentChallengeId);
        const firstAvailable = findFirstAvailableFlowNode(completedBaseSet, challengeStatusMap);
        if (currentNode && firstAvailable
            && Number(currentNode.order_index) > Number(firstAvailable.order_index)) {
            const guardTarget = getFlowNavigationTarget(firstAvailable);
            if (guardTarget) {
                console.warn('[Challenge] Skip-ahead bloqueado pela VPS; voltando ao no liberado', {
                    attempted: currentChallengeId,
                    attempted_order_index: currentNode.order_index,
                    allowed_order_index: firstAvailable.order_index
                });
                return navigateToFlowTarget(guardTarget, 'guard_skip_ahead_blocked', {
                    attempted: currentChallengeId
                });
            }
        }
    }

    const normalizedChallenge = window.ProgressFlow?.normalizeChallengeData
        ? window.ProgressFlow.normalizeChallengeData(challenge)
        : challenge;

    if (!normalizedChallenge || normalizedChallenge.isPlaceholder) {
        console.error('[Challenge] Invalid Firebase challenge data:', {
            id: challenge?.id,
            type: challenge?.type,
            tipo: challenge?.tipo,
            title: challenge?.title,
            titulo: challenge?.titulo
        });

        return hardNavigateToTarget(`/app?reason=placeholder_challenge_data&id=${encodeURIComponent(currentChallengeId || challenge?.id || 'unknown')}`);
    }

    challenge = normalizedChallenge;

    const badgeEl = document.getElementById('challenge-badge');
    // levelData possui nome e icone no nível raiz (da migração do Firebase)
    const level = flowLevel;

    if (badgeEl) {
        const icone = levelData.icone || (level === 1 ? '🛡️' : level === 2 ? '⚡' : '👑');
        const nome = levelData.nome || `Level ${level}`;
        badgeEl.textContent = `${icone} ${nome}`;
        badgeEl.className = 'challenge-badge';
        if (level === 1) badgeEl.classList.add('challenge-badge--easy');
        else if (level === 2) badgeEl.classList.add('challenge-badge--medium');
        else if (level === 3) badgeEl.classList.add('challenge-badge--hard');
    }

    const nameEl = document.getElementById('challenge-name');
    if (nameEl) nameEl.textContent = challenge.categoria || 'Desafio EC';

    // Encontrar próximo desafio disponível (não completado E não falhado)
    const currentFlowNode = window.IntermissionFlow?.getNodeForChallenge?.(intermissionManifest, currentChallengeId);
    challengeOrderIndex = currentFlowNode ? currentFlowNode.order_index : allLevelChallenges.findIndex(c => c.id === currentChallengeId);

    // Se não encontrou, usar índice 0 como fallback
    if (challengeOrderIndex === -1) {
        challengeOrderIndex = 0;
    }

    challengeTotalInLevel = intermissionManifest?.total_nodes || allLevelChallenges.length || 1;

    nextChallengeId = null;
    nextFlowNode = findNextAvailableFlowNode(completedBaseSet, challengeStatusMap);
    if (nextFlowNode?.type === 'challenge') {
        nextChallengeId = nextFlowNode.content_id || nextFlowNode.logical_id || nextFlowNode.challenge_id;
    }
    for (let i = challengeOrderIndex + 1; i < challengeTotalInLevel; i++) {
        if (intermissionManifest) break;
        const candidateId = allLevelChallenges[i].id;

        // Pular se já completado
        const status = getChallengeStatus(challengeStatusMap, candidateId);
        if (hasCompletedChallenge(completedChallenges, candidateId) || (status && status.status === 'completed')) continue;

        // Pular se tentativas esgotadas (status 'failed')
        if (status && status.status === 'failed') continue;

        // Desafio disponível encontrado
        nextChallengeId = candidateId;
        break;
    }

    // Converter alternativas do Firebase para formato esperado
    const optionsList = [];
    const optionsMap = {};
    if (challenge.alternativas && typeof challenge.alternativas === 'object') {
        // Ordenar por chave (A, B, C, D) para garantir ordem consistente
        const sortedEntries = Object.entries(challenge.alternativas).sort((a, b) => a[0].localeCompare(b[0]));
        sortedEntries.forEach(([key, value], index) => {
            optionsList.push(value);
            optionsMap[index] = key;
        });
    }

    questions = [{
        type: challenge.tipo === 'texto' ? 'text' : 'multiple',
        title: challenge.titulo,
        desc: challenge.descricao || challenge.titulo,
        options: optionsList,
        optionsMap: optionsMap,
        correct: null,
        correctAnswers: [],
        xp: challenge.xp,
        time: challenge.tempo_limite || 120,
        level: level,
        seasonId: levelData.seasonId || 'S-2025-01',
        setor: 'CX'
    }];

    timeLeft = questions[0].time;
    await renderQuestion(0, true, {
        ...renderOptions,
        challengeStatusMap
    });
}

// Processar challenge local (fallback)
async function processLocalChallenge(raw, data, user, loggedInUser, renderOptions = {}) {
    // Buscar status dos desafios do Supabase PRIMEIRO (incluindo tentativas esgotadas)
    let challengeStatusMap = new Map();
    try {
        challengeStatusMap = await loadServerChallengeStatusMap('S-2025-01');
        challengeDebugLog('[Challenge] Loaded challenge status from protected API:', challengeStatusMap.size, 'challenges');
    } catch (error) {
        console.warn('[Challenge] Failed to load challenge status:', error);
    }

    const completedChallenges = user.completedChallenges || [];
    const currentStatus = getChallengeStatus(challengeStatusMap, currentChallengeId);

    if (hasCompletedChallenge(completedChallenges, currentChallengeId) || (currentStatus && currentStatus.status === 'completed')) {
        challengeDebugLog('[Challenge] Challenge already completed, finding next available...');
    } else if (currentStatus && currentStatus.status === 'failed') {
        challengeDebugLog('[Challenge] Challenge attempts exhausted, finding next available...');
    }

    // Se o desafio atual está completado ou falhado, encontrar o próximo disponível
    const allLevel = data.challenges.filter(c => c.level === raw.level);

    await loadIntermissionManifestForLevel({
        loggedInUser,
        seasonId: raw.seasonId || 'S-2025-01',
        level: raw.level || 1,
        setor: raw.setor || 'CX',
        allLevelChallenges: allLevel
    });
    const localFirstFlowNode = findFirstAvailableFlowNode(completedChallenges, challengeStatusMap);
    const localFirstFlowTarget = getFlowNavigationTarget(localFirstFlowNode);

    if (hasCompletedChallenge(completedChallenges, currentChallengeId) || (currentStatus && (currentStatus.status === 'failed' || currentStatus.status === 'completed'))) {
        // Procurar próximo desafio disponível desde o início
        if (localFirstFlowTarget) {
            challengeDebugLog('[Challenge] Redirecting to next available flow node:', localFirstFlowNode);
            return navigateToFlowTarget(localFirstFlowTarget, 'local_first_available_flow_node', {
                flowNode: localFirstFlowNode
            });
        }

        let foundNext = null;
        for (let i = 0; i < allLevel.length; i++) {
            const candidateId = allLevel[i].id;

            // Pular se já completado
            const status = getChallengeStatus(challengeStatusMap, candidateId);
            if (hasCompletedChallenge(completedChallenges, candidateId) || (status && status.status === 'completed')) continue;

            // Pular se tentativas esgotadas (status 'failed')
            if (status && status.status === 'failed') continue;

            // Desafio disponível encontrado
            foundNext = candidateId;
            break;
        }

        if (foundNext) {
            challengeDebugLog('[Challenge] Redirecting to next available challenge:', foundNext);
            return navigateToChallengeId(foundNext, 'local_next_available_challenge');
        } else {
            challengeDebugLog('[Challenge] No more challenges available, redirecting to home');
            return hardNavigateToTarget('/app?reason=no_more_challenges_local');
        }
    }

    const levelData = data.levels[String(raw.level)];
    const badgeEl = document.getElementById('challenge-badge');
    if (badgeEl && levelData) {
        badgeEl.textContent = `${levelData.icon} ${levelData.name}`;
        badgeEl.className = 'challenge-badge';
        if (raw.level === 1) badgeEl.classList.add('challenge-badge--easy');
        else if (raw.level === 2) badgeEl.classList.add('challenge-badge--medium');
        else if (raw.level === 3) badgeEl.classList.add('challenge-badge--hard');
    }

    const nameEl = document.getElementById('challenge-name');
    if (nameEl) nameEl.textContent = raw.category || 'Desafio EC';

    // Encontrar o próximo desafio disponível (não completado E não falhado)
    const currentFlowNode = window.IntermissionFlow?.getNodeForChallenge?.(intermissionManifest, currentChallengeId);
    challengeOrderIndex = currentFlowNode ? currentFlowNode.order_index : allLevel.findIndex(c => c.id === raw.id);
    challengeTotalInLevel = intermissionManifest?.total_nodes || allLevel.length;

    // Procurar o próximo desafio disponível
    nextChallengeId = null;
    nextFlowNode = findNextAvailableFlowNode(completedChallenges, challengeStatusMap);
    if (nextFlowNode?.type === 'challenge') {
        nextChallengeId = nextFlowNode.content_id || nextFlowNode.logical_id || nextFlowNode.challenge_id;
    }
    for (let i = challengeOrderIndex + 1; i < challengeTotalInLevel; i++) {
        if (intermissionManifest) break;
        const candidateId = allLevel[i].id;

        // Pular se já completado
        const status = getChallengeStatus(challengeStatusMap, candidateId);
        if (hasCompletedChallenge(completedChallenges, candidateId) || (status && status.status === 'completed')) continue;

        // Pular se tentativas esgotadas (status 'failed')
        if (status && status.status === 'failed') continue;

        // Desafio disponível encontrado
        nextChallengeId = candidateId;
        break;
    }

    const letters = ANSWER_LETTERS;
    let optionsList = [];
    if (raw.type === 'seleção' || raw.type === 'selecao') {
        optionsList = raw.options.map(o => o.text);
    }

    questions = [{
        type: raw.type === 'seleção' || raw.type === 'selecao' ? 'multiple' : 'text',
        title: raw.title,
        desc: raw.description,
        options: optionsList,
        correct: null,
        correctAnswers: [],
        xp: raw.points,
        time: raw.timeLimit || 120,
        level: raw.level
    }];
    timeLeft = questions[0].time;

    await renderQuestion(0, true, {
        ...renderOptions,
        challengeStatusMap
    });
}

// Timer
function startTimer() {
    updateTimerDisplay();
    clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        timeLeft--;
        totalTimeUsed++;
        updateTimerDisplay();
        if (timeLeft <= 0) {
            clearInterval(timerInterval);
            submitAnswer('timeout');
        }
    }, 1000);
}

function updateTimerDisplay() {
    const m = String(Math.floor(timeLeft / 60)).padStart(2, '0');
    const s = String(timeLeft % 60).padStart(2, '0');

    const timerDisplay = getCachedElement('timerDisplay', 'timer-display');
    const timer = getCachedElement('timer', 'timer');

    if (timerDisplay) {
        timerDisplay.textContent = `${m}:${s}`;
    }
    if (timer) {
        timer.classList.toggle('timer--warning', timeLeft <= 30);
        timer.classList.toggle('timer--danger', timeLeft <= 10);
    }
}

function renderQuestion(index, resetAttempts = true, options = {}) {
    const q = questions[index];
    const animate = options.animate !== false;
    if (!q) return Promise.resolve();

    if (resetAttempts) attempts = 0;
    answered = false;
    selectedOption = null;
    timeLeft = q.time || 120;

    updateAttemptsCard();

    const progressCurrent = getCachedElement('progressCurrent', 'progress-current');
    if (progressCurrent) progressCurrent.textContent = challengeOrderIndex + 1;
    const totalSpan = getCachedElement('progressTotal', 'progress-total');
    if (totalSpan) totalSpan.textContent = challengeTotalInLevel;

    const questionNumberElement = getCachedElement('questionNumber', 'question-number');
    if (questionNumberElement) {
        const strongElement = questionNumberElement.querySelector('strong');
        if (strongElement) strongElement.textContent = String(challengeOrderIndex + 1).padStart(2, '0');
    }

    const questionPointsElement = getCachedElement('questionPoints', 'question-points');
    if (questionPointsElement) {
        questionPointsElement.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
            +${q.xp} XP
        `;
    }

    const pct = ((challengeOrderIndex) / challengeTotalInLevel) * 100;
    const progressFill = getCachedElement('progressFill', 'challenge-progress-fill');
    if (progressFill) progressFill.style.setProperty('--progress', pct + '%');

    if (mysteryProgressBar && (intermissionManifest || currentLevelChallenges.length > 0)) {
        const progressBarState = getProgressBarState(options.challengeStatusMap);

        const phases = intermissionManifest
            ? window.MysteryProgressBar.fromIntermissionManifest(
                intermissionManifest,
                progressBarState.completedChallenges,
                currentChallengeId,
                progressBarState.challengeStatusMap
            )
            : window.MysteryProgressBar.fromChallengeList(
                currentLevelChallenges,
                progressBarState.completedChallenges,
                currentChallengeId,
                progressBarState.challengeStatusMap
            );

        mysteryProgressBar.update(phases);
    }

    // Recorre aos pontos antigos se o MysteryProgressBar não estiver disponível
    const dotsContainer = document.querySelector('.progress-steps');
    if (dotsContainer && !mysteryProgressBar) {
        dotsContainer.innerHTML = '';
        for (let i = 0; i < challengeTotalInLevel; i++) {
            const dot = document.createElement('span');
            dot.className = 'progress-dot';
            const progressNode = intermissionManifest?.nodes?.[i];
            if (progressNode?.type === 'game') {
                dot.classList.add('progress-dot--game');
                const gameMeta = window.IntermissionGameCatalog?.getGameMeta?.(progressNode.game_id);
                if (gameMeta?.type) dot.classList.add(`progress-dot--${gameMeta.type}`);
                dot.title = 'Game entre desafios';
            }
            if (i <= challengeOrderIndex) dot.classList.add('active');
            if (i < challengeOrderIndex) dot.classList.add('completed');
            dotsContainer.appendChild(dot);
        }
    }

    const card = getCachedElement('questionCard', 'question-card');

    // TRANSIÇÃO MELHORADA: Prepara o novo conteúdo enquanto o card ainda está visível
    const questionTitle = getCachedElement('questionTitle', 'question-title');
    const questionDesc = getCachedElement('questionDesc', 'question-desc');
    const optionsGrid = getCachedElement('optionsGrid', 'options-grid');
    const textAnswerArea = getCachedElement('textAnswerArea', 'text-answer-area');
    const textAnswer = getCachedElement('textAnswer', 'text-answer');
    const charCount = getCachedElement('charCount', 'char-count');
    const feedbackOverlay = getCachedElement('feedbackOverlay', 'feedback-overlay');
    const actionBar = getCachedElement('actionBar', 'action-bar');
    const nextBar = getCachedElement('nextBar', 'next-bar');

    // Pré-atualiza o conteúdo (enquanto o card ainda está visível)
    if (questionTitle) questionTitle.textContent = q.title;
    if (questionDesc) questionDesc.innerHTML = q.desc;

    if (q.type === 'multiple') {
        // Prepare multiple choice content
        const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
        if (optionsGrid) {
            optionsGrid.innerHTML = q.options.map((opt, i) => `
                <button class="option-btn" data-option="${letters[i]}" data-index="${i}" id="option-${letters[i].toLowerCase()}" onclick="selectOption(this)">
                    <span class="option-letter">${letters[i]}</span>
                    <span class="option-text">${escapeHtml(opt)}</span>
                    <div class="option-check">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </div>
                </button>
            `).join('');
        }
    } else {
        // Prepare text answer content
        if (textAnswer) textAnswer.value = '';
        if (charCount) charCount.textContent = '0 / 500';
    }

    const finishRender = (resolve) => {
        if (q.type === 'multiple') {
            if (optionsGrid) optionsGrid.style.display = '';
            if (textAnswerArea) textAnswerArea.style.display = 'none';

            // Hide Sentury special elements for multiple choice
            const logumStripe = document.getElementById('logum-stripe');
            const logumBadge = document.getElementById('logum-special-badge');
            const logumFooter = document.getElementById('logum-footer');
            if (logumStripe) logumStripe.style.display = 'none';
            if (logumBadge) logumBadge.style.display = 'none';
            if (logumFooter) logumFooter.style.display = 'none';

            if (card) card.classList.remove('logum-special');

            // Deactivate Sentury mode
            deactivateLogumMode();
        } else {
            if (optionsGrid) optionsGrid.style.display = 'none';
            if (textAnswerArea) textAnswerArea.style.display = '';

            // Show Sentury special elements for text questions
            const logumStripe = document.getElementById('logum-stripe');
            const logumBadge = document.getElementById('logum-special-badge');
            const logumFooter = document.getElementById('logum-footer');
            if (logumStripe) logumStripe.style.display = '';
            if (logumBadge) logumBadge.style.display = '';
            if (logumFooter) logumFooter.style.display = '';

            if (card) card.classList.add('logum-special');

            // Activate Sentury mode (purple theme)
            activateLogumMode();
        }

        if (feedbackOverlay) feedbackOverlay.classList.remove('show');
        const submitBtn = getCachedElement('submitBtn', 'btn-submit');
        if (submitBtn) {
            submitBtn.disabled = q.type === 'multiple';
        }
        if (actionBar) actionBar.style.display = '';
        if (nextBar) nextBar.style.display = 'none';
        const nextBtn = getCachedElement('nextBtn', 'btn-next');
        if (nextBtn) nextBtn.dataset.retry = 'false';

        if (card) {
            card.classList.remove('exit');
            if (animate) {
                card.classList.add('enter');
                setTimeout(() => card.classList.remove('enter'), 500);
            } else {
                card.classList.remove('enter');
            }
        }

        setChallengeHydrating(false);
        startTimer();
        resolve();
    };

    return new Promise(resolve => {
        if (animate && card) {
            card.classList.add('exit');
            setTimeout(() => finishRender(resolve), 300);
        } else {
            if (card) card.classList.remove('exit', 'enter');
            finishRender(resolve);
        }
    });
}


function selectOption(btn) {
    if (answered) return;
    document.querySelectorAll('.option-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedOption = parseInt(btn.dataset.index);
    const submitBtn = getCachedElement('submitBtn', 'btn-submit');
    if (submitBtn) {
        submitBtn.disabled = false;
    }
    btn.classList.add('pulse');
    setTimeout(() => btn.classList.remove('pulse'), 300);
}

// Text input handler
document.addEventListener('input', (e) => {
    if (e.target.id === 'text-answer') {
        const len = e.target.value.length;
        const charCount = getCachedElement('charCount', 'char-count');
        if (charCount) charCount.textContent = `${len} / 500`;
        const submitBtn = getCachedElement('submitBtn', 'btn-submit');
        if (submitBtn) {
            submitBtn.disabled = len === 0;
        }
    }
});

function getActiveLogunModal() {
    return window.logunModalInstance?.modal || null;
}

function clearLogumModalChallengeTimers(logunModal) {
    if (!logunModal) return;

    if (Array.isArray(logunModal._challengeSequenceTimers)) {
        logunModal._challengeSequenceTimers.forEach(timer => clearTimeout(timer));
    }

    logunModal._challengeSequenceTimers = [];
}

function startLogumModalAnalysis(textAnswerValue) {
    const logunModal = getActiveLogunModal();

    if (!logunModal?.elements?.overlay) {
        console.warn('[Challenge] Logun modal unavailable before validation request');
        return null;
    }

    clearLogumModalChallengeTimers(logunModal);

    logunModal.state.lastSubmittedText = textAnswerValue;
    logunModal.state.isVisible = true;
    logunModal.state.isAnalyzing = true;
    logunModal.state.currentResult = null;

    if (logunModal.elements.analysisText) {
        logunModal.elements.analysisText.textContent = textAnswerValue;
    }

    logunModal.showAnalysisPanel();
    logunModal.showReadingState();
    logunModal.elements.overlay.style.display = '';
    logunModal.elements.overlay.classList.add('is-visible');
    logunModal.elements.overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('logun-modal-open');

    const readingDuration = logunModal.options?.readingDuration || 1600;
    logunModal._challengeSequenceTimers.push(setTimeout(() => {
        if (logunModal.state.isAnalyzing) {
            logunModal.showAnalysisState();
        }
    }, readingDuration));

    return logunModal;
}

function showLogumModalResult(logunModal, modalResult, startedAt) {
    if (!logunModal?.elements?.overlay) return false;

    clearLogumModalChallengeTimers(logunModal);

    const elapsed = Date.now() - startedAt;
    const minimumVisibleTime = 900;
    const completionDelay = logunModal.options?.completionDelay || 900;
    const waitBeforeCompletion = Math.max(0, minimumVisibleTime - elapsed);

    const completionTimer = setTimeout(() => {
        logunModal.showCompletionState();

        const resultTimer = setTimeout(() => {
            logunModal.showResult(modalResult);
        }, completionDelay);

        logunModal._challengeSequenceTimers.push(resultTimer);
    }, waitBeforeCompletion);

    logunModal._challengeSequenceTimers.push(completionTimer);
    return true;
}

function dismissLogumModalAnalysis(logunModal) {
    if (!logunModal?.elements?.overlay) return;

    clearLogumModalChallengeTimers(logunModal);
    logunModal.state.isVisible = false;
    logunModal.state.isAnalyzing = false;
    logunModal.elements.overlay.classList.remove('is-visible');
    logunModal.elements.overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('logun-modal-open');
}

function getLogumVisualCorrect(data) {
    if (typeof data?.visual_correct === 'boolean') return data.visual_correct;
    return !!data?.correct;
}

function normalizeLogumPercent(value, fallback) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return fallback;

    const percent = numericValue <= 1 ? numericValue * 100 : numericValue;
    return Math.max(0, Math.min(100, Math.round(percent)));
}

function getLogumCriterionValue(source, aliases) {
    if (!source || typeof source !== 'object') return undefined;

    for (const alias of aliases) {
        if (source[alias] !== undefined) return source[alias];
    }

    return undefined;
}

function isLogumCriterionPassed(value, fallback) {
    if (value === undefined || value === null) return fallback;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value >= 6 || (value > 0 && value <= 1 && value >= 0.6);
    if (typeof value === 'string') {
        const normalized = value.toLowerCase();
        if (['true', 'ok', 'passou', 'aprovado', 'sim'].includes(normalized)) return true;
        if (['false', 'falhou', 'reprovado', 'nao', 'não'].includes(normalized)) return false;
    }

    if (typeof value === 'object') {
        if (typeof value.passou === 'boolean') return value.passou;
        if (typeof value.passed === 'boolean') return value.passed;
        if (typeof value.score === 'number') return value.score >= 6 || (value.score > 0 && value.score <= 1 && value.score >= 0.6);
        if (typeof value.pontuacao === 'number') return value.pontuacao >= 6 || (value.pontuacao > 0 && value.pontuacao <= 1 && value.pontuacao >= 0.6);
    }

    return fallback;
}

function buildLogumModalResult(data) {
    const logunFeedback = data?.logun_feedback || {};
    const feedback = logunFeedback.feedback || {};
    const criteriaSource = feedback.criterios || feedback;
    const approved = getLogumVisualCorrect(data);
    const confidence = normalizeLogumPercent(
        logunFeedback.confianca ?? feedback.confianca ?? logunFeedback.keyword_match_score,
        approved ? 86 : 62
    );
    const suggestions = Array.isArray(logunFeedback.sugestoes) ? logunFeedback.sugestoes : [];

    const criteria = [
        ['empatia'],
        ['clareza', 'solucao_clara'],
        ['tom_profissional', 'tom'],
        ['proximo_passo', 'proximoPasso', 'encaminhamento']
    ].map(aliases => isLogumCriterionPassed(
        getLogumCriterionValue(criteriaSource, aliases),
        approved
    ));

    return {
        approved,
        criteria,
        title: approved ? 'Resposta aprovada' : 'Vamos revisar melhor',
        message: suggestions[0] || (approved ? 'Sua resposta esta adequada.' : 'Sua resposta recebeu pontos, mas pode ser melhorada.'),
        opinion: suggestions[1] || 'Continue praticando para melhorar suas habilidades de atendimento.',
        confidence
    };
}

function completeLogumChallengeLocally(data, textAnswerValue, visualCorrect) {
    const q = questions[currentQuestion] || {};
    const awarded = typeof data?.score === 'number' ? data.score : (q.awardedXp || q.xp || 0);
    const curUser = sessionStorage.getItem('cx_logged_in_user');
    let appliedAward = awarded;
    let alreadyCompleted = false;
    let savedXP = null;

    q.awardedXp = awarded;
    q.attemptsRemaining = maxAttempts;

    if (curUser) {
        const users = getUsersData();
        const user = users[curUser];

        if (user) {
            if (!user.completedChallenges) user.completedChallenges = [];
            alreadyCompleted = currentChallengeId && user.completedChallenges.includes(currentChallengeId);

            if (!alreadyCompleted) {
                user.xp = (user.xp || 0) + awarded;
                user.level = Math.floor(user.xp / 500) + 1;
                if (currentChallengeId) {
                    user.completedChallenges.push(currentChallengeId);
                }
            } else {
                appliedAward = 0;
            }

            if (!user.logumChallenges) user.logumChallenges = [];
            if (currentChallengeId && !user.logumChallenges.includes(currentChallengeId)) {
                user.logumChallenges.push(currentChallengeId);
            }

            if (!user.attemptHistory) user.attemptHistory = [];
            if (!alreadyCompleted) {
                user.attemptHistory.push({
                    challenge_id: currentChallengeId,
                    timestamp: new Date().toISOString(),
                    correct: true,
                    logum_visual_correct: visualCorrect,
                    logum_completed: true,
                    time_used: totalTimeUsed * 1000,
                    score: awarded,
                    answer: textAnswerValue
                });
            }

            savedXP = user.xp || 0;
            saveUsersData(users);

            if (window.ChallengeValidator && currentChallengeId) {
                try {
                    window.ChallengeValidator.invalidateValidationCache(curUser, currentChallengeId);
                    if (nextChallengeId) {
                        window.ChallengeValidator.invalidateValidationCache(curUser, nextChallengeId);
                    }
                } catch (error) {
                    console.warn('[Challenge] Error invalidating validation cache:', error);
                }
            }

            if (!alreadyCompleted) {
                queueLogumProgressSync({
                    awarded,
                    answer: textAnswerValue,
                    visualCorrect
                });
            }
        }
    }

    return { awarded, appliedAward, alreadyCompleted, savedXP };
}

function waitForLogumDelay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForPromiseWithTimeout(promise, timeoutMs, label) {
    let timeoutId;
    try {
        return await Promise.race([
            Promise.resolve(promise),
            new Promise(resolve => {
                timeoutId = setTimeout(() => resolve({ timeout: true, label }), timeoutMs);
            })
        ]);
    } catch (error) {
        console.warn(`[Challenge] Logum ${label} step failed:`, error);
        return { error, label };
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

function updateLogumSavingIndicator(message, tone = 'saving') {
    const actionsContainer = document.querySelector('.completion-actions');
    if (!actionsContainer?.parentElement) return;

    let indicator = document.getElementById('saving-indicator');
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'saving-indicator';
        actionsContainer.parentElement.insertBefore(indicator, actionsContainer);
    }

    const colors = {
        saving: '#7c6ff7',
        success: '#7c6ff7',
        warning: '#9a9a9a',
        error: '#ff6b6b'
    };

    indicator.textContent = message;
    indicator.style.cssText = `text-align:center;margin-bottom:1rem;color:${colors[tone] || colors.saving};font-size:0.9rem;`;
}

async function showLogumCompletionFeedback(result) {
    const overlay = getCachedElement('completionOverlay', 'completion-overlay');
    const compCorrect = getCachedElement('compCorrect', 'comp-correct');
    const compXp = getCachedElement('compXp', 'comp-xp');
    const compTime = getCachedElement('compTime', 'comp-time');
    const titleEl = document.querySelector('.completion-title');
    const subtitleEl = document.querySelector('.completion-subtitle');
    const actionsContainer = document.querySelector('.completion-actions');

    if (compCorrect) compCorrect.textContent = correctCount;
    if (compXp) compXp.textContent = result.appliedAward || 0;

    const mins = Math.floor(totalTimeUsed / 60);
    const secs = totalTimeUsed % 60;
    if (compTime) compTime.textContent = `${mins}:${String(secs).padStart(2, '0')}`;

    if (titleEl) titleEl.textContent = 'Desafio completo!';
    if (subtitleEl) subtitleEl.textContent = `+${result.appliedAward || 0} XP ganho com o Sentury`;

    if (actionsContainer) {
        actionsContainer.innerHTML = `
            <button id="next-challenge-btn" class="action-btn action-btn--primary" disabled>
                <span class="btn-text">Indo para o proximo desafio...</span>
                <svg class="btn-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                <div class="btn-shine"></div>
            </button>
        `;
    }

    updateLogumSavingIndicator('Salvando progresso...');
    overlay?.classList.add('show');
}

function waitForLogumSync(events = ['sync:success', 'sync:error', 'sync:max_retries'], timeoutMs = 4500) {
    const progress = window.progressSync;

    if (!progress?.syncQueue?.length || typeof progress.onCriticalEvent !== 'function') {
        updateLogumSavingIndicator('Progresso salvo!', 'success');
        return Promise.resolve('empty');
    }

    return new Promise(resolve => {
        let settled = false;
        let timeoutId = null;
        const handlers = [];

        const cleanup = () => {
            handlers.forEach(({ event, handler }) => {
                if (typeof progress.off === 'function') progress.off(event, handler);
            });
            if (timeoutId) clearTimeout(timeoutId);
        };

        const finish = (status) => {
            if (settled) return;
            settled = true;
            cleanup();

            if (status === 'sync:success') {
                updateLogumSavingIndicator('Progresso salvo!', 'success');
            } else if (status === 'timeout') {
                updateLogumSavingIndicator('Continuando com progresso salvo localmente.', 'warning');
            } else {
                updateLogumSavingIndicator('Progresso salvo localmente. Sincronizacao pendente.', 'warning');
            }

            resolve(status);
        };

        events.forEach(event => {
            const handler = () => finish(event);
            handlers.push({ event, handler });
            if (typeof progress.on === 'function') progress.on(event, handler);
        });

        progress.onCriticalEvent();
        timeoutId = setTimeout(() => finish('timeout'), timeoutMs);
    });
}

async function waitForLogumCompletionEffects() {
    const waits = [
        waitForLogumSync(['sync:success', 'sync:error', 'sync:max_retries'], 4500)
    ];

    if (window.AchievementNotifications?.check) {
        waits.push(
            waitForPromiseWithTimeout(
                window.AchievementNotifications.check(),
                2500,
                'achievements'
            )
        );
    }

    await Promise.all(waits);
}

function goToNextLogumChallenge() {
    navigateToNextNode();
}

async function finishLogumChallenge(data, reason = 'answer') {
    if (logumCompletionInProgress) return;
    logumCompletionInProgress = true;

    const feedbackStartedAt = Date.now();

    try {
        const submitBtn = getCachedElement('submitBtn', 'btn-submit');
        if (submitBtn) { stopSubmitAml(); submitBtn.classList.remove('loading'); }

        const textAnswer = getCachedElement('textAnswer', 'text-answer');
        const textAnswerValue = textAnswer ? textAnswer.value.trim() : '';
        const visualCorrect = getLogumVisualCorrect(data);
        const result = completeLogumChallengeLocally(data, textAnswerValue, visualCorrect);

        if (!result.alreadyCompleted) {
            totalXP += result.appliedAward;
            correctCount++;
        }

        const xpCount = getCachedElement('xpCount', 'xp-count');
        if (xpCount && typeof result.savedXP === 'number') {
            xpCount.textContent = result.savedXP;
        }

        challengeDebugLog('[Challenge] Logum challenge completed from modal:', {
            challengeId: currentChallengeId,
            reason,
            visualCorrect,
            awarded: result.awarded,
            nextChallengeId
        });

        await showLogumCompletionFeedback(result);
        await waitForLogumCompletionEffects();

        const remainingVisibleTime = 1200 - (Date.now() - feedbackStartedAt);
        if (remainingVisibleTime > 0) {
            await waitForLogumDelay(remainingVisibleTime);
        }

        goToNextLogumChallenge();
    } catch (error) {
        console.error('[Challenge] Error finishing Logum challenge:', error);
        goToNextLogumChallenge();
    }
}

// Submit
function submitAnswer(reason = 'answer', existingIdempotencyKey = null) {
    if (answered) return;
    answered = true;
    clearInterval(timerInterval);
    attempts++;

    const q = questions[currentQuestion];
    const submitBtn = getCachedElement('submitBtn', 'btn-submit');

    const letters = ANSWER_LETTERS;
    const selectedLetter = selectedOption != null ? letters[selectedOption] : null;
    let correctLetters = [];

    const finish = (isCorrect, reasonParam = reason) => {
        if (submitBtn) {
            stopSubmitAml();
            submitBtn.classList.remove('loading');
        }

        // highlight options when múltipla escolha
        if (q.type === 'multiple') {
            document.querySelectorAll('.option-btn').forEach(btn => {
                const letter = btn.dataset.option;
                if (isCorrect && correctLetters.includes(letter)) {
                    btn.classList.add('correct');
                } else if (!isCorrect && letter === selectedLetter) {
                    btn.classList.add('wrong');
                }
                btn.classList.add('revealed');
            });
        }

        if (isCorrect) {
            const awarded = q.awardedXp || q.xp || 0;
            totalXP += awarded;
            correctCount++;
            let baseXP = 0;
            const curUser = sessionStorage.getItem('cx_logged_in_user');
            if (curUser) {
                const users = getUsersData();
                if (users[curUser]) baseXP = users[curUser].xp || 0;
            }
            const xpCount = getCachedElement('xpCount', 'xp-count');
            if (xpCount) {
                xpCount.textContent = baseXP + totalXP;
            }
        }

        showFeedback(isCorrect, q, reasonParam, correctLetters, selectedLetter);
    };

    if (reason === 'timeout') {
        return finish(false, 'timeout');
    }

    if (q.type === 'multiple') {
        if (submitBtn) {
            submitBtn.classList.add('loading');
            const _amlStage = submitBtn.querySelector('.aml-stage');
            if (_amlStage) startSubmitAml(_amlStage, CX_AML_IA_FLOW);
        }

        if (selectedLetter == null) {
            stopSubmitAml();
            if (submitBtn) submitBtn.classList.remove('loading');
            answered = false;
            return;
        }

        const userId = sessionStorage.getItem('cx_logged_in_user');
        const q = questions[currentQuestion];

        // Garantir que temos os campos obrigatórios
        const level = q.level || 1;
        const setor = q.setor || 'CX';
        const seasonId = q.seasonId || 'S-2025-01';

        challengeDebugLog('[Challenge] Question data before submission:', {
            hasLevel: !!q.level,
            hasSetor: !!q.setor,
            hasSeasonId: !!q.seasonId,
            level: level,
            setor: setor,
            seasonId: seasonId,
            questionObject: q
        });

        // Converter índice selecionado para letra original (A, B, C, D)
        const originalLetter = q.optionsMap ? q.optionsMap[selectedOption] : selectedLetter;

        // Generate or use existing idempotency key
        const idempotencyKey = existingIdempotencyKey ||
            (window.IdempotencyUtils ? window.IdempotencyUtils.generateIdempotencyKey(userId, currentChallengeId) : null);

        challengeDebugLog('[Challenge] Submitting answer:', {
            challengeId: currentChallengeId,
            selectedIndex: selectedOption,
            selectedLetter: selectedLetter,
            originalLetter: originalLetter,
            answer: originalLetter,
            userId,
            level,
            setor,
            seasonId,
            timeMs: totalTimeUsed * 1000,
            idempotencyKey: idempotencyKey ? 'present' : 'missing',
            isRetry: !!existingIdempotencyKey
        });

        // Função auxiliar para enviar com chave (para tentativas de reenvio)
        const submitAnswerWithKey = (retryKey) => {
            // Reset state for retry
            answered = false;
            attempts--; // Don't count retry as new attempt
            submitAnswer(reason, retryKey);
        };

        const headers = buildProtectedHeaders({ 'Content-Type': 'application/json' });
        if (idempotencyKey) {
            headers['X-Idempotency-Key'] = idempotencyKey;
        }

        fetch('/api/validate-answer', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                challengeId: currentChallengeId,
                phaseSessionId: getCurrentPhaseSessionId(),
                answer: originalLetter, // Enviar letra original, não a posição atual
                level,
                setor,
                seasonId,
                timeMs: totalTimeUsed * 1000
            }),
            signal: AbortSignal.timeout(10000) // 10 second timeout
        })
            .then(resp => resp.json().then(data => ({ ok: resp.ok, status: resp.status, data })))
            .then(({ ok, status, data }) => {

                challengeDebugLog('[Challenge] Validation response:', { ok, status, data });

                if (data.idempotent) {
                    challengeDebugLog('[Challenge] Idempotent retry successful - using cached result');
                }

                if (!ok) {
                    // Verifica se há erros de infraestrutura (passíveis de nova tentativa)
                    if (data.retryable || status === 500 || status === 503 || status === 408) {
                        console.warn('[Challenge] Infrastructure error detected:', { status, error: data.error });

                        // Mostra a interface de erro de infraestrutura com a opção de tentar novamente
                        if (window.InfrastructureErrorUI) {
                            const errorMessage = data.message || 'Erro de conexão. Tente novamente.';
                            window.InfrastructureErrorUI.showInfrastructureError(errorMessage, () => {
                                challengeDebugLog('[Challenge] Retrying with same idempotency key');
                                submitAnswerWithKey(idempotencyKey);
                            });
                        } else {
                            // Alternativa (fallback) se a interface não estiver carregada
                            alert('Erro de conexão. Sua tentativa não foi consumida. Tente novamente.');
                            answered = false;
                            attempts--;
                            stopSubmitAml();
                            if (submitBtn) submitBtn.classList.remove('loading');
                        }
                        return;
                    }

                    challengeDebugLog('[Challenge] Validation error:', {
                        status,
                        error: data?.error
                    });
                    throw new Error(data.error || 'Falha ao validar');
                }

                correctLetters = data.correctAnswers || [];
                q.awardedXp = data.score ?? q.xp;

                q.attemptsRemaining = typeof data.attempts_remaining === 'number' ? data.attempts_remaining : maxAttempts;

                challengeDebugLog('[Challenge] Attempts remaining:', q.attemptsRemaining);

                if (data.correct && !data.logun_feedback) {
                    const curUser = sessionStorage.getItem('cx_logged_in_user');
                    if (curUser) {
                        const users = getUsersData();
                        const user = users[curUser];

                        if (user) {
                            const awarded = q.awardedXp || q.xp || 0;

                            // CRITICAL: Atualizar storage IMEDIATAMENTE (offline-first)
                            user.xp = (user.xp || 0) + awarded;
                            user.level = Math.floor(user.xp / 500) + 1;
                            if (!user.completedChallenges) user.completedChallenges = [];
                            if (currentChallengeId && !user.completedChallenges.includes(currentChallengeId)) {
                                user.completedChallenges.push(currentChallengeId);
                            }
                            if (!user.attemptHistory) user.attemptHistory = [];
                            user.attemptHistory.push({
                                challenge_id: currentChallengeId,
                                timestamp: new Date().toISOString(),
                                correct: true,
                                time_used: totalTimeUsed * 1000,
                                score: awarded
                            });

                            saveUsersData(users);
                            challengeDebugLog('[Challenge] Storage updated immediately after correct answer');

                            if (currentChallengeId?.startsWith('txt-') || currentChallengeId?.startsWith('lg-')) {
                                queueLogumProgressSync({
                                    awarded,
                                    triggerCriticalEvent: true,
                                    logPrefix: '[Challenge] Logun progress queued for sync'
                                });
                            }

                            // Invalida o cache de validação após a conclusão do desafio
                            if (window.ChallengeValidator && currentChallengeId) {
                                try {
                                    // Invalida o cache do desafio atual
                                    window.ChallengeValidator.invalidateValidationCache(userId, currentChallengeId);

                                    // Também invalida o cache para o próximo desafio (se existir)
                                    if (nextChallengeId) {
                                        window.ChallengeValidator.invalidateValidationCache(userId, nextChallengeId);
                                    }

                                    challengeDebugLog('[Challenge] Validation cache invalidated for completed challenge');
                                } catch (error) {
                                    console.warn('[Challenge] Error invalidating validation cache:', error);
                                }
                            }

                            if (window.AchievementNotifications) {
                                window.AchievementNotifications.check();
                            }

                            // Queue mudanças para sincronização
                            if (!currentChallengeId?.startsWith('txt-') && !currentChallengeId?.startsWith('lg-') && window.progressSync) {
                                window.progressSync.queueChange('xp_gain', { amount: awarded });
                                window.progressSync.queueChange('challenge_complete', {
                                    challenge_id: currentChallengeId
                                });
                                window.progressSync.queueChange('attempt_record', {
                                    challenge_id: currentChallengeId,
                                    timestamp: new Date().toISOString(),
                                    correct: true,
                                    time_used: totalTimeUsed * 1000,
                                    score: awarded
                                });
                                challengeDebugLog('[Challenge] Changes queued for sync');
                            }
                        }
                    }
                }

                finish(!!data.correct, reason);
            })

            .catch((error) => {
                challengeDebugLog('[Challenge] Request failed:', {
                    name: error?.name,
                    message: error?.message
                });

                if (error.name === 'AbortError' || error.message?.includes('timeout')) {
                    console.warn('[Challenge] Request timeout detected');

                    // Mostra a interface de erro de infraestrutura com a opção de tentar novamente
                    if (window.InfrastructureErrorUI) {
                        window.InfrastructureErrorUI.showInfrastructureError(
                            'Tempo esgotado. Tente novamente.',
                            () => {
                                challengeDebugLog('[Challenge] Retrying after timeout with same idempotency key');
                                submitAnswerWithKey(idempotencyKey);
                            }
                        );
                    } else {
                        // Alternativa (fallback) se a interface não estiver carregada
                        alert('Tempo esgotado. Sua tentativa não foi consumida. Tente novamente.');
                        answered = false;
                        attempts--;
                        stopSubmitAml();
                        if (submitBtn) submitBtn.classList.remove('loading');
                    }
                    return;
                }

                // Other network errors
                if (window.InfrastructureErrorUI) {
                    window.InfrastructureErrorUI.showInfrastructureError(
                        'Erro de conexão. Tente novamente.',
                        () => {
                            challengeDebugLog('[Challenge] Retrying after network error with same idempotency key');
                            submitAnswerWithKey(idempotencyKey);
                        }
                    );
                } else {
                    // Fallback
                    finish(false, reason);
                }
            });

    } else {
        // Resposta em texto - valida via API
        const textAnswer = getCachedElement('textAnswer', 'text-answer');
        const textAnswerValue = textAnswer ? textAnswer.value.trim() : '';

        // Validação: resposta vazia
        if (!textAnswerValue) {
            stopSubmitAml();
            if (submitBtn) submitBtn.classList.remove('loading');
            answered = false;
            return;
        }

        // Validação: mínimo 10 caracteres
        if (textAnswerValue.length < 10) {
            stopSubmitAml();
            if (submitBtn) submitBtn.classList.remove('loading');
            answered = false;

            if (textAnswer) {
                textAnswer.style.borderColor = 'var(--er)';
                setTimeout(() => {
                    textAnswer.style.borderColor = '';
                }, 2000);
            }

            const charCount = getCachedElement('charCount', 'char-count');
            if (charCount) {
                const originalText = charCount.textContent;
                charCount.textContent = 'Mínimo 10 caracteres';
                charCount.style.color = 'var(--er)';
                setTimeout(() => {
                    charCount.textContent = originalText;
                    charCount.style.color = '';
                }, 2000);
            }

            return;
        }

        const userId = sessionStorage.getItem('cx_logged_in_user');
        const level = q.level || 1;
        const setor = q.setor || 'CX';
        const seasonId = q.seasonId || 'S-2025-01';

        // Generate or use existing idempotency key
        const idempotencyKey = existingIdempotencyKey ||
            (window.IdempotencyUtils ? window.IdempotencyUtils.generateIdempotencyKey(userId, currentChallengeId) : null);

        challengeDebugLog('[Challenge] Submitting text answer:', {
            challengeId: currentChallengeId,
            answer: textAnswerValue,
            userId,
            level,
            setor,
            seasonId,
            timeMs: totalTimeUsed * 1000,
            idempotencyKey: idempotencyKey ? 'present' : 'missing',
            isRetry: !!existingIdempotencyKey
        });

        // Função auxiliar para enviar com chave (para tentativas de reenvio)
        const submitAnswerWithKey = (retryKey) => {
            // Reset state for retry
            answered = false;
            attempts--; // Don't count retry as new attempt
            submitAnswer(reason, retryKey);
        };

        const headers = buildProtectedHeaders({ 'Content-Type': 'application/json' });
        if (idempotencyKey) {
            headers['X-Idempotency-Key'] = idempotencyKey;
        }

        if (submitBtn) {
            submitBtn.classList.add('loading');
            const _amlStage = submitBtn.querySelector('.aml-stage');
            if (_amlStage) startSubmitAml(_amlStage, CX_AML_IA_FLOW);
        }

        const logunModal = startLogumModalAnalysis(textAnswerValue);
        const logumModalStartedAt = Date.now();

        fetch('/api/validate-answer', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({
                challengeId: currentChallengeId,
                phaseSessionId: getCurrentPhaseSessionId(),
                answer: textAnswerValue,
                level,
                setor,
                seasonId,
                timeMs: totalTimeUsed * 1000
            }),
            signal: AbortSignal.timeout(10000) // 10 second timeout
        })
            .then(resp => resp.json().then(data => ({ ok: resp.ok, status: resp.status, data })))
            .then(({ ok, status, data }) => {
                challengeDebugLog('[Challenge] Text validation response:', { ok, status, data });

                if (data.idempotent) {
                    challengeDebugLog('[Challenge] Idempotent retry successful - using cached result');
                }

                if (!ok) {
                    dismissLogumModalAnalysis(logunModal);

                    // Verifica se há erros de infraestrutura (passíveis de nova tentativa)
                    if (data.retryable || status === 500 || status === 503 || status === 408) {
                        console.warn('[Challenge] Infrastructure error detected:', { status, error: data.error });

                        // Mostra a interface de erro de infraestrutura com a opção de tentar novamente
                        if (window.InfrastructureErrorUI) {
                            const errorMessage = data.message || 'Erro de conexão. Tente novamente.';
                            window.InfrastructureErrorUI.showInfrastructureError(errorMessage, () => {
                                challengeDebugLog('[Challenge] Retrying text answer with same idempotency key');
                                submitAnswerWithKey(idempotencyKey);
                            });
                        } else {
                            // Alternativa (fallback) se a interface não estiver carregada
                            alert('Erro de conexão. Sua tentativa não foi consumida. Tente novamente.');
                            answered = false;
                            attempts--;
                            stopSubmitAml();
                            if (submitBtn) submitBtn.classList.remove('loading');
                        }
                        return;
                    }

                    challengeDebugLog('[Challenge] Validation error:', {
                        status,
                        error: data?.error
                    });
                    finish(false, reason);
                    return;
                }

                if (typeof data.score === 'number') {
                    q.awardedXp = data.score;
                }

                q.attemptsRemaining = maxAttempts;

                challengeDebugLog('[Challenge] Text answer attempts remaining:', q.attemptsRemaining);

                // Se resposta correta, atualizar storage E adicionar à fila IMEDIATAMENTE
                if (data.correct && !data.logun_feedback) {
                    const curUser = sessionStorage.getItem('cx_logged_in_user');
                    if (curUser) {
                        const users = getUsersData();
                        const user = users[curUser];

                        if (user) {
                            const awarded = q.awardedXp || q.xp || 0;

                            // CRITICAL: Atualizar storage IMEDIATAMENTE (offline-first)
                            user.xp = (user.xp || 0) + awarded;
                            user.level = Math.floor(user.xp / 500) + 1;
                            if (!user.completedChallenges) user.completedChallenges = [];
                            if (currentChallengeId && !user.completedChallenges.includes(currentChallengeId)) {
                                user.completedChallenges.push(currentChallengeId);
                            }

                            // Rastreia os desafios do Sentury (desafios de texto validados por IA)
                            if (!user.logumChallenges) user.logumChallenges = [];
                            if (currentChallengeId && !user.logumChallenges.includes(currentChallengeId)) {
                                user.logumChallenges.push(currentChallengeId);
                                challengeDebugLog('[Challenge] Logum challenge completed:', currentChallengeId);
                            }

                            if (!user.attemptHistory) user.attemptHistory = [];
                            user.attemptHistory.push({
                                challenge_id: currentChallengeId,
                                timestamp: new Date().toISOString(),
                                correct: true,
                                time_used: totalTimeUsed * 1000,
                                score: awarded,
                                answer: textAnswerValue
                            });

                            saveUsersData(users);
                            challengeDebugLog('[Challenge] Storage updated immediately after text answer');

                            if (currentChallengeId?.startsWith('txt-') || currentChallengeId?.startsWith('lg-')) {
                                queueLogumProgressSync({
                                    awarded,
                                    answer: textAnswerValue,
                                    triggerCriticalEvent: true,
                                    logPrefix: '[Challenge] Logun text progress queued for sync'
                                });
                            }

                            // Invalida o cache de validação após a conclusão do desafio
                            if (window.ChallengeValidator && currentChallengeId) {
                                try {
                                    // Invalida o cache do desafio atual
                                    window.ChallengeValidator.invalidateValidationCache(userId, currentChallengeId);

                                    // Também invalida o cache para o próximo desafio (se existir)
                                    if (nextChallengeId) {
                                        window.ChallengeValidator.invalidateValidationCache(userId, nextChallengeId);
                                    }

                                    challengeDebugLog('[Challenge] Validation cache invalidated for completed challenge');
                                } catch (error) {
                                    console.warn('[Challenge] Error invalidating validation cache:', error);
                                }
                            }

                            if (window.AchievementNotifications) {
                                window.AchievementNotifications.check();
                            }

                            // Queue mudanças para sincronização
                            if (!currentChallengeId?.startsWith('txt-') && !currentChallengeId?.startsWith('lg-') && window.progressSync) {
                                window.progressSync.queueChange('xp_gain', { amount: awarded });
                                window.progressSync.queueChange('challenge_complete', {
                                    challenge_id: currentChallengeId
                                });
                                window.progressSync.queueChange('attempt_record', {
                                    challenge_id: currentChallengeId,
                                    timestamp: new Date().toISOString(),
                                    correct: true,
                                    time_used: totalTimeUsed * 1000,
                                    score: awarded,
                                    answer: textAnswerValue
                                });
                                challengeDebugLog('[Challenge] Text answer changes queued for sync');
                            }
                        }
                    }
                }

                if (data.logun_feedback) {
                    challengeDebugLog('[Challenge] Logun feedback detected, showing modal');

                    // Remove o estado de carregamento (loading) do botão de envio
                    if (submitBtn) {
                        stopSubmitAml();
                        submitBtn.classList.remove('loading');
                    }

                    // Use global LogunModalIntegration instance
                    if (window.logunModalInstance && window.logunModalInstance.modal) {
                        challengeDebugLog('[Challenge] LogunModalIntegration instance found');
                        const logunModal = window.logunModalInstance.modal;
                        challengeDebugLog('[Challenge] Modal elements:', {
                            overlay: !!logunModal.elements.overlay,
                            analysisText: !!logunModal.elements.analysisText
                        });

                        const originalOnClose = logunModal.options.onClose;
                        logunModal.options.onClose = () => {
                            challengeDebugLog('[Challenge] Logun modal closed, continuing flow');
                            // Restore original callback
                            logunModal.options.onClose = originalOnClose;
                            finishLogumChallenge(data, reason);
                        };

                        if (!logunModal.state.isVisible) {
                            startLogumModalAnalysis(textAnswerValue);
                        }

                        // Transforma a resposta do backend no formato do modal
                        const modalResult = {
                            approved: data.correct,
                            criteria: [
                                data.logun_feedback.feedback?.empatia !== false,
                                data.logun_feedback.feedback?.solucao_clara !== false,
                                data.logun_feedback.feedback?.tom_profissional !== false,
                                data.logun_feedback.feedback?.proximo_passo !== false
                            ],
                            title: data.correct ? "Resposta aprovada" : "Vamos revisar melhor",
                            message: data.logun_feedback.sugestoes?.[0] || (data.correct ? "Sua resposta está adequada." : "Sua resposta precisa de ajustes."),
                            opinion: data.logun_feedback.sugestoes?.[1] || "Continue praticando para melhorar suas habilidades de atendimento.",
                            confidence: Math.round(data.logun_feedback.confianca * 100)
                        };

                        challengeDebugLog('[Challenge] Modal result prepared:', modalResult);
                        showLogumModalResult(logunModal, buildLogumModalResult(data), logumModalStartedAt);
                        return;
                    } else {
                        console.warn('[Challenge] LogunModalIntegration not initialized, falling back to standard feedback');
                        console.warn('[Challenge] window.logunModalInstance:', !!window.logunModalInstance);
                        console.warn('[Challenge] window.logunModalInstance.modal:', !!window.logunModalInstance?.modal);
                        finishLogumChallenge(data, reason);
                    }
                } else {
                    // Standard feedback for non-Sentury questions
                    dismissLogumModalAnalysis(logunModal);
                    finish(!!data.correct, reason);
                }
            })
            .catch(err => {
                challengeDebugLog('[Challenge] Validation request failed:', {
                    name: err?.name,
                    message: err?.message
                });
                dismissLogumModalAnalysis(logunModal);

                if (err.name === 'AbortError' || err.message?.includes('timeout')) {
                    console.warn('[Challenge] Request timeout detected');

                    // Mostra a interface de erro de infraestrutura com a opção de tentar novamente
                    if (window.InfrastructureErrorUI) {
                        window.InfrastructureErrorUI.showInfrastructureError(
                            'Tempo esgotado. Tente novamente.',
                            () => {
                                challengeDebugLog('[Challenge] Retrying text answer after timeout with same idempotency key');
                                submitAnswerWithKey(idempotencyKey);
                            }
                        );
                    } else {
                        // Alternativa (fallback) se a interface não estiver carregada
                        alert('Tempo esgotado. Sua tentativa não foi consumida. Tente novamente.');
                        answered = false;
                        attempts--;
                        stopSubmitAml();
                        if (submitBtn) submitBtn.classList.remove('loading');
                    }
                    return;
                }

                // Other network errors
                if (window.InfrastructureErrorUI) {
                    window.InfrastructureErrorUI.showInfrastructureError(
                        'Erro de conexão. Tente novamente.',
                        () => {
                            challengeDebugLog('[Challenge] Retrying text answer after network error with same idempotency key');
                            submitAnswerWithKey(idempotencyKey);
                        }
                    );
                } else {
                    // Fallback
                    finish(false, reason);
                }
            });
    }
}

// Feedback
function showFeedback(isCorrect, q, reason = 'answer', correctList = [], selectedLetter = null) {
    const overlay = getCachedElement('feedbackOverlay', 'feedback-overlay');
    const iconCorrect = getCachedElement('feedbackIconCorrect', 'feedback-icon-correct');
    const iconWrong = getCachedElement('feedbackIconWrong', 'feedback-icon-wrong');
    const title = getCachedElement('feedbackTitle', 'feedback-title');
    const text = getCachedElement('feedbackText', 'feedback-text');
    const xpDisplay = getCachedElement('feedbackXp', 'feedback-xp');
    const nextBtn = getCachedElement('nextBtn', 'btn-next');

    if (isCorrect) {
        const awardedXP = q.awardedXp || q.xp || 0;
        const multiplier = XP_MULTIPLIERS[attempts - 1] || 1.0;
        const multiplierPercent = Math.round(multiplier * 100);

        if (iconCorrect) iconCorrect.style.display = '';
        if (iconWrong) iconWrong.style.display = 'none';
        if (title) {
            title.textContent = 'Resposta Correta!';
            title.className = 'feedback-title feedback-title--correct';
        }

        // Mostra o XP com informações do multiplicador se não for a primeira tentativa
        if (text) {
            if (attempts === 1) {
                text.innerHTML = `Parabéns! Você ganhou <strong>+${awardedXP} XP</strong> por essa questão.`;
            } else {
                text.innerHTML = `Parabéns! Você ganhou <strong>+${awardedXP} XP</strong> (${multiplierPercent}% por tentativa ${attempts}).`;
            }
        }

        if (xpDisplay) {
            xpDisplay.textContent = `+${awardedXP} XP`;
            xpDisplay.className = 'feedback-xp feedback-xp--correct';
        }
        if (nextBtn) {
            nextBtn.dataset.retry = 'false';
            nextBtn.dataset.exhausted = 'false';
        }
    } else {
        if (iconCorrect) iconCorrect.style.display = 'none';
        if (iconWrong) iconWrong.style.display = '';

        const attemptsExhausted = false;

        if (title) {
            title.textContent = reason === 'timeout' ? 'Tempo esgotado' : 'Resposta Incorreta';
            title.className = 'feedback-title feedback-title--wrong';
        }

        const helper = 'Você pode tentar novamente.';

        if (text) {
            if (q.type === 'multiple') {
                text.innerHTML = reason === 'timeout'
                    ? `O tempo acabou antes da resposta. ${helper}`
                    : `Resposta incorreta. ${helper}`;
            } else {
                text.innerHTML = reason === 'timeout'
                    ? `O tempo acabou antes da resposta. ${helper}`
                    : `Tente novamente na proxima vez! ${helper}`;
            }
        }
        if (xpDisplay) {
            xpDisplay.textContent = '+0 XP';
            xpDisplay.className = 'feedback-xp feedback-xp--wrong';
        }

        if (nextBtn) {
            nextBtn.dataset.retry = 'true';
            nextBtn.dataset.exhausted = 'false';
            nextBtn.disabled = false;
        }
    }

    if (overlay) {
        overlay.classList.add('show');
    }
    const actionBar = getCachedElement('actionBar', 'action-bar');
    const nextBar = getCachedElement('nextBar', 'next-bar');
    if (actionBar) actionBar.style.display = 'none';
    if (nextBar) nextBar.style.display = '';

    if (nextBtn) {
        const nextText = nextBtn.querySelector('.btn-text');
        if (nextText) {
            if (!isCorrect && nextBtn.dataset.retry === 'true' && nextBtn.dataset.exhausted !== 'true') {
                nextText.textContent = 'Tentar novamente';
            } else if (nextBtn.dataset.exhausted === 'true') {
                nextText.textContent = 'Próximo Desafio';
            } else {
                nextText.textContent = 'Continuar';
            }
        }

        // Redirecionamento automático quando as tentativas estiverem esgotadas
        if (nextBtn.dataset.exhausted === 'true') {
            challengeDebugLog('[Challenge] Attempts exhausted - auto-redirecting in 3 seconds');

            const curUser = sessionStorage.getItem('cx_logged_in_user');
            if (curUser) {
                const users = getUsersData();
                const user = users[curUser];

                if (user) {
                    if (!user.failedChallenges) user.failedChallenges = [];
                    if (currentChallengeId && !user.failedChallenges.includes(currentChallengeId)) {
                        user.failedChallenges.push(currentChallengeId);
                        saveUsersData(users);
                        challengeDebugLog('[Challenge] Failed challenge registered:', currentChallengeId);

                        if (window.AchievementNotifications) {
                            window.AchievementNotifications.check();
                        }
                    }
                }
            }

            setTimeout(() => {
                if (hasNextFlowNode()) {
                    challengeDebugLog('[Challenge] Redirecting to next flow node:', nextFlowNode || nextChallengeId);
                    navigateToNextNode();
                } else {
                    challengeDebugLog('[Challenge] No next challenge - redirecting to home');
                    window.location.href = '/app';
                }
            }, 3000); // Atraso de 3 segundos para mostrar a mensagem
        }
    }
}

function showAchievementUnlocked(title, icon, description) {
    const notification = document.createElement('div');
    notification.className = 'achievement-unlock-notification';
    notification.innerHTML = `
        <div class="achievement-unlock-icon">${icon}</div>
        <div class="achievement-unlock-text">
            <strong>Conquista Desbloqueada!</strong>
            <p class="achievement-unlock-title">${title}</p>
            <p class="achievement-unlock-desc">${description}</p>
        </div>
    `;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        color: white;
        padding: 1.5rem 2rem;
        border-radius: 16px;
        box-shadow: 0 10px 40px rgba(0,0,0,0.4);
        z-index: 10001;
        display: flex;
        align-items: center;
        gap: 1.5rem;
        animation: achievementSlideIn 0.6s cubic-bezier(0.68, -0.55, 0.265, 1.55);
        max-width: 90%;
        width: 400px;
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'achievementSlideOut 0.5s ease-out';
        setTimeout(() => notification.remove(), 500);
    }, 5000);
}

// Next question
let isProcessingNext = false; // Flag para prevenir double-click

function nextQuestion() {
    // Proteção contra double-click
    if (isProcessingNext) {
        challengeDebugLog('[Challenge] nextQuestion already processing, ignoring click');
        return;
    }

    isProcessingNext = true;

    const nextBtn = getCachedElement('nextBtn', 'btn-next');

    // Desabilitar botão visualmente
    if (nextBtn) {
        nextBtn.disabled = true;
        nextBtn.style.opacity = '0.6';
        nextBtn.style.cursor = 'not-allowed';
    }

    const retry = nextBtn && nextBtn.dataset.retry === 'true';
    const exhausted = nextBtn && nextBtn.dataset.exhausted === 'true';

    if (retry) {
        answered = false;
        renderQuestion(currentQuestion, false).then(() => {
            updateAttemptsCard();
            if (nextBtn) nextBtn.dataset.retry = 'false';

            if (nextBtn) {
                nextBtn.disabled = false;
                nextBtn.style.opacity = '';
                nextBtn.style.cursor = '';
            }
            isProcessingNext = false;
        });
        return;
    }

    currentQuestion++;
    if (currentQuestion >= questions.length) {
        showCompletion();
        return; // Não liberar flag aqui pois showCompletion é async
    }
    renderQuestion(currentQuestion, true).then(() => {
        if (nextBtn) {
            nextBtn.disabled = false;
            nextBtn.style.opacity = '';
            nextBtn.style.cursor = '';
        }
        isProcessingNext = false;
    });
}

// Skip
function skipQuestion() {
    answered = true;
    clearInterval(timerInterval);
    const q = questions[currentQuestion];
    showFeedback(false, q, 'skip');
}

// Completion
async function showCompletion() {
    const overlay = getCachedElement('completionOverlay', 'completion-overlay');
    const compCorrect = getCachedElement('compCorrect', 'comp-correct');
    const compXp = getCachedElement('compXp', 'comp-xp');
    const compTime = getCachedElement('compTime', 'comp-time');

    if (compCorrect) compCorrect.textContent = correctCount;
    if (compXp) compXp.textContent = totalXP;

    const mins = Math.floor(totalTimeUsed / 60);
    const secs = totalTimeUsed % 60;
    if (compTime) compTime.textContent = `${mins}:${String(secs).padStart(2, '0')}`;

    const q = questions[currentQuestion] || questions[0];
    const attemptsExhausted = false;
    const isSuccess = (correctCount > 0 || questions[0].type === 'text');

    const titleEl = document.querySelector('.completion-title');
    const subtitleEl = document.querySelector('.completion-subtitle');
    if (isSuccess) {
        if (titleEl) titleEl.textContent = 'Desafio Completo!';
        if (subtitleEl) subtitleEl.textContent = 'Voce finalizou o Desafio EC';
    } else {
        if (titleEl) titleEl.textContent = 'Opa, nao foi bem assim...';
        if (subtitleEl) subtitleEl.textContent = 'A resposta esta incorreta. Que tal tentar mais uma vez?';
    }

    const loggedInUser = sessionStorage.getItem('cx_logged_in_user');
    if (loggedInUser) {
        try {
            const currentLevel = q.level || 1;
            const statusMap = await loadServerChallengeStatusMap(q.seasonId || 'S-2025-01');
            const statusData = Array.from(statusMap.values()).filter(item =>
                Number(item.level || getLevelFromChallengeId(item.challenge_id, currentLevel)) === Number(currentLevel)
            );

            if (statusData.length > 0) {
                // Conta os desafios concluídos + falhos neste nível
                const localUser = getUsersData()[loggedInUser] || {};
                const progressFlow = window.ProgressFlow || null;
                const mergedProgress = progressFlow?.mergeProgressSources
                    ? progressFlow.mergeProgressSources(localUser, window.progressSync?.lastSyncedState || {})
                    : null;
                const completedGameIds = mergedProgress
                    ? Array.from(
                        progressFlow?.buildCompletedBaseSet
                            ? progressFlow.buildCompletedBaseSet(
                                mergedProgress.completedChallenges,
                                mergedProgress.completedMinigames
                            )
                            : mergedProgress.completedChallenges
                    )
                    : (localUser.completedChallenges || []);

                const completedGameNodes = (intermissionManifest?.nodes || []).filter(node => {
                    if (node.type !== 'game') return false;
                    const flowChallengeId = window.IntermissionFlow?.resolveFlowChallengeId?.(node)
                        || node.flow_challenge_id
                        || node.synthetic_challenge_id;
                    return Boolean(flowChallengeId && completedGameIds.includes(flowChallengeId));
                }).length;

                const processedCount = statusData.filter(s =>
                    s.status === 'completed' || s.status === 'failed'
                ).length + completedGameNodes;

                const completedCount = statusData.filter(s => s.status === 'completed').length + completedGameNodes;
                const totalChallenges = intermissionManifest?.total_nodes || 20;

                challengeDebugLog('[Challenge] Level progress:', {
                    level: currentLevel,
                    processed: processedCount,
                    completed: completedCount,
                    total: totalChallenges
                });

                // Se processou todos os desafios (20), mostrar mensagem de desbloqueio
                if (processedCount >= totalChallenges) {
                    const isComplete = completedCount >= totalChallenges;
                    const nextLevel = currentLevel + 1;

                    if (nextLevel <= 3) {
                        const unlockNotification = document.createElement('div');
                        unlockNotification.className = 'level-unlock-notification';
                        unlockNotification.innerHTML = `
                                <div class="unlock-icon">${nextLevel === 2 ? '⚡' : '👑'}</div>
                                <div class="unlock-text">
                                    <strong>Nível ${nextLevel} Desbloqueado!</strong>
                                    <p>Nível ${currentLevel} ${isComplete ? 'completado 100%' : 'concluído'}</p>
                                </div>
                            `;
                        unlockNotification.style.cssText = `
                                position: fixed;
                                top: 20px;
                                right: 20px;
                                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                                color: white;
                                padding: 1rem 1.5rem;
                                border-radius: 12px;
                                box-shadow: 0 10px 40px rgba(0,0,0,0.3);
                                z-index: 10000;
                                display: flex;
                                align-items: center;
                                gap: 1rem;
                                animation: slideInRight 0.5s ease-out;
                            `;

                        document.body.appendChild(unlockNotification);

                        setTimeout(() => {
                            unlockNotification.style.animation = 'slideOutRight 0.5s ease-out';
                            setTimeout(() => unlockNotification.remove(), 500);
                        }, 5000);
                    }
                }
            }
        } catch (error) {
            console.error('[Challenge] Error checking level completion:', error);
        }
    }

    let isSyncing = false;
    if (loggedInUser && isSuccess) {
        // localStorage já foi atualizado em submitAnswer(), apenas disparar sync
        if (window.progressSync && window.progressSync.syncQueue.length > 0) {
            isSyncing = true;
            challengeDebugLog('[Challenge] Triggering sync from showCompletion');

            const actionsContainer = document.querySelector('.completion-actions');
            const savingIndicator = document.createElement('div');
            savingIndicator.id = 'saving-indicator';
            savingIndicator.style.cssText = 'text-align:center;margin-bottom:1rem;color:#ffd700;font-size:0.9rem;';
            savingIndicator.innerHTML = '💾 Salvando progresso...';
            actionsContainer.parentElement.insertBefore(savingIndicator, actionsContainer);

            // Escutar evento de sync bem-sucedido
            const onSyncSuccess = () => {
                const indicator = document.getElementById('saving-indicator');
                if (indicator) {
                    indicator.innerHTML = '✅ Progresso salvo!';
                    indicator.style.color = '#00ff00';
                    setTimeout(() => {
                        indicator.style.opacity = '0';
                        indicator.style.transition = 'opacity 0.5s';
                        setTimeout(() => indicator.remove(), 500);
                    }, 2000);
                }

                // Habilitar botão "Próximo Desafio"
                const nextBtn = document.getElementById('next-challenge-btn');
                if (nextBtn) {
                    nextBtn.disabled = false;
                }

                window.progressSync.off('sync:success', onSyncSuccess);
            };

            const onSyncError = (error) => {
                const indicator = document.getElementById('saving-indicator');
                if (indicator) {
                    indicator.innerHTML = '⚠️ Erro ao salvar - Tente novamente';
                    indicator.style.color = '#ff4444';
                }

                // Habilitar botão mesmo com erro para não bloquear o usuário
                const nextBtn = document.getElementById('next-challenge-btn');
                if (nextBtn) {
                    nextBtn.disabled = false;
                }

                window.progressSync.off('sync:error', onSyncError);
            };

            window.progressSync.on('sync:success', onSyncSuccess);
            window.progressSync.on('sync:error', onSyncError);

            window.progressSync.onCriticalEvent();
        }
    }

    const actionsContainer = document.querySelector('.completion-actions');

    if (isSuccess && hasNextFlowNode()) {
        // Há próximo desafio
        actionsContainer.innerHTML = `
            <a href="/app" class="action-btn action-btn--ghost">Voltar ao Inicio</a>
            <button id="next-challenge-btn" class="action-btn action-btn--primary" ${isSyncing ? 'disabled' : ''} onclick="navigateToNextNode()">
                <span class="btn-text">Proximo Desafio</span>
                <svg class="btn-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                <div class="btn-shine"></div>
            </button>
        `;
    } else if (isSuccess && !hasNextFlowNode()) {
        // Último desafio completado - apenas voltar ao início
        actionsContainer.innerHTML = `
            <a href="/app" class="action-btn action-btn--primary">
                <span class="btn-text">Voltar ao Inicio</span>
                <svg class="btn-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                <div class="btn-shine"></div>
            </a>
        `;
    } else {
        actionsContainer.innerHTML = `
            <a href="/app" class="action-btn action-btn--ghost">Voltar ao Dashboard</a>
            <button class="action-btn action-btn--primary" onclick="restartChallenge()">
                <span class="btn-text">Tentar Novamente</span>
                <svg class="btn-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                <div class="btn-shine"></div>
            </button>
        `;
    }

    overlay.classList.add('show');
}

// Restart
function restartChallenge() {
    currentQuestion = 0;
    totalXP = 0;
    correctCount = 0;
    totalTimeUsed = 0;
    attempts = 0;
    const xpCount = getCachedElement('xpCount', 'xp-count');
    if (xpCount) {
        xpCount.textContent = '0';
    }
    const completionOverlay = getCachedElement('completionOverlay', 'completion-overlay');
    if (completionOverlay) completionOverlay.classList.remove('show');
    renderQuestion(0, true);
}

// Scroll shadow
window.addEventListener('scroll', () => {
    const header = getCachedElement('header', 'header');
    if (header) header.classList.toggle('scrolled', window.scrollY > 10);
}, { passive: true });



