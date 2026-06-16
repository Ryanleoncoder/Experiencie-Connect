function homeDebugLog(...args) {
    if (typeof window !== 'undefined' && window.CX_DEBUG === true) {
        console.debug(...args);
    }
}

function getStorageType() {
    if (sessionStorage.getItem('cx_logged_in_user')) {
        return sessionStorage;
    }
    if (localStorage.getItem('cx_logged_in_user')) {
        return localStorage;
    }
    return window.CxSession?.getPrimaryStorage?.() || sessionStorage;
}

function getLoggedInUser() {
    return window.CxSession?.getSessionValue?.('cx_logged_in_user') || getStorageType().getItem('cx_logged_in_user');
}

function getUsersData() {
    const storage = getStorageType();
    return JSON.parse(storage.getItem('cx_users') || '{}');
}

function saveUsersData(users) {
    const storage = getStorageType();
    storage.setItem('cx_users', JSON.stringify(users));
}

function getCxSessionToken() {
    return window.CxSession?.getSessionValue?.('cx_session_token') || '';
}

function buildProtectedHeaders(extraHeaders = {}) {
    const token = getCxSessionToken();
    return token
        ? { ...extraHeaders, Authorization: `Bearer ${token}` }
        : { ...extraHeaders };
}

const GENERIC_PUBLIC_DISPLAY_NAMES = new Set([
    'agente ec',
    'agente secreto',
    'nome oculto'
]);

function getSessionPublicDisplayName() {
    return String(window.CxSession?.getSessionValue?.('cx_display_name') || '').trim();
}

function getSessionPublicRankingCode() {
    return String(window.CxSession?.getSessionValue?.('cx_ranking_code') || '').trim();
}

function getPublicDisplayName(user, fallback = 'Agente EC') {
    const displayName = String(
        user?.display_name
        || user?.displayName
        || getSessionPublicDisplayName()
        || ''
    ).trim();

    return displayName || fallback;
}

function getPublicRankingCode(user) {
    return String(
        user?.ranking_code
        || user?.rankingCode
        || getSessionPublicRankingCode()
        || ''
    ).trim();
}

function hasUsablePublicDisplayName(name) {
    const normalized = String(name || '').trim().toLowerCase();
    return Boolean(normalized) && !GENERIC_PUBLIC_DISPLAY_NAMES.has(normalized);
}

function normalizeRankingEntry(entry) {
    const rankingCode = String(
        entry?.ranking_code
        || entry?.rankingCode
        || entry?.publicId
        || ''
    ).trim();
    const displayName = String(
        entry?.display_name
        || entry?.displayName
        || entry?.name
        || ''
    ).trim();

    return {
        rank: Number(entry?.rank ?? entry?.position ?? 0),
        rankingCode,
        rankingCodeLower: rankingCode.toLowerCase(),
        displayName,
        displayNameLower: displayName.toLowerCase()
    };
}

function resolveCurrentUserRankEntry(user, ranking) {
    const userRankingCode = getPublicRankingCode(user).toLowerCase();
    const userDisplayName = String(getPublicDisplayName(user, '')).trim().toLowerCase();

    if (!userRankingCode && !userDisplayName) {
        return null;
    }

    const normalizedRanking = ranking
        .filter(entry => entry && typeof entry === 'object')
        .map(normalizeRankingEntry);

    const exactCodeMatch = userRankingCode
        ? normalizedRanking.find(entry => entry.rankingCodeLower === userRankingCode)
        : null;

    if (exactCodeMatch) {
        return exactCodeMatch;
    }

    if (!hasUsablePublicDisplayName(userDisplayName)) {
        return null;
    }

    const displayMatches = normalizedRanking.filter(entry => entry.displayNameLower === userDisplayName);
    return displayMatches.length === 1 ? displayMatches[0] : null;
}

function hydrateUserPublicIdentity(user) {
    if (!user || typeof user !== 'object') {
        return { user, changed: false };
    }

    const sessionDisplayName = getSessionPublicDisplayName();
    const sessionRankingCode = getSessionPublicRankingCode();
    let changed = false;
    const nextUser = { ...user };

    if (!String(user.display_name || user.displayName || '').trim() && sessionDisplayName) {
        nextUser.display_name = sessionDisplayName;
        changed = true;
    }

    if (!String(user.ranking_code || user.rankingCode || '').trim() && sessionRankingCode) {
        nextUser.ranking_code = sessionRankingCode;
        changed = true;
    }

    return {
        user: changed ? nextUser : user,
        changed
    };
}

function getProgressFlowApi() {
    return window.ProgressFlow || null;
}

function getChallengeId(challenge) {
    const progressFlow = getProgressFlowApi();
    if (progressFlow?.getChallengeId) {
        return progressFlow.getChallengeId(challenge);
    }

    if (!challenge) return null;
    if (typeof challenge === 'string') return challenge;
    return challenge.id || challenge.challenge_id || null;
}

function getChallengeStatusValue(challengeStatusMap, challengeId) {
    const progressFlow = getProgressFlowApi();
    if (progressFlow?.getStatusForId) {
        return progressFlow.getStatusForId(challengeId, challengeStatusMap);
    }

    const entry = challengeStatusMap?.get?.(challengeId);
    return typeof entry === 'string' ? entry : entry?.status || null;
}

function getDisplayCompletedTotal(user) {
    const completedChallenges = new Set(user.completedChallenges || []);
    const progressFlow = getProgressFlowApi();
    let completedMinigamesCount = 0;

    (user.completedMinigames || []).forEach(minigameId => {
        const intermissionId = progressFlow?.normalizeMinigameCompletionId
            ? progressFlow.normalizeMinigameCompletionId(minigameId)
            : null;

        if (!intermissionId || !completedChallenges.has(intermissionId)) {
            completedMinigamesCount += 1;
        }
    });

    return completedChallenges.size + completedMinigamesCount;
}

function refreshUserAfterProgressSync(loggedInUser, currentUser) {
    const users = getUsersData();
    const storedUser = users[loggedInUser] || currentUser || {};
    const syncedState = window.progressSync?.lastSyncedState;
    const progressFlow = getProgressFlowApi();
    const refreshedUser = {
        ...currentUser,
        ...storedUser
    };

    if (syncedState) {
        const mergedProgress = progressFlow?.mergeProgressSources
            ? progressFlow.mergeProgressSources(refreshedUser, syncedState)
            : null;

        refreshedUser.id = syncedState.user_id || refreshedUser.id;
        refreshedUser.display_name = syncedState.display_name || refreshedUser.display_name;
        refreshedUser.ranking_code = syncedState.ranking_code || refreshedUser.ranking_code;
        refreshedUser.avatar_file_name = syncedState.avatar_file_name || refreshedUser.avatar_file_name;
        refreshedUser.xp = mergedProgress?.xp ?? syncedState.xp ?? refreshedUser.xp ?? 0;
        refreshedUser.level = mergedProgress?.level ?? syncedState.level ?? refreshedUser.level ?? 1;
        refreshedUser.completedChallenges = mergedProgress?.completedChallenges
            || syncedState.completed_challenges
            || refreshedUser.completedChallenges
            || [];
        refreshedUser.completedMinigames = mergedProgress?.completedMinigames
            || syncedState.completed_minigames
            || refreshedUser.completedMinigames
            || [];
        refreshedUser.failedChallenges = mergedProgress?.failedChallenges
            || refreshedUser.failedChallenges
            || [];
        refreshedUser.attemptHistory = mergedProgress?.attemptHistory
            || syncedState.attempt_history
            || refreshedUser.attemptHistory
            || [];
    }

    users[loggedInUser] = refreshedUser;
    saveUsersData(users);
    return refreshedUser;
}

function updateUserSnapshotUI(user) {
    const headerLevel = getCachedElement('headerUserLevel', 'header-user-level');
    if (headerLevel) headerLevel.textContent = `Nível ${user.level || 1}`;

    const headerXp = getCachedElement('headerUserXp', 'header-user-xp');
    if (headerXp) headerXp.textContent = `${user.xp || 0} XP`;

    const mobileLevel = getCachedElement('mobileUserLevel', 'mobile-user-level');
    if (mobileLevel) mobileLevel.textContent = `Nível ${user.level || 1}`;

    const statNumXp = getCachedElement('statNumXp', 'stat-num-xp');
    if (statNumXp) statNumXp.textContent = user.xp || 0;

    const statNumCompleted = getCachedElement('statNumCompleted', 'stat-num-completed');
    if (statNumCompleted) statNumCompleted.textContent = getDisplayCompletedTotal(user);
}

function getInitials(name) {
    if (!name) return 'EC';
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function clearHomeSkeleton(element) {
    if (!element) return;
    element.classList.remove('home-skeleton-text');
    element.classList.remove('home-skeleton-text--name');
    element.classList.remove('home-skeleton-text--level');
    element.classList.remove('home-skeleton-text--xp');
}

function updateUserIdentityUI(user) {
    const publicDisplayName = getPublicDisplayName(user);
    const initials = getInitials(publicDisplayName);

    const headerUserName = getCachedElement('headerUserName', 'header-user-name');
    if (headerUserName) {
        headerUserName.textContent = publicDisplayName;
        clearHomeSkeleton(headerUserName);
    }

    const mobileName = getCachedElement('mobileUserName', 'mobile-user-name');
    if (mobileName) {
        mobileName.textContent = publicDisplayName;
        clearHomeSkeleton(mobileName);
    }

    updateUserSnapshotUI(user);
    [
        getCachedElement('headerUserLevel', 'header-user-level'),
        getCachedElement('headerUserXp', 'header-user-xp'),
        getCachedElement('mobileUserLevel', 'mobile-user-level')
    ].forEach(clearHomeSkeleton);

    const updateAvatar = (container, isLarge = false) => {
        if (!container) return;

        if (user.avatar_file_name) {
            const avatarPath = `/frontend/assets/image/avatar/${user.avatar_file_name}`;
            const existingImg = container.querySelector('.user-avatar__img');
            if (existingImg && existingImg.getAttribute('src') === avatarPath) {
                // Image already matches, do not clear and recreate
                return;
            }

            container.innerHTML = '';

            const img = document.createElement('img');
            img.src = avatarPath;
            img.alt = publicDisplayName;
            img.className = 'user-avatar__img';
            img.draggable = false;
            img.addEventListener('dragstart', event => event.preventDefault());

            img.onerror = () => {
                container.innerHTML = `<span class="user-avatar__initials">${initials}</span>`;
            };

            container.appendChild(img);
        } else {
            container.innerHTML = `<span class="user-avatar__initials">${initials}</span>`;
        }

        if (!isLarge) {
            const statusIndicator = document.createElement('div');
            statusIndicator.className = 'avatar-status';
            container.appendChild(statusIndicator);
        }
    };

    updateAvatar(document.getElementById('header-user-avatar'), false);
    updateAvatar(document.getElementById('mobile-user-avatar'), true);
}

function toggleMobileMenu() {
    const btn = document.getElementById('mobile-menu-btn');
    const nav = document.getElementById('mobile-nav');
    const overlay = document.getElementById('mobile-nav-overlay');
    const isOpen = nav.classList.contains('open');

    btn.classList.toggle('active');
    nav.classList.toggle('open');
    overlay.classList.toggle('visible');
    document.body.style.overflow = isOpen ? '' : 'hidden';
}

/**
 * Exibe um toast informando que outra aba ja esta em um desafio.
 * O usuario deve terminar ou fechar a outra aba.
 */
function showDuplicateSessionToast() {
    const existing = document.getElementById('cx-duplicate-session-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'cx-duplicate-session-toast';
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');
    toast.style.cssText = [
        'position: fixed',
        'bottom: 24px',
        'left: 50%',
        'transform: translateX(-50%)',
        'background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)',
        'color: #fff',
        'padding: 14px 22px',
        'border-radius: 12px',
        'border: 1px solid rgba(255, 165, 0, 0.4)',
        'box-shadow: 0 8px 32px rgba(0,0,0,0.4)',
        'font-size: 14px',
        'font-weight: 500',
        'z-index: 9999',
        'max-width: 90vw',
        'display: flex',
        'align-items: center',
        'gap: 10px',
        'animation: cx-toast-in 0.3s ease-out'
    ].join('; ');

    toast.innerHTML = [
        '<span style="font-size:20px">⚠️</span>',
        '<div>',
        '  <div style="font-weight:700;margin-bottom:2px">Desafio aberto em outra aba</div>',
        '  <div style="opacity:0.85;font-size:13px">Termine ou feche a outra aba antes de iniciar um novo desafio.</div>',
        '</div>',
        '<button onclick="this.parentElement.remove()" aria-label="Fechar" style="background:none;border:none;color:#fff;cursor:pointer;font-size:18px;padding:0 4px;margin-left:8px;opacity:0.7">✕</button>'
    ].join('');

    // Injetar estilo da animacao se ainda nao existe
    if (!document.getElementById('cx-toast-style')) {
        const style = document.createElement('style');
        style.id = 'cx-toast-style';
        style.textContent = '@keyframes cx-toast-in { from { opacity:0; transform:translateX(-50%) translateY(16px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }';
        document.head.appendChild(style);
    }

    document.body.appendChild(toast);

    // Auto-remover apos 7 segundos
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.4s'; setTimeout(() => toast.remove(), 400); }, 7000);
}

async function handleLogout() {
    const header = document.getElementById('header');

    homeDebugLog('[Home] Logout initiated, syncing pending changes...');

    // Sync before logout - FORÇAR SYNC IMEDIATO
    if (window.progressSync && window.progressSync.initialized) {
        try {
            if (window.progressSync.syncQueue.length > 0) {
                homeDebugLog('[Home] Pending changes detected, forcing immediate sync...');

                // Cancelar qualquer debounce pendente
                if (window.progressSync.debounceTimer) {
                    clearTimeout(window.progressSync.debounceTimer);
                }

                // Forçar sync imediato
                const result = await window.progressSync.syncWithRetry();

                if (result.success) {
                    homeDebugLog('[Home] ✓ Final sync completed successfully');
                } else {
                    console.error('[Home] ✗ Final sync failed:', result.error);

                    // Perguntar ao usuário se quer continuar
                    const confirmLogout = confirm(
                        'Não foi possível sincronizar suas mudanças. Deseja sair mesmo assim? Você pode perder progresso não salvo.'
                    );

                    if (!confirmLogout) {
                        homeDebugLog('[Home] Logout cancelled by user');
                        return;
                    }
                }
            } else {
                homeDebugLog('[Home] No pending changes to sync');
            }
        } catch (error) {
            console.error('[Home] Error syncing before logout:', error);

            // Perguntar ao usuário se quer continuar
            const confirmLogout = confirm(
                'Erro ao sincronizar. Deseja sair mesmo assim? Você pode perder progresso não salvo.'
            );

            if (!confirmLogout) {
                homeDebugLog('[Home] Logout cancelled by user');
                return;
            }
        }
    }

    // Animação de saída
    document.body.style.opacity = '0';
    document.body.style.transition = 'opacity 0.4s ease';

    setTimeout(() => {
        window.CxSession?.clearSessionState?.();
        window.location.replace('login.html');
    }, 400);
}

window.addEventListener('scroll', () => {
    const header = document.getElementById('header');
    if (window.scrollY > 10) {
        header.classList.add('scrolled');
    } else {
        header.classList.remove('scrolled');
    }
}, { passive: true });

let globalObserver = null;

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
        }
    });
}, { threshold: 0.1 });

globalObserver = observer;

const domCache = {
    statNumXp: null,
    statNumCompleted: null,
    statNumRank: null,
    headerUserName: null,
    headerUserLevel: null,
    mobileUserName: null,
    mobileUserLevel: null
};



const VIEW_CONFIG = {
    levels: {
        title: 'Desafios <span class="text-yellow">EC</span>',
        subtitle: 'Evolua sua jornada em Experience Connect'
    }
};

const homeViewState = {
    data: null,
    user: null,
    seasonId: null,
    renderRequestId: 0
};

// Função auxiliar para obter elemento DOM em cache
function getCachedElement(cacheKey, elementId) {
    if (!domCache[cacheKey]) {
        domCache[cacheKey] = document.getElementById(elementId);
    }
    return domCache[cacheKey];
}

async function updateUserRanking(user) {
    const statNumRank = getCachedElement('statNumRank', 'stat-num-rank');
    if (!statNumRank) {
        console.warn('[Home] Ranking stat element not found');
        return;
    }

    statNumRank.textContent = '';

    try {
        homeDebugLog('[Home] Fetching ranking data...');

        const data = await window.VPSClient.getJSONFromVPS('/ranking/current');

        if (!data.ranking || !Array.isArray(data.ranking)) {
            console.warn('[Home] Invalid ranking data format');
            statNumRank.textContent = '--';
            return;
        }

        homeDebugLog(`[Home] Ranking loaded: ${data.ranking.length} players`);

        const hasLegacyIdentityFields = data.ranking.some(entry =>
            entry && typeof entry === 'object' && ('user_id' in entry || 'nickname' in entry)
        );
        if (hasLegacyIdentityFields) {
            console.warn('[Home] Ranking payload still contains legacy identity fields. Expected ranking_code/display_name only.');
        }

        const userRankEntry = resolveCurrentUserRankEntry(user, data.ranking);

        if (userRankEntry) {
            statNumRank.textContent = `#${userRankEntry.rank}`;
            homeDebugLog(`[Home] User found in ranking: #${userRankEntry.rank}`);

            if (window.Rank1Overlay && typeof window.Rank1Overlay.check === 'function') {
                await window.Rank1Overlay.check(userRankEntry.rank);
            }
        } else {
            statNumRank.textContent = '--';
            homeDebugLog('[Home] User not found in ranking');
        }

    } catch (error) {
        console.error('[Home] Error fetching ranking:', error);
        statNumRank.textContent = '--';
    }
}

function getLevelChallenges(data, levelKey) {
    const isFirebaseData = data.challengesByLevel !== undefined;
    if (isFirebaseData) {
        return data.challengesByLevel[levelKey] || [];
    }
    return (data.challenges || []).filter(c => c.level === Number(levelKey));
}

function getTotalChallengesForLevel(levelChallenges) {
    if (levelChallenges.length > 0) {
        return levelChallenges.length;
    }
    // Fluxo jogavel canonico: 20 desafios normais + 2 intermissions quando existirem.
    return 22;
}

function updateSectionHeader() {
    const title = document.getElementById('section-title');
    const subtitle = document.getElementById('section-subtitle');
    const viewConfig = VIEW_CONFIG.levels;

    if (title) {
        title.innerHTML = viewConfig.title;
    }
    if (subtitle) {
        subtitle.textContent = viewConfig.subtitle;
    }
}

function showTabSwitchSkeleton() {
    const container = document.getElementById('levels-container');
    if (!container) {
        return;
    }

    container.innerHTML = '';

    const loader = document.createElement('div');
    loader.className = 'skeleton-loader skeleton-loader--switch';

    const skeletonCount = 3;
    for (let index = 0; index < skeletonCount; index++) {
        const skeletonCard = document.createElement('div');
        skeletonCard.className = 'skeleton-card';
        skeletonCard.innerHTML = `
            <div class="skeleton-shimmer"></div>
            <div class="skeleton-element skeleton-badge"></div>
            <div class="skeleton-head-group">
                <div class="skeleton-head-text">
                    <div class="skeleton-element skeleton-misslabel"></div>
                    <div class="skeleton-element skeleton-num"></div>
                </div>
                <div class="skeleton-element skeleton-icon"></div>
            </div>
            <div class="skeleton-element skeleton-name"></div>
            <div class="skeleton-element skeleton-stars"></div>
            <div class="skeleton-element skeleton-progress-bar"></div>
            <div class="skeleton-element skeleton-progress-text"></div>
            <div class="skeleton-element skeleton-button"></div>
        `;
        loader.appendChild(skeletonCard);
    }

    container.appendChild(loader);
}

function hideTabSwitchSkeleton() {
    const container = document.getElementById('levels-container');
    if (!container) {
        return;
    }

    const loader = container.querySelector('.skeleton-loader--switch');
    if (loader) {
        loader.remove();
    }
}

async function renderActiveView() {
    if (!homeViewState.data || !homeViewState.user) {
        return;
    }

    const currentRequestId = ++homeViewState.renderRequestId;
    updateSectionHeader();

    const skeletonTimer = setTimeout(() => {
        if (currentRequestId !== homeViewState.renderRequestId) {
            return;
        }
        showTabSwitchSkeleton();
    }, 140);

    try {
        await renderLevels(
            homeViewState.data,
            homeViewState.user,
            homeViewState.seasonId,
            currentRequestId
        );
    } finally {
        clearTimeout(skeletonTimer);
        if (currentRequestId === homeViewState.renderRequestId) {
            hideTabSwitchSkeleton();
        }
    }
}

async function setHomeDataAndRender(data, user, seasonId = null) {
    homeViewState.data = data;
    homeViewState.user = user;
    homeViewState.seasonId = seasonId;
    await renderActiveView();
}

window.addEventListener('pagehide', () => {
    homeDebugLog('[Home] pagehide: cleaning up observer');
    if (globalObserver) {
        globalObserver.disconnect();
        globalObserver = null;
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    const loggedInUser = getLoggedInUser();
    const hasActiveSession = window.CxSession?.hasActiveSession?.() ?? Boolean(loggedInUser && getStorageType().getItem('loggedIn'));
    const homeUrlParams = new URLSearchParams(window.location.search);
    if (homeUrlParams.get('reason') === 'duplicate_session') {
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);
        setTimeout(() => {
            showDuplicateSessionToast();
        }, 800); // Delay para dar tempo da home renderizar
    }


    if (!loggedInUser || !hasActiveSession) {
        window.CxSession?.redirectToLogin?.() || window.location.replace('login.html');
        return;
    }

    const users = getUsersData();
    let user = users[loggedInUser];

    // Se não existir registro local, cria um perfil padrão para evitar loop
    if (!user) {
        user = {
            display_name: getSessionPublicDisplayName() || 'Agente EC',
            ranking_code: getSessionPublicRankingCode() || null,
            level: 1,
            xp: 0,
            completedChallenges: []
        };
        users[loggedInUser] = user;
        saveUsersData(users);
    }

    const hydratedIdentity = hydrateUserPublicIdentity(user);
    user = hydratedIdentity.user;
    if (hydratedIdentity.changed) {
        users[loggedInUser] = user;
        saveUsersData(users);
    }

    // Isso faz a animação começar junto com o carregamento
    await initSyncIndicators();
    user = refreshUserAfterProgressSync(loggedInUser, user);
    updateUserIdentityUI(user);

    await updateUserRanking(user);

    // CRITICAL: Buscar user.id do Supabase ANTES de carregar desafios
    // O ProgressSync já carregou o user_id do Supabase, vamos usar ele
    homeDebugLog('[Home] Getting user.id from ProgressSync...');
    if (window.progressSync?.lastSyncedState?.user_id) {
        user.id = window.progressSync.lastSyncedState.user_id;
        users[loggedInUser] = user;
        saveUsersData(users);
        homeDebugLog('[Home] User ID from ProgressSync:', user.id);
    } else {
        console.warn('[Home] Could not get user ID from ProgressSync');
    }

    try {
        homeDebugLog('[Home] Loading challenges from Firebase...');

        if (window.FirebaseLoader) {
            await window.FirebaseLoader.initializeApp();

            const season = await window.FirebaseLoader.loadActiveSeason();
            const seasonId = season ? season.id : 'S-2025-01';

            homeDebugLog('[Home] Season ID:', seasonId);

            const levelsData = {
                levels: {},
                challengesByLevel: {}
            };
            const seedUserId = user.id || getPublicRankingCode(user) || loggedInUser || 'anonymous';
            const homeBundle = window.FirebaseLoader.loadHomeBundle
                ? await window.FirebaseLoader.loadHomeBundle(seasonId, 'CX')
                : null;

            // O app LE a phase REAL (read-only, GET, sem CRIAR) pra exibir ordem/contagem
            // corretas. Nivel ainda nao iniciado (sem phase active) -> 204 -> previa local
            // deterministica. NUNCA cria phase aqui (a autoritativa nasce ao ENTRAR no
            // desafio) -> sem POST/criacao prematura e sem o timeout dos 3 POSTs no load.
            const levelResults = await Promise.all([1, 2, 3].map(async (level) => {
                try {
                    const bundledLevelData = homeBundle?.levels?.[String(level)]
                        || await window.FirebaseLoader.loadLevel(level, 'CX', seasonId);
                    const levelData = window.ChallengeRandomizer?.buildFlowFromPhase
                        ? await window.ChallengeRandomizer.buildFlowFromPhase(
                            bundledLevelData?.questions || [],
                            seedUserId,
                            seasonId,
                            level,
                            'CX',
                            bundledLevelData,
                            { create: false }
                        )
                        : bundledLevelData;
                    return { level, bundledLevelData, levelData };
                } catch (err) {
                    console.warn(`[Home] Level ${level} load failed, continuing:`, err?.message);
                    return { level, bundledLevelData: null, levelData: null };
                }
            }));

            for (const { level, bundledLevelData, levelData } of levelResults) {
                const levelMetadata = bundledLevelData || {};
                levelsData.levels[level] = {
                    icon: levelMetadata.icone || (level === 1 ? '🛡️' : level === 2 ? '⚡' : '👑'),
                    name: levelMetadata.nome || (level === 1 ? 'Recruta EC' : level === 2 ? 'Especialista EC' : 'Embaixador EC'),
                    description: levelMetadata.descricao || '',
                    color: level === 1 ? '#4ade80' : level === 2 ? '#fbbf24' : '#f87171',
                    comingSoon: Boolean(levelMetadata.coming_soon || levelMetadata.comingSoon)
                };
                homeDebugLog(`[Home] Level ${level} metadata loaded: ${levelsData.levels[level].name}`);
                if (levelData && levelData.questions && levelData.questions.length > 0) {
                    levelsData.challengesByLevel[level] = levelData.questions;
                    homeDebugLog(`[Home] Level ${level}: ${levelData.questions.length} playable nodes loaded`);
                } else {
                    levelsData.challengesByLevel[level] = [];
                    homeDebugLog(`[Home] Level ${level}: No challenges found`);
                }
            }

            homeDebugLog('[Home] All levels and challenges loaded');

            await setHomeDataAndRender(levelsData, user, seasonId);

        } else {
            throw new Error('Firebase Loader not available');
        }

    } catch (firebaseError) {
        console.error('[Home] Firebase failed:', firebaseError.message);
        alert("Não foi possível carregar os dados do painel.");
    }
});

async function initSyncIndicators() {
    const indicator = document.getElementById('sync-indicator');
    const iconEl = indicator?.querySelector('.sync-icon');
    const textEl = indicator?.querySelector('.sync-text');

    if (!indicator) {
        console.warn('[Home] Sync indicator element not found');
        return;
    }

    if (!window.progressSync) {
        console.warn('[Home] ProgressSync not available');
        indicator.className = 'sync-indicator offline';
        textEl.textContent = 'Sync não disponível';
        return;
    }

    if (!window.progressSync.initialized) {
        homeDebugLog('[Home] ProgressSync not initialized, initializing now...');
        indicator.className = 'sync-indicator';
        textEl.textContent = 'Inicializando...';

        try {
            await window.progressSync.initialize();
            homeDebugLog('[Home] ProgressSync initialized successfully');

            // CRITICAL: Carregar estado do Supabase após inicializar
            const loggedInUser = getLoggedInUser();
            if (loggedInUser) {
                homeDebugLog('[Home] Loading progress from Supabase...');
                await window.progressSync.loadProgressFromSupabase(loggedInUser);
                homeDebugLog('[Home] Progress loaded, lastSyncedState:', window.progressSync.lastSyncedState);
            }
        } catch (error) {
            console.error('[Home] Failed to initialize ProgressSync:', error);
            indicator.className = 'sync-indicator error';
            textEl.textContent = 'Erro na inicialização';
            return;
        }
    }

    // Função helper para trocar ícones
    const updateIcon = (state) => {
        if (!iconEl) return;

        const icons = {
            syncing: `<polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>`,
            success: `<polyline points="20 6 9 17 4 12"/>`,
            error: `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>`,
            offline: `<line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>`,
            idle: `<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>`
        };

        iconEl.innerHTML = icons[state] || icons.idle;
    };

    // Estado inicial: sempre começar com syncing para mostrar a animação
    const updateInitialState = () => {
        if (!window.progressSync.initialized) {
            indicator.className = 'sync-indicator syncing';
            updateIcon('syncing');
            textEl.textContent = 'Inicializando...';
            return;
        }

        const hasPendingChanges = window.progressSync.syncQueue.length > 0;
        const isOnline = navigator.onLine;

        if (!isOnline) {
            indicator.className = 'sync-indicator offline';
            updateIcon('offline');
            textEl.textContent = 'Offline';
            return;
        }

        // Sempre mostrar syncing primeiro, depois success, depois idle
        indicator.className = 'sync-indicator syncing';
        updateIcon('syncing');
        textEl.textContent = 'Sincronizando...';

        setTimeout(() => {
            indicator.className = 'sync-indicator success';
            updateIcon('success');
            textEl.textContent = '✓ Sincronizado';

            // Voltar ao estado idle após 1.2s
            setTimeout(() => {
                indicator.className = 'sync-indicator';
                updateIcon('idle');
                textEl.textContent = 'Pronto';
            }, 1200);
        }, 500);
    };

    updateInitialState();

    // Escutar eventos de sincronização
    window.progressSync.on('sync:start', () => {
        homeDebugLog('[Home] Sync started');
        indicator.className = 'sync-indicator syncing';
        updateIcon('syncing');
        textEl.textContent = 'Sincronizando...';
        indicator.onclick = null;
    });

    window.progressSync.on('sync:success', () => {
        homeDebugLog('[Home] Sync successful');
        indicator.className = 'sync-indicator success';
        updateIcon('success');
        textEl.textContent = '✓ Sincronizado';
        indicator.onclick = null;

        const loggedInUser = getLoggedInUser();
        const users = getUsersData();
        const user = users[loggedInUser];
        if (user) {
            const statNumXp = getCachedElement('statNumXp', 'stat-num-xp');
            if (statNumXp) statNumXp.textContent = user.xp || 0;

            const statNumCompleted = getCachedElement('statNumCompleted', 'stat-num-completed');
            if (statNumCompleted) statNumCompleted.textContent = getDisplayCompletedTotal(user);
        }

        // Voltar ao estado idle após 1.5s (mais rápido)
        setTimeout(() => {
            if (indicator.classList.contains('success')) {
                indicator.className = 'sync-indicator';
                updateIcon('idle');
                textEl.textContent = 'Pronto';
            }
        }, 1500);
    });

    window.progressSync.on('sync:error', (error) => {
        console.error('[Home] Sync error:', error);
        indicator.className = 'sync-indicator error';
        updateIcon('error');
        textEl.textContent = '⚠ Erro - Clique para tentar';

        // Permitir retry ao clicar
        indicator.onclick = () => {
            homeDebugLog('[Home] Manual retry triggered');
            if (window.progressSync && window.progressSync.syncQueue.length > 0) {
                window.progressSync.onCriticalEvent();
            } else {
                // Se não há mudanças pendentes, apenas atualizar o estado
                updateInitialState();
            }
        };
    });

    window.progressSync.on('offline', () => {
        console.warn('[Home] Offline mode');
        indicator.className = 'sync-indicator offline';
        updateIcon('offline');
        textEl.textContent = 'Offline';
        indicator.onclick = null;
    });

    // Escutar mudanças de conectividade
    window.addEventListener('online', () => {
        homeDebugLog('[Home] Back online');
        updateInitialState();

        // Se há mudanças pendentes, tentar sincronizar
        if (window.progressSync.syncQueue.length > 0) {
            window.progressSync.onCriticalEvent();
        }
    });

    window.addEventListener('offline', () => {
        homeDebugLog('[Home] Gone offline');
        indicator.className = 'sync-indicator offline';
        textEl.textContent = 'Offline';
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            homeDebugLog('[Home] Page became visible, updating sync state');
            setTimeout(updateInitialState, 100);
        }
    });
}

async function loadFlowStatusFromRpc(supabaseClient, userId, seasonId) {
    const challengeStatusMap = new Map();
    const intermissionStatusMap = new Map();
    const rpcSuccessIds = new Set();
    const rpcProcessedIds = new Set();
    const progressFlow = getProgressFlowApi();

    if (!getCxSessionToken()) {
        return { challengeStatusMap, intermissionStatusMap, rpcSuccessIds, rpcProcessedIds };
    }

    homeDebugLog('[Home] Querying protected user flow status API...');
    const response = await fetch(`/api/user-flow-status?seasonId=${encodeURIComponent(seasonId || 'S-2025-01')}`, {
        method: 'GET',
        headers: buildProtectedHeaders({ Accept: 'application/json' })
    });

    if (!response.ok) {
        console.error('[Home] Error loading flow status API:', response.status);
        return { challengeStatusMap, intermissionStatusMap, rpcSuccessIds, rpcProcessedIds };
    }

    const data = await response.json();
    const challengeStatuses = Array.isArray(data?.challenge_statuses) ? data.challenge_statuses : [];
    const intermissionStatuses = Array.isArray(data?.intermission_statuses) ? data.intermission_statuses : [];

    const normalizedChallengeStatusMap = progressFlow?.buildStatusMap
        ? progressFlow.buildStatusMap(challengeStatuses)
        : null;

    if (normalizedChallengeStatusMap instanceof Map) {
        normalizedChallengeStatusMap.forEach((value, key) => {
            challengeStatusMap.set(key, value);
        });
    } else {
        challengeStatuses.forEach(item => {
            if (item?.challenge_id) {
                challengeStatusMap.set(item.challenge_id, item);
            }
        });
    }

    challengeStatuses.forEach(item => {
        if (!item?.challenge_id) return;
        const logicalChallengeId = progressFlow?.normalizeChallengeId
            ? progressFlow.normalizeChallengeId(item.challenge_id)
            : item.challenge_id;

        if (item.status === 'completed') {
            rpcSuccessIds.add(logicalChallengeId);
            rpcProcessedIds.add(logicalChallengeId);
        } else if (item.status === 'failed') {
            rpcProcessedIds.add(logicalChallengeId);
        }
    });

    intermissionStatuses.forEach(item => {
        if (!item?.challenge_id) return;

        const normalized = {
            ...item,
            success: Boolean(item.success),
            processed: Boolean(item.processed || item.success)
        };
        const previous = intermissionStatusMap.get(item.challenge_id);
        const shouldReplace = !previous
            || Number(normalized.percent || 0) > Number(previous.percent || 0)
            || new Date(normalized.completed_at || 0).getTime() >= new Date(previous.completed_at || 0).getTime();

        if (shouldReplace) {
            intermissionStatusMap.set(item.challenge_id, normalized);
        }

        if (normalized.success) {
            rpcSuccessIds.add(item.challenge_id);
        }
        if (normalized.processed || normalized.success) {
            rpcProcessedIds.add(item.challenge_id);
        }
    });

    homeDebugLog('[Home] Loaded flow status from RPC:', {
        challengeStatuses: rpcProcessedIds.size,
        intermissionStatuses: intermissionStatusMap.size
    });

    return { challengeStatusMap, intermissionStatusMap, rpcSuccessIds, rpcProcessedIds };
}

async function renderLevels(data, user, seasonId = null, renderRequestId = null) {
    const container = document.getElementById('levels-container');
    if (!container) {
        return;
    }

    if (renderRequestId !== null && renderRequestId !== homeViewState.renderRequestId) {
        return;
    }

    const progressFlow = getProgressFlowApi();
    const completedSet = new Set(user.completedChallenges || []);
    const completedMinigames = user.completedMinigames || [];
    const completedBaseSet = progressFlow?.buildCompletedBaseSet
        ? progressFlow.buildCompletedBaseSet(user.completedChallenges || [], completedMinigames)
        : new Set(user.completedChallenges || []);
    const completedLogicalSet = progressFlow?.buildLogicalCompletedSet
        ? progressFlow.buildLogicalCompletedSet(user.completedChallenges || [], completedMinigames)
        : completedBaseSet;

    // Build valid IDs only for display diagnostics. Rendering must never delete progress.
    const validChallengeIds = new Set();
    Object.keys(data.challengesByLevel || {}).forEach(levelKey => {
        const challenges = data.challengesByLevel[levelKey] || [];
        challenges.forEach(c => {
            const challengeId = getChallengeId(c);
            if (challengeId) validChallengeIds.add(challengeId);
        });
    });
    const invalidIds = progressFlow?.listInvalidCompletedIds
        ? progressFlow.listInvalidCompletedIds(user.completedChallenges || [], validChallengeIds)
        : (user.completedChallenges || []).filter(id => id && !id.startsWith('ig-') && !validChallengeIds.has(id));

    if (invalidIds.length > 0) {
        console.warn('[Home] Ignoring orphan completed IDs for display only:', invalidIds);
        if (false && user.id) {
            homeDebugLog('[Home] Calling API to cleanup Supabase...');
            window.VPSClient.postJSONToVPS('/api/validate-challenge-access', {
                userId: user.id,
                invalidChallengeId: invalidIds[0], // First invalid ID that triggered cleanup
                validChallengeIds: Array.from(validChallengeIds)
            })
                .then(result => {
                    if (result.success) {
                        homeDebugLog('[Home] ✓ Supabase cleanup successful:', result.cleaned);
                    } else {
                        console.error('[Home] ✗ Supabase cleanup failed:', result.error);
                    }
                })
                .catch(error => {
                    console.error('[Home] ✗ Error calling cleanup API:', error);
                });
        }
    }

    let challengeStatusMap = new Map();
    let intermissionStatusMap = new Map();
    let rpcSuccessIds = new Set();
    let rpcProcessedIds = new Set();
    try {
        const supabaseClient = window.progressSync?.supabase;

        if (getCxSessionToken()) {
            const flowStatus = await loadFlowStatusFromRpc(supabaseClient, user.id, seasonId);
            challengeStatusMap = flowStatus.challengeStatusMap;
            intermissionStatusMap = flowStatus.intermissionStatusMap;
            rpcSuccessIds = flowStatus.rpcSuccessIds;
            rpcProcessedIds = flowStatus.rpcProcessedIds;
        }
    } catch (error) {
        console.warn('[Home] Failed to load flow status:', error);
    }

    const divergentSuccessIds = Array.from(new Set([
        ...Array.from(completedLogicalSet).filter(id => !rpcSuccessIds.has(id)),
        ...Array.from(rpcSuccessIds).filter(id => !completedLogicalSet.has(id))
    ]));

    if (divergentSuccessIds.length > 0) {
        console.warn('[HomeProgress] Divergence between user_progress and flow status RPC:', {
            userId: user.id,
            seasonId: seasonId || 'S-2025-01',
            userProgressCompletedIds: Array.from(completedLogicalSet),
            rpcSuccessIds: Array.from(rpcSuccessIds),
            differingIds: divergentSuccessIds
        });
    }

    const statNumCompleted = getCachedElement('statNumCompleted', 'stat-num-completed');
    if (statNumCompleted && (rpcSuccessIds.size > 0 || completedLogicalSet.size === 0)) {
        statNumCompleted.textContent = rpcSuccessIds.size;
    }

    if (renderRequestId !== null && renderRequestId !== homeViewState.renderRequestId) {
        return;
    }

    container.innerHTML = '';

    let hasUncompletedPreviousLevel = false;
    // Totais da temporada (para o banner de progresso)
    let seasonDoneTotal = 0;
    let seasonChallengeTotal = 0;
    const levelKeys = Object.keys(data.levels || {}).sort((a, b) => Number(a) - Number(b));

    levelKeys.forEach(levelKey => {
        const levelConfig = data.levels[levelKey];
        const levelChallenges = getLevelChallenges(data, levelKey);
        const levelProgress = progressFlow?.calculateLevelProgress
            ? progressFlow.calculateLevelProgress(levelChallenges, {
                completedChallenges: user.completedChallenges || [],
                completedMinigames,
                challengeStatusMap,
                intermissionStatusMap,
                level: Number(levelKey)
            })
            : null;
        const successChallenges = levelProgress?.successChallenges
            || levelProgress?.completedChallenges
            || levelChallenges.filter(c => {
                const challengeId = getChallengeId(c);
                const logicalChallengeId = progressFlow?.normalizeChallengeId
                    ? progressFlow.normalizeChallengeId(challengeId)
                    : challengeId;
                return completedSet.has(challengeId) || completedLogicalSet.has(logicalChallengeId);
            });
        const processedIds = new Set(levelProgress?.processedIds || []);
        const totalChallenges = levelProgress?.totalChallenges || getTotalChallengesForLevel(levelChallenges);
        const successCount = levelProgress?.successCount ?? successChallenges.length;
        const successRate = levelProgress?.successRate ?? levelProgress?.completionRate ?? (totalChallenges > 0
            ? Math.round((successCount / totalChallenges) * 100)
            : 0);
        const completedChallenges = successChallenges;
        const completedIds = processedIds;
        const completionRate = successRate;
        const xpEarned = successChallenges.reduce((sum, c) => sum + (c.xp || c.points || 0), 0);
        const totalXP = levelChallenges.reduce((sum, c) => sum + (c.xp || c.points || 0), 0);

        // Acumula totais da temporada para o banner
        seasonDoneTotal += successCount;
        seasonChallengeTotal += totalChallenges;

        // Calcular quantos desafios foram processados (completados + falhados)
        // Se não há desafios carregados (levelChallenges.length === 0), usar dados do Supabase
        let processedCount = levelProgress?.processedCount || 0;
        let allChallengesProcessed = levelProgress?.allChallengesProcessed || false;

        if (levelProgress) {
            homeDebugLog(`[HomeProgress] Level ${levelKey}:`, {
                totalChallenges,
                successCount,
                processedCount,
                allChallengesProcessed,
                successRate
            });
        } else if (levelChallenges.length > 0) {
            // Temos desafios carregados, calcular baseado neles
            const processedChallenges = levelChallenges.filter(c => {
                const challengeId = getChallengeId(c);
                const status = getChallengeStatusValue(challengeStatusMap, challengeId);
                if (progressFlow?.isIntermissionId?.(challengeId)) {
                    return intermissionStatusMap.has(challengeId);
                }
                const logicalChallengeId = progressFlow?.normalizeChallengeId
                    ? progressFlow.normalizeChallengeId(challengeId)
                    : challengeId;
                return completedSet.has(challengeId) || completedLogicalSet.has(logicalChallengeId) || status === 'failed';
            });
            processedCount = processedChallenges.length;
            allChallengesProcessed = processedCount >= totalChallenges;

            homeDebugLog(`[HomeProgress] Level ${levelKey}:`, {
                totalChallenges,
                successCount,
                processedCount,
                allChallengesProcessed,
                successRate
            });
        } else {
            // Não temos desafios carregados (nível bloqueado), verificar pelo Supabase
            // Contar quantos desafios deste nível estão no challengeStatusMap
            const levelPattern = new RegExp(`-${levelKey}\\d{2}$`);
            const levelStatusEntries = Array.from(challengeStatusMap.entries()).filter(([id]) =>
                levelPattern.test(id)
            );

            processedCount = levelStatusEntries.filter(([_, status]) =>
                status.status === 'completed' || status.status === 'failed'
            ).length;
            processedCount += Array.from(intermissionStatusMap.keys()).filter(id => id.startsWith(`ig-L${levelKey}-slot`)).length;

            // Considerar processado se atingiu 20 desafios (total esperado por nível)
            allChallengesProcessed = processedCount >= 22;

            homeDebugLog(`[HomeProgress] Level ${levelKey} (RPC fallback):`, {
                totalChallenges: 22,
                processedCount,
                allChallengesProcessed,
                statusEntriesCount: levelStatusEntries.length,
                rpcProcessedCount: Array.from(rpcProcessedIds).filter(id =>
                    id.startsWith(`ig-L${levelKey}-slot`) || levelPattern.test(id)
                ).length
            });
        }

        let badge = '';
        let badgeTooltip = '';
        if (successRate === 100) {
            badge = '🥇';
            badgeTooltip = 'Nível completado 100%!';
        } else if (allChallengesProcessed && successRate < 100) {
            badge = '✅';
            badgeTooltip = `Nível incompleto (${completionRate}%)`;
        } else if (successRate >= 80) {
            badge = '🥈';
            badgeTooltip = `${completionRate}% completo`;
        } else if (successRate >= 60) {
            badge = '🥉';
            badgeTooltip = `${completionRate}% completo`;
        } else if (successRate > 0) {
            badge = '⭐';
            badgeTooltip = `${completionRate}% completo`;
        }

        const levelComingSoon = Boolean(levelConfig?.comingSoon);
        const isLevelProgressionLocked = hasUncompletedPreviousLevel;
        const isLevelLocked = levelComingSoon || isLevelProgressionLocked;
        const levelUnlockedForProgression = allChallengesProcessed;

        const nextChallenge = levelChallenges.find(c => {
            const challengeId = getChallengeId(c);
            if (completedIds.has(challengeId)) {
                return false;
            }

            const status = getChallengeStatusValue(challengeStatusMap, challengeId);
            if (status === 'failed') {
                return false;
            }

            return true;
        });

        let buttonHTML = '';
        if (levelComingSoon) {
            buttonHTML = `
                <button class="level-btn level-btn--locked" disabled>
                    Em breve
                </button>
            `;
        } else if (isLevelProgressionLocked) {
            buttonHTML = `
                <button class="level-btn level-btn--locked" disabled>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                    Bloqueado
                </button>
            `;
        } else if (completionRate === 100) {
            buttonHTML = `
                <button class="level-btn level-btn--completed" disabled>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                        <polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                    Nivel completo
                </button>
            `;
        } else if (allChallengesProcessed && completionRate < 100) {
            buttonHTML = `
                <button class="level-btn level-btn--incomplete" disabled>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                        <polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                    Nivel incompleto
                </button>
            `;
        } else if (nextChallenge) {
            const nextChallengeId = getChallengeId(nextChallenge);
            buttonHTML = `
                <button class="level-btn level-btn--primary" onclick="window.location.href='challenge.html?id=${nextChallengeId}'">
                    ${completionRate > 0 ? 'Continuar nivel' : 'Iniciar nivel'}
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12"/>
                        <polyline points="12 5 19 12 12 19"/>
                    </svg>
                </button>
            `;
        } else {
            buttonHTML = `
                <button class="level-btn level-btn--locked" disabled>
                    Sem desafios disponiveis
                </button>
            `;
        }

        let stateLabel, stateClass;
        if (levelComingSoon) { stateLabel = 'Em breve'; stateClass = ''; }
        else if (isLevelProgressionLocked) { stateLabel = 'Bloqueado'; stateClass = ''; }
        else if (completionRate === 100) { stateLabel = 'Completo'; stateClass = 'is-complete'; }
        else if (allChallengesProcessed && completionRate < 100) { stateLabel = 'Incompleto'; stateClass = 'is-incomplete'; }
        else if (completionRate > 0) { stateLabel = 'Em andamento'; stateClass = 'is-progress'; }
        else { stateLabel = 'Disponivel'; stateClass = 'is-available'; }

        const missionNum = String(levelKey).padStart(2, '0');
        const filledStars = Math.max(0, Math.min(5, Math.round(successRate / 20)));
        let starsHTML = '';
        for (let s = 0; s < 5; s++) starsHTML += `<span class="${s < filledStars ? '' : 'off'}">★</span>`;

        const levelCard = document.createElement('article');
        levelCard.className = `level-card level-${levelKey} ${stateClass} ${isLevelLocked ? 'locked' : ''}`;
        levelCard.style.setProperty('--level-color', levelConfig.color);

        levelCard.innerHTML = `
            ${levelComingSoon ? '<span class="lc-soon">Em breve!</span>' : ''}
            <span class="lc-state">${stateLabel}</span>

            <div class="lc-head">
                <div>
                    <div class="lc-misslabel">Missão</div>
                    <div class="lc-num">${missionNum}</div>
                </div>
                <div class="lc-icon" title="${levelConfig.name}">${levelConfig.icon}</div>
            </div>

            <div class="lc-name">${levelConfig.name}</div>
            <div class="lc-stars" title="${completionRate}% completo">${starsHTML}</div>

            <div class="lc-progress">
                <div class="lc-bar"><div class="lc-fill" style="width:0%" data-fill="${completionRate}"></div></div>
                <div class="lc-count">${successCount} / ${totalChallenges} desafios</div>
            </div>

            <div class="lc-foot">${buttonHTML}</div>
        `;

        container.appendChild(levelCard);
        observer.observe(levelCard);

        if (!levelUnlockedForProgression) {
            hasUncompletedPreviousLevel = true;
        }
    });

    const sDone = document.getElementById('season-done');
    const sTotal = document.getElementById('season-total');
    const sPct = document.getElementById('season-pct');
    const sFill = document.getElementById('season-pfill');
    const seasonPct = seasonChallengeTotal > 0
        ? Math.round((seasonDoneTotal / seasonChallengeTotal) * 100)
        : 0;
    if (sDone) sDone.textContent = seasonDoneTotal;
    if (sTotal) sTotal.textContent = seasonChallengeTotal;
    if (sPct) sPct.textContent = seasonPct;
    const seasonProgress = document.getElementById('season-progress');
    if (seasonProgress) {
        seasonProgress.classList.remove('is-loading');
        seasonProgress.setAttribute('aria-busy', 'false');
    }

    // Preenche as barras de forma fluida (0 -> valor atual do jogador), como líquido enchendo.
    // O reflow "fixa" o estado 0% para a transição CSS animar a partir do zero;
    // o transition-delay escalona o preenchimento card a card.
    void container.offsetWidth;
    if (sFill) sFill.style.width = seasonPct + '%';
    container.querySelectorAll('.lc-fill[data-fill]').forEach((fill, i) => {
        fill.style.transitionDelay = (0.12 + i * 0.12) + 's';
        fill.style.width = fill.dataset.fill + '%';
    });
}





function initializeFilterTabs() {
    const tabLevels = document.getElementById('tab-levels');
    const tabDailyGames = document.getElementById('tab-daily-games');
    const levelsContainer = document.getElementById('levels-container');
    const dailyGamesSection = document.getElementById('daily-games-section');

    if (!tabLevels || !tabDailyGames || !levelsContainer || !dailyGamesSection) {
        console.warn('[Home] Filter tabs elements not found');
        return;
    }

    tabLevels.addEventListener('click', () => {
        tabLevels.classList.add('filter-tab--active');
        tabDailyGames.classList.remove('filter-tab--active');
        tabLevels.setAttribute('aria-selected', 'true');
        tabDailyGames.setAttribute('aria-selected', 'false');

        levelsContainer.style.display = '';
        dailyGamesSection.style.display = 'none';

        homeDebugLog('[Home] Switched to Níveis view');
    });

    tabDailyGames.addEventListener('click', () => {
        tabDailyGames.classList.add('filter-tab--active');
        tabLevels.classList.remove('filter-tab--active');
        tabDailyGames.setAttribute('aria-selected', 'true');
        tabLevels.setAttribute('aria-selected', 'false');

        // Hide levels, show daily games placeholder
        levelsContainer.style.display = 'none';
        dailyGamesSection.style.display = 'block';

        homeDebugLog('[Home] Switched to Games Diários view');
    });

    homeDebugLog('[Home] Filter tabs initialized');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeFilterTabs);
} else {
    initializeFilterTabs();
}


document.querySelectorAll('.stat-card').forEach(el => {
    observer.observe(el);
});

(function() {
    const todayStr = new Date().toLocaleDateString('pt-BR');
    const storageKey = `cx-daily-game-seen-${todayStr}`;
    const bell = document.querySelector('.header__bell');
    const dailyBanners = Array.from(document.querySelectorAll('.daily-game-banner'));
    const dailyBanner = dailyBanners[0];

    if (localStorage.getItem(storageKey) === 'true') {
        if (bell) bell.classList.add('seen');
    }

    if (bell) {
        bell.addEventListener('click', (e) => {
            e.preventDefault();
            if (dailyBanner) {
                dailyBanner.scrollIntoView({ behavior: 'smooth', block: 'center' });
                dailyBanner.classList.add('daily-game-banner--highlight');
                setTimeout(() => {
                    dailyBanner.classList.remove('daily-game-banner--highlight');
                }, 2000);
                localStorage.setItem(storageKey, 'true');
                bell.classList.add('seen');
            }
        });
    }

    // 3. Click on any daily game banner directly
    dailyBanners.forEach((banner) => {
        banner.addEventListener('click', () => {
            localStorage.setItem(storageKey, 'true');
            if (bell) bell.classList.add('seen');
        });
    });

    // 4. Handle incoming query parameter playDaily=true
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('playDaily') === 'true') {
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, '', cleanUrl);

        setTimeout(() => {
            if (dailyBanner) {
                dailyBanner.scrollIntoView({ behavior: 'smooth', block: 'center' });
                dailyBanner.classList.add('daily-game-banner--highlight');
                setTimeout(() => {
                    dailyBanner.classList.remove('daily-game-banner--highlight');
                }, 2000);
                
                localStorage.setItem(storageKey, 'true');
                if (bell) bell.classList.add('seen');
            }
        }, 600);
    }
})();
