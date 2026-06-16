function rankingDebugLog(...args) {
  if (typeof window !== 'undefined' && window.CX_DEBUG === true) {
    console.debug(...args);
  }
}

const RANKING_API_URL = 'https://api.expconnect.com.br/ranking/current';

function escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

function getUsersData() {
    const storage = getStorageType();
    return JSON.parse(storage.getItem('cx_users') || '{}');
}

function getLoggedInUserKey() {
    return window.CxSession?.getSessionValue?.('cx_logged_in_user') || localStorage.getItem('cx_logged_in_user') || sessionStorage.getItem('cx_logged_in_user');
}

function getComparableDisplayName(user) {
    return (user?.display_name || user?.displayName || '').trim();
}

function getPublicDisplayName(user, fallback = 'Agente EC') {
    return getComparableDisplayName(user) || fallback;
}

function getPublicRankingCode(user) {
    return (user?.ranking_code || user?.rankingCode || sessionStorage.getItem('cx_ranking_code') || '').trim();
}

function getInitials(name) {
    if (!name) {
        return 'EC';
    }
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
        return parts[0].slice(0, 2).toUpperCase();
    }
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function parseTimeToSeconds(time) {
    if (!time || typeof time !== 'string' || !time.includes(':')) {
        return Number.MAX_SAFE_INTEGER;
    }
    const [hours, minutes, seconds] = time.split(':').map(Number);
    if ([hours, minutes, seconds].some(Number.isNaN)) {
        return Number.MAX_SAFE_INTEGER;
    }
    return (hours * 3600) + (minutes * 60) + seconds;
}

function resolveAvatar(entry, currentUser) {
    let avatar = entry.avatar;
    if (entry.isCurrentUser && !avatar && currentUser) {
        avatar = currentUser.avatar_file_name || currentUser.avatarFileName;
    }
    return avatar;
}

function buildAvatarHTML(entry, currentUser, classes) {
    const avatar = resolveAvatar(entry, currentUser);
    const initials = getInitials(entry.name);
    if (avatar) {
        const avatarPath = `/frontend/assets/image/avatar/${avatar}`;
        return `<img src="${avatarPath}" alt="${escapeHtml(entry.name)}" onerror="this.style.display='none'; this.nextElementSibling.style.display='grid';" />
                <span class="${classes.initials}" style="display:none">${escapeHtml(initials)}</span>`;
    }
    return `<span class="${classes.initials}">${escapeHtml(initials)}</span>`;
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

function handleLogout() {
    document.body.style.opacity = '0';
    document.body.style.transition = 'opacity 0.35s ease';

    setTimeout(() => {
        window.CxSession?.clearSessionState?.();
        window.location.replace('login.html');
    }, 350);
}

/**
 * Calcula o badge apropriado baseado no timestamp do ranking
 * @param {string} generatedAt - Timestamp ISO do ranking (generated_at)
 * @param {string} rankingDate - Data do ranking (YYYY-MM-DD)
 * @returns {Object} Badge com label, color e background
 */
function getRankingBadge(generatedAt, rankingDate) {
    if (!generatedAt || !rankingDate) {
        return { label: 'Em breve' };
    }

    const now = Date.now();
    const rankingTime = new Date(generatedAt).getTime();
    const diffMs = now - rankingTime;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);

    const today = new Date().toISOString().split('T')[0];
    const isToday = rankingDate === today;

    // Se não é de hoje, é ranking consolidado oficial
    if (!isToday) {
        return { label: 'Ranking oficial' };
    }

    // Ranking de hoje - mostra tempo desde atualização
    if (diffMin < 2) {
        return { label: 'Agora mesmo' };
    }

    if (diffMin < 60) {
        return { label: `Há ${diffMin} min` };
    }

    return { label: `Há ${diffHours}h` };
}

function updateRankingBadge(badge) {
    const badgeEl = document.getElementById('ranking-status-badge');
    if (badgeEl) {
        badgeEl.textContent = badge.label;
    }
}

/**
 * Busca o ranking mais recente da VPS
 * Usa o endpoint estático servido pelo Nginx que é atualizado diariamente
 */
async function fetchRankingFromSupabase() {
    try {
        rankingDebugLog(`[Ranking] Buscando ranking mais recente: ${RANKING_API_URL}`);

        const response = await fetch(RANKING_API_URL, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            },
            cache: 'no-store'
        });

        if (!response.ok) {
            console.warn(`[Ranking] Ranking não encontrado (${response.status}).`);
            return null;
        }

        const data = await response.json();
        
        if (!data.ranking || !Array.isArray(data.ranking)) {
            console.warn('[Ranking] Formato de dados inválido.');
            return null;
        }

        rankingDebugLog(`[Ranking] Ranking carregado: ${data.total_users} usuários (${data.date}, gerado em ${data.generated_at})`);
        
        const ranking = data.ranking.map(entry => ({
            publicId: entry.ranking_code || null,
            name: entry.display_name || 'Agente EC',
            score: entry.xp,
            level: entry.level,
            position: entry.rank,
            time: '--:--:--',
            avatar: entry.avatar_file_name || null
        }));

        return {
            ranking,
            generatedAt: data.generated_at,
            date: data.date
        };

    } catch (error) {
        console.error('[Ranking] Erro ao buscar ranking:', error);
        return null;
    }
}

/**
 * Constrói os dados do ranking, mesclando dados da VPS com o usuário atual
 * @param {Object} user - Dados do usuário logado
 * @param {Array} rankingData - Dados do ranking da VPS (opcional)
 * @returns {Array} Array com os dados do ranking processados
 */
function buildRankingDataWithSupabase(user, rankingData = null) {
    if (rankingData && rankingData.length > 0) {
        const currentRankingCode = getPublicRankingCode(user).toLowerCase();
        const ranking = rankingData.map(entry => ({
            ...entry,
            isCurrentUser: currentRankingCode
                ? String(entry.publicId || '').trim().toLowerCase() === currentRankingCode
                : false
        }));

        const userInRanking = ranking.some(entry => entry.isCurrentUser);
        if (!userInRanking && currentRankingCode) {
            ranking.push({
                publicId: getPublicRankingCode(user),
                name: getPublicDisplayName(user),
                score: Number(user?.xp || 0),
                level: Number(user?.level || 1),
                position: ranking.length + 1,
                time: '--:--:--',
                avatar: user?.avatar_file_name || user?.avatarFileName || null,
                isCurrentUser: true
            });
        }

        return ranking;
    }

    return [];
}

function formatXp(value) {
    return Number(value || 0).toLocaleString('pt-BR');
}

function renderPodium(entries, currentUser) {
    const podiumEl = document.getElementById('ranking-podium');
    if (!podiumEl) {
        return;
    }

    podiumEl.innerHTML = '';

    const top3 = (entries || []).filter(entry => entry.position <= 3);
    if (top3.length === 0) {
        return;
    }

    top3.forEach(entry => {
        const card = document.createElement('article');
        card.className = `podium podium--${entry.position} ${entry.isCurrentUser ? 'is-you' : ''}`.trim();

        const avatarHTML = buildAvatarHTML(entry, currentUser, { initials: 'podium__initials' });
        const youTag = entry.isCurrentUser ? '<span class="podium__you">Você</span>' : '';

        card.innerHTML = `
            ${youTag}
            <div class="podium__medal">${entry.position}</div>
            <div class="podium__avatar">${avatarHTML}</div>
            <div class="podium__info">
                <span class="podium__name">${escapeHtml(entry.name)}</span>
                <span class="podium__level">Nível ${entry.level || 1}</span>
            </div>
            <span class="podium__xp">${formatXp(entry.score)} XP</span>
        `;

        podiumEl.appendChild(card);
    });
}

function renderRankingList(entries) {
    const listEl = document.getElementById('ranking-list');
    const countEl = document.getElementById('ranking-count');
    if (!listEl) {
        return;
    }

    listEl.innerHTML = '';

    if (!entries || entries.length === 0) {
        if (countEl) countEl.textContent = '—';
        listEl.innerHTML = `
            <div class="rank-state">
                <div class="rank-state__ic">
                    <svg viewBox="0 0 24 24" fill="none" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="20" x2="18" y2="10"></line>
                        <line x1="12" y1="20" x2="12" y2="4"></line>
                        <line x1="6" y1="20" x2="6" y2="14"></line>
                    </svg>
                </div>
                <div class="rank-state__title">Ranking em breve</div>
                <div class="rank-state__text">O ranking será gerado após o primeiro dia de jogo (às 19h05).</div>
            </div>
        `;
        return;
    }

    if (countEl) {
        countEl.textContent = `${entries.length} agentes`;
    }

    const loggedInUser = getLoggedInUserKey();
    const users = getUsersData();
    const currentUser = users[loggedInUser];

    const restFiltered = entries.filter(entry => entry.position > 3);
    let rest = restFiltered.slice(0, 20);

    // Se o usuário logado está no ranking mas ficou fora do Top 23, adiciona-o como uma linha extra no fim
    const currentUserInFullRest = restFiltered.find(entry => entry.isCurrentUser);
    const currentUserInSlicedRest = rest.some(entry => entry.isCurrentUser);

    if (currentUserInFullRest && !currentUserInSlicedRest) {
        rest.push(currentUserInFullRest);
    }

    if (rest.length === 0) {
        listEl.innerHTML = `
            <div class="rank-state">
                <div class="rank-state__title">Só o pódio por aqui</div>
                <div class="rank-state__text">Ainda não há agentes além do top 3. Continue jogando para crescer o ranking!</div>
            </div>
        `;
        return;
    }

    rest.forEach(entry => {
        const row = document.createElement('div');
        row.className = `rk-row ${entry.isCurrentUser ? 'me' : ''}`.trim();

        const avatarHTML = buildAvatarHTML(entry, currentUser, { initials: 'rk-av__initials' });
        const meTag = entry.isCurrentUser ? '<span class="me-tag">(você)</span>' : '';

        row.innerHTML = `
            <div class="rk-p">${entry.position}º</div>
            <div class="rk-av">${avatarHTML}</div>
            <div class="rk-in">
                <div class="rk-nm">${escapeHtml(entry.name)}${meTag}</div>
                <div class="rk-dp">Nível ${entry.level || 1}</div>
            </div>
            <div class="rk-xp">${formatXp(entry.score)} XP</div>
        `;

        listEl.appendChild(row);
    });
}

function updateRankingSummary(entries, user) {
    const totalPlayersEl = document.getElementById('ranking-total-players');
    const myPositionEl = document.getElementById('ranking-my-position');
    const myXpEl = document.getElementById('ranking-my-xp');

    if (!entries || entries.length === 0) {
        if (totalPlayersEl) totalPlayersEl.textContent = '0';
        if (myPositionEl) myPositionEl.textContent = '--';
        if (myXpEl) myXpEl.textContent = String(user?.xp || 0);
        return;
    }

    const currentEntry = entries.find(entry => entry.isCurrentUser);

    if (totalPlayersEl) {
        totalPlayersEl.textContent = String(entries.length);
    }
    if (myPositionEl) {
        myPositionEl.textContent = currentEntry ? `#${currentEntry.position}` : '--';
    }
    if (myXpEl) {
        myXpEl.textContent = String(user?.xp || 0);
    }
}

function updateUserHeader(user) {
    const displayName = getPublicDisplayName(user);
    const displayLevel = user?.level || 1;
    const displayXp = Number(user?.xp || 0);
    const initials = getInitials(displayName);

    const clearSkeleton = (el) => {
        if (!el) return;
        el.classList.remove('home-skeleton-text', 'home-skeleton-text--name',
            'home-skeleton-text--level', 'home-skeleton-text--xp');
    };

    const headerName = document.getElementById('header-user-name');
    const headerLevel = document.getElementById('header-user-level');
    const headerXp = document.getElementById('header-user-xp');
    const mobileName = document.getElementById('mobile-user-name');
    const mobileLevel = document.getElementById('mobile-user-level');
    const headerAvatarContainer = document.getElementById('header-user-avatar');
    const mobileAvatarContainer = document.getElementById('mobile-user-avatar');

    if (headerName) { headerName.textContent = displayName; clearSkeleton(headerName); }
    if (headerLevel) { headerLevel.textContent = `Nível ${displayLevel}`; clearSkeleton(headerLevel); }
    if (headerXp) { headerXp.textContent = `${displayXp} XP`; clearSkeleton(headerXp); }
    if (mobileName) { mobileName.textContent = displayName; clearSkeleton(mobileName); }
    if (mobileLevel) { mobileLevel.textContent = `Nível ${displayLevel}`; clearSkeleton(mobileLevel); }

    const updateAvatar = (container, isLarge = false) => {
        if (!container) return;

        if (user.avatar_file_name) {
            const avatarPath = `/frontend/assets/image/avatar/${user.avatar_file_name}`;
            const existingImg = container.querySelector('.user-avatar__img');
            if (existingImg && existingImg.getAttribute('src') === avatarPath) {
                return;
            }

            container.innerHTML = '';

            const img = document.createElement('img');
            img.src = avatarPath;
            img.alt = displayName;
            img.className = 'user-avatar__img';

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

    updateAvatar(headerAvatarContainer, false);
    updateAvatar(mobileAvatarContainer, true);
}

function initHeaderScrollEffect() {
    window.addEventListener('scroll', () => {
        const header = document.getElementById('header');
        if (!header) {
            return;
        }
        if (window.scrollY > 10) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    }, { passive: true });
}

let generatedAt = null;
let rankingDate = null;

async function loadAndRenderRanking(user, currentUser, { silent = false } = {}) {
    const rankingResponse = await fetchRankingFromSupabase();
    let rankingData = null;

    if (rankingResponse) {
        // Se é refresh silencioso e o generated_at não mudou, só atualiza o badge
        if (silent && rankingResponse.generatedAt !== null && rankingResponse.generatedAt === generatedAt) {
            const badge = getRankingBadge(generatedAt, rankingDate);
            updateRankingBadge(badge);
            return;
        }

        generatedAt = rankingResponse.generatedAt;
        rankingDate = rankingResponse.date;
        rankingData = rankingResponse.ranking;
    }

    const rankingEntries = buildRankingDataWithSupabase(user, rankingData);

    // Crossfade suave nos elementos visuais se for refresh em background
    const targets = ['ranking-podium', 'ranking-list'].map(id => document.getElementById(id)).filter(Boolean);
    if (silent && targets.length) {
        targets.forEach(el => { el.style.transition = 'opacity 0.2s ease'; el.style.opacity = '0'; });
        await new Promise(r => setTimeout(r, 200));
    }

    renderPodium(rankingEntries, currentUser);
    renderRankingList(rankingEntries);
    updateRankingSummary(rankingEntries, user);

    if (silent && targets.length) {
        targets.forEach(el => { el.style.opacity = '1'; });
        setTimeout(() => targets.forEach(el => { el.style.transition = ''; }), 250);
    }

    const badge = getRankingBadge(generatedAt, rankingDate);
    updateRankingBadge(badge);

    const timestamp = document.getElementById('ranking-timestamp');
    if (timestamp && rankingDate) {
        const [year, month, day] = rankingDate.split('-');
        timestamp.textContent = `Ranking de ${day}/${month}/${year}`;
    } else if (timestamp) {
        timestamp.textContent = 'Aguardando primeiro ranking';
    }
}

async function refreshRankingInBackground(user, currentUser) {
    const indicator = document.getElementById('sync-indicator');
    const iconEl = indicator?.querySelector('.sync-icon');
    const textEl = indicator?.querySelector('.sync-text');

    if (indicator) {
        indicator.className = 'sync-indicator syncing';
        if (iconEl) iconEl.innerHTML = `<polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>`;
        if (textEl) textEl.textContent = 'Atualizando...';
    }

    await loadAndRenderRanking(user, currentUser, { silent: true });

    if (indicator) {
        indicator.className = 'sync-indicator success';
        if (iconEl) iconEl.innerHTML = `<polyline points="20 6 9 17 4 12"/>`;
        if (textEl) textEl.textContent = 'Atualizado';

        setTimeout(() => {
            indicator.className = 'sync-indicator';
            if (iconEl) iconEl.innerHTML = `<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>`;
            if (textEl) textEl.textContent = 'Pronto';
        }, 1500);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const loggedInUser = getLoggedInUserKey();
    const loggedIn = localStorage.getItem('loggedIn') || sessionStorage.getItem('loggedIn');

    if (!loggedInUser || !loggedIn) {
        window.location.href = 'login.html';
        return;
    }

    const users = getUsersData();
    const user = users[loggedInUser] || {
        display_name: localStorage.getItem('cx_display_name') || 'Agente EC',
        ranking_code: localStorage.getItem('cx_ranking_code') || sessionStorage.getItem('cx_ranking_code') || null,
        level: 1,
        xp: 0
    };
    const currentUser = users[loggedInUser];

    updateUserHeader(user);

    await initSyncIndicators();

    const listEl = document.getElementById('ranking-list');
    if (listEl) {
        listEl.innerHTML = `<div class="rank-state"><div class="rank-state__title">Carregando ranking...</div></div>`;
    }

    await loadAndRenderRanking(user, currentUser);

    // A cada 5 minutos (ciclo de geração do ranking), busca dados frescos da API
    let refreshInterval, badgeInterval;

    function startIntervals() {
        refreshInterval = setInterval(async () => {
            await refreshRankingInBackground(user, currentUser);
        }, 300000);
        badgeInterval = setInterval(() => {
            if (generatedAt && rankingDate) {
                const updatedBadge = getRankingBadge(generatedAt, rankingDate);
                updateRankingBadge(updatedBadge);
            }
        }, 60000);
    }

    startIntervals();

    window.addEventListener('pagehide', () => {
        clearInterval(refreshInterval);
        clearInterval(badgeInterval);
    });

    window.addEventListener('pageshow', (e) => {
        if (e.persisted) startIntervals();
    });

    initHeaderScrollEffect();
});

async function initSyncIndicators() {
    const indicator = document.getElementById('sync-indicator');
    const iconEl = indicator?.querySelector('.sync-icon');
    const textEl = indicator?.querySelector('.sync-text');
    
    if (!indicator) {
        console.warn('[Ranking] Sync indicator element not found');
        return;
    }

    const updateIcon = (state) => {
        if (!iconEl) return;
        const icons = {
            syncing: `<polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>`,
            success: `<polyline points="20 6 9 17 4 12"/>`,
            idle: `<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>`
        };
        iconEl.innerHTML = icons[state] || icons.idle;
    };

    updateIcon('syncing');
    indicator.className = 'sync-indicator syncing';
    if (textEl) textEl.textContent = 'Sincronizando...';

    setTimeout(() => {
        indicator.className = 'sync-indicator success';
        updateIcon('success');
        if (textEl) textEl.textContent = 'Sincronizado';

        setTimeout(() => {
            indicator.className = 'sync-indicator';
            updateIcon('idle');
            if (textEl) textEl.textContent = 'Pronto';
        }, 1200);
    }, 500);
}

window.toggleMobileMenu = toggleMobileMenu;
window.handleLogout = handleLogout;

(function() {
    const todayStr = new Date().toLocaleDateString('pt-BR');
    const storageKey = `cx-daily-game-seen-${todayStr}`;
    const bell = document.querySelector('.header__bell');

    if (localStorage.getItem(storageKey) === 'true') {
        if (bell) bell.classList.add('seen');
    }

    if (bell) {
        bell.addEventListener('click', (e) => {
            e.preventDefault();
            const isLocalHtml = window.location.pathname.endsWith('.html');
            const appUrl = isLocalHtml ? 'app.html?playDaily=true' : '/app?playDaily=true';
            window.location.href = appUrl;
        });
    }
})();
