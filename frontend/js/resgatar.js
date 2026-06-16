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

function getInitials(name) {
    if (!name) return 'EC';
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function getPublicDisplayName(user, fallback = 'Agente EC') {
    return user?.display_name || user?.displayName || fallback;
}

function toggleMobileMenu() {
    const btn = document.getElementById('mobile-menu-btn');
    const nav = document.getElementById('mobile-nav');
    const overlay = document.getElementById('mobile-nav-overlay');
    if (!nav) return;
    const isOpen = nav.classList.contains('open');

    btn?.classList.toggle('active');
    nav.classList.toggle('open');
    overlay?.classList.toggle('visible');
    document.body.style.overflow = isOpen ? '' : 'hidden';
}

async function handleLogout() {
    document.body.style.opacity = '0';
    document.body.style.transition = 'opacity 0.4s ease';

    setTimeout(() => {
        window.CxSession?.clearSessionState?.();
        window.location.replace('login.html');
    }, 400);
}

function clearSkeleton(el) {
    if (!el) return;
    el.classList.remove('home-skeleton-text', 'home-skeleton-text--name',
        'home-skeleton-text--level', 'home-skeleton-text--xp');
}

function loadUserData() {
    const loggedInUser = window.CxSession?.getSessionValue?.('cx_logged_in_user')
        || localStorage.getItem('cx_logged_in_user')
        || sessionStorage.getItem('cx_logged_in_user');

    if (!loggedInUser) {
        window.CxSession?.redirectToLogin?.() || window.location.replace('login.html');
        return null;
    }

    const users = getUsersData();
    const user = users[loggedInUser];

    if (!user) {
        console.warn('[Resgatar] User not found in storage');
        window.CxSession?.redirectToLogin?.() || window.location.replace('login.html');
        return null;
    }

    const displayName = getPublicDisplayName(user);
    const initials = getInitials(displayName);
    const level = user.level || 1;
    const xp = Number(user.xp || 0);

    const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) { el.textContent = value; clearSkeleton(el); }
    };
    set('header-user-name', displayName);
    set('header-user-level', `Nível ${level}`);
    set('header-user-xp', `${xp} XP`);
    set('mobile-user-name', displayName);
    set('mobile-user-level', `Nível ${level}`);

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
            img.alt = displayName;
            img.className = 'user-avatar__img';
            img.onerror = () => { container.innerHTML = `<span class="user-avatar__initials">${initials}</span>`; };
            container.appendChild(img);
        } else {
            container.innerHTML = `<span class="user-avatar__initials">${initials}</span>`;
        }

        if (!isLarge) {
            const status = document.createElement('div');
            status.className = 'avatar-status';
            container.appendChild(status);
        }
    };
    updateAvatar(document.getElementById('header-user-avatar'), false);
    updateAvatar(document.getElementById('mobile-user-avatar'), true);

    return user;
}

const AML_SYMBOLS = {
    ec:     '<text x="14" y="19" font-family="DM Sans" font-weight="800" font-size="13" fill="currentColor" stroke="none" text-anchor="middle" class="aml-letters">EC</text>',
    xp:     '<text x="14" y="19" font-family="Space Mono" font-weight="700" font-size="12" fill="currentColor" stroke="none" text-anchor="middle">XP</text>',
    reward: '<rect x="6" y="12" width="16" height="10" rx="1.5" class="aml-draw" style="--len:52"/><line x1="6" y1="15.5" x2="22" y2="15.5" class="aml-draw" style="--len:16"/><line x1="14" y1="12" x2="14" y2="22" class="aml-draw" style="--len:10"/><path d="M14 12 C14 8 10 7.5 10 10 C10 12 14 12 14 12 Z" class="aml-draw" style="--len:14"/><path d="M14 12 C14 8 18 7.5 18 10 C18 12 14 12 14 12 Z" class="aml-draw" style="--len:14"/>',
    check:  '<polyline points="6,14.5 12,20 22,8" class="aml-draw" style="--len:26"/>'
};

const AML_SPARK = '<svg class="aml-spark" viewBox="0 0 28 28"><line x1="14" y1="1" x2="14" y2="4"/><line x1="14" y1="24" x2="14" y2="27"/><line x1="1" y1="14" x2="4" y2="14"/><line x1="24" y1="14" x2="27" y2="14"/><line x1="5" y1="5" x2="7" y2="7"/><line x1="21" y1="21" x2="23" y2="23"/><line x1="23" y1="5" x2="21" y2="7"/><line x1="7" y1="21" x2="5" y2="23"/></svg>';

const RESGATE_FLOW = ['ec', 'xp', 'reward', 'check'];

let _amlGen = 0;

function amlDrawOne(stage, sym, onDone) {
    const gen = _amlGen;
    stage.innerHTML =
        '<div style="position:relative;width:28px;height:28px">' +
        '<svg class="aml-sym" viewBox="0 0 28 28">' + AML_SYMBOLS[sym] + '</svg>' +
        AML_SPARK + '</div>';
    const wrap = stage.firstChild;
    const svg = wrap.querySelector('.aml-sym');
    const spark = wrap.querySelector('.aml-spark');
    setTimeout(() => {
        if (_amlGen !== gen) return;
        svg.classList.add('aml-pulse');
        if (spark) spark.classList.add('on');
        setTimeout(() => {
            if (_amlGen !== gen) return;
            onDone();
        }, 360);
    }, 420);
}

function runAmlFlow(stage, flow, onComplete) {
    _amlGen++;
    const gen = _amlGen;
    let i = 0;
    const step = () => {
        if (_amlGen !== gen) return;
        if (i >= flow.length) { onComplete(); return; }
        const sym = flow[i++];
        amlDrawOne(stage, sym, step);
    };
    step();
}

function setupRedeemForm() {
    const form = document.getElementById('redeem-form');
    const codeInput = document.getElementById('code-input');
    const submitBtn = document.getElementById('btn-redeem');
    const hint = document.getElementById('rd-hint');
    const resultDiv = document.getElementById('redeem-result');
    const resultIcon = document.getElementById('result-icon');
    const resultTitle = document.getElementById('result-title');
    const resultMessage = document.getElementById('result-message');
    const stage = submitBtn?.querySelector('.aml-stage');

    if (!form || !stage) {
        console.error('[Resgatar] Form/stage not found');
        return;
    }

    const ICONS = {
        ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
        er: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
        info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    };

    function showResult(type, title, message) {
        resultDiv.className = `rd-result rd-result--${type}`;
        resultDiv.hidden = false;
        resultIcon.innerHTML = ICONS[type] || ICONS.info;
        resultTitle.textContent = title;
        resultMessage.textContent = message;
        resultDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (submitBtn.classList.contains('loading')) return;

        const code = codeInput.value.trim();

        if (!code || code.length < 3) {
            hint.textContent = 'O código deve ter pelo menos 3 caracteres.';
            hint.classList.add('is-error');
            showResult('er', 'Código inválido', 'Confira o código e tente novamente.');
            codeInput.focus();
            return;
        }

        hint.classList.remove('is-error');
        resultDiv.hidden = true;

        // Roda o Action Morph Loader (flow de resgate) e, ao concluir, mostra o resultado.
        submitBtn.classList.add('loading');
        submitBtn.setAttribute('aria-busy', 'true');

        runAmlFlow(stage, RESGATE_FLOW, () => {
            submitBtn.classList.remove('loading');
            submitBtn.removeAttribute('aria-busy');
            stage.innerHTML = '';

            // Funcionalidade real será ativada no Experience Week — resposta "em breve".
            showResult(
                'info',
                'Funcionalidade em breve',
                'O resgate de códigos será ativado durante o Experience Week. Fique atento às transmissões ao vivo!'
            );
            codeInput.value = '';
        });
    });

    codeInput.addEventListener('input', () => {
        if (!resultDiv.hidden) resultDiv.hidden = true;
        if (hint.classList.contains('is-error')) {
            hint.classList.remove('is-error');
            hint.textContent = 'Cada código pode ser resgatado uma única vez.';
        }
    });
}

window.addEventListener('scroll', () => {
    const header = document.getElementById('header');
    if (!header) return;
    header.classList.toggle('scrolled', window.scrollY > 10);
}, { passive: true });

async function initSyncIndicators() {
    const indicator = document.getElementById('sync-indicator');
    const iconEl = indicator?.querySelector('.sync-icon');
    const textEl = indicator?.querySelector('.sync-text');
    if (!indicator) return;

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

function loadRedemptionHistory(userKey) {
    const raw = localStorage.getItem(`cx_redemptions_${userKey}`) || '[]';
    try { return JSON.parse(raw); } catch { return []; }
}

function renderHistoryTable(userKey) {
    const table = document.getElementById('rd-history-table');
    const body = document.getElementById('rd-history-body');
    const empty = document.getElementById('rd-history-empty');
    if (!table || !body || !empty) return;

    const history = loadRedemptionHistory(userKey);

    if (history.length === 0) {
        table.hidden = true;
        empty.hidden = false;
        return;
    }

    const BADGE = {
        xp: '<span class="rd-history__badge rd-history__badge--xp">XP</span>',
        brinde: '<span class="rd-history__badge rd-history__badge--brinde">Brinde</span>',
        conquista: '<span class="rd-history__badge rd-history__badge--conquista">Conquista</span>'
    };

    body.innerHTML = history.slice().reverse().slice(0, 10).map(entry => {
        const date = entry.date ? new Date(entry.date).toLocaleDateString('pt-BR') : '—';
        const type = typeof entry.type === 'string' ? entry.type : '';
        const badge = BADGE[type] || `<span class="rd-history__badge">${escapeHtml(type) || '—'}</span>`;
        return `<tr>
            <td><span class="rd-history__code">${escapeHtml(entry.code || '—')}</span></td>
            <td>${badge}</td>
            <td>${date}</td>
            <td>${escapeHtml(entry.reward || '—')}</td>
        </tr>`;
    }).join('');

    empty.hidden = true;
    table.hidden = false;
}

document.addEventListener('DOMContentLoaded', async () => {
    const user = loadUserData();
    if (!user) return;

    const userKey = window.CxSession?.getSessionValue?.('cx_logged_in_user')
        || localStorage.getItem('cx_logged_in_user')
        || sessionStorage.getItem('cx_logged_in_user');

    await initSyncIndicators();
    setupRedeemForm();
    renderHistoryTable(userKey);
});

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
