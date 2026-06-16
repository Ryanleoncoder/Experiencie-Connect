function conquistasDebugLog(...args) {
  if (typeof window !== 'undefined' && window.CX_DEBUG === true) {
    console.debug(...args);
  }
}

const FIRESTORE_TIMEOUT_MS = 4000;
const CACHE_KEY = 'cx_achievements_firebase';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const RANKING_API_URL = 'https://api.expconnect.com.br/ranking/current';

const AchievementProgressApi = window.AchievementProgress || {};
const normalizeAchievementProgress = AchievementProgressApi.normalizeAchievementProgress || function fallbackNormalizeProgress(source = {}, overrides = {}) {
    const completedChallenges = Array.isArray(overrides.completedChallenges) ? overrides.completedChallenges : (source.completedChallenges || source.completed_challenges || []);
    const completedMinigames = Array.isArray(overrides.completedMinigames) ? overrides.completedMinigames : (source.completedMinigames || source.completed_minigames || []);
    const failedChallenges = Array.isArray(overrides.failedChallenges) ? overrides.failedChallenges : (source.failedChallenges || source.failed_challenges || []);
    const logumChallenges = Array.isArray(overrides.logumChallenges) ? overrides.logumChallenges : (source.logumChallenges || source.logum_challenges || []);

    return {
        xp: Number(source?.xp || 0),
        level: Number(source?.level || 1),
        completedChallenges,
        completedMinigames,
        failedChallenges,
        logumChallenges,
        combined: completedChallenges.length + completedMinigames.length
    };
};
const deriveAllLevelsPerformance = AchievementProgressApi.deriveAllLevelsPerformance || function fallbackAllLevelsPerformance() {
    return null;
};
const buildAchievementCards = AchievementProgressApi.buildAchievementCards || function fallbackBuildAchievementCards(rawList, progress) {
    return (rawList || []).map(achievement => {
        const tipo = achievement.tipo || achievement.type || '';
        const target = achievement.criterio_valor ?? achievement.target;
        let value = 0;

        if (tipo === 'xp') value = progress.xp;
        if (tipo === 'level') value = progress.level;
        if (tipo === 'challenges') value = progress.completedChallenges.length;
        if (tipo === 'minigames') value = progress.completedMinigames.length;
        if (tipo === 'failed_challenges') value = progress.failedChallenges.length;
        if (tipo === 'combined') value = progress.combined;
        if (tipo === 'logum_challenges') value = progress.logumChallenges.length;

        const progressPercent = typeof target === 'number' && target > 0
            ? Math.min(100, Math.round((value / target) * 100))
            : 0;

        return {
            ...achievement,
            value,
            progress: progressPercent,
            unlocked: typeof target === 'number' ? value >= target : false,
            isSpecial: false
        };
    });
};

const ACHIEVEMENTS_FALLBACK = [
    { id: 'xp-100',    nome: 'Primeiro Upgrade',          descricao: 'Alcance 100 XP total.',                                         categoria: 'XP',       icone: '🎯', tipo: 'xp',                     criterio_valor: 100 },
    { id: 'xp-500',    nome: 'Agente em Evolucao',         descricao: 'Alcance 500 XP total.',                                         categoria: 'XP',       icone: '📚', tipo: 'xp',                     criterio_valor: 500 },
    { id: 'level-2',   nome: 'Subiu de Nivel',             descricao: 'Chegue ao nivel 2.',                                            categoria: 'Nivel',    icone: '🔼', tipo: 'level',                  criterio_valor: 2   },
    { id: 'level-5',   nome: 'Veterano EC',                descricao: 'Chegue ao nivel 5.',                                            categoria: 'Nivel',    icone: '👑', tipo: 'level',                  criterio_valor: 5   },
    { id: 'challenges-10',  nome: 'Quiz Hunter',           descricao: 'Complete 10 desafios.',                                         categoria: 'Desafios', icone: '🌱', tipo: 'challenges',             criterio_valor: 10  },
    { id: 'challenges-30',  nome: 'Mestre dos Desafios',   descricao: 'Complete 30 desafios.',                                         categoria: 'Desafios', icone: '🚀', tipo: 'challenges',             criterio_valor: 30  },
    { id: 'minigames-1',    nome: 'Boss Challenger',       descricao: 'Conclua seu primeiro minigame.',                                categoria: 'Minigame', icone: '🎮', tipo: 'minigames',             criterio_valor: 1   },
    { id: 'minigames-3',    nome: 'Arcade EC Master',      descricao: 'Conclua todos os 3 minigames.',                                 categoria: 'Minigame', icone: '🕹️', tipo: 'minigames',             criterio_valor: 3   },
    { id: 'failed-challenge', nome: 'Ninguem é Perfeito',  descricao: 'Falhe 3 vezes em 1 desafio.',                                   categoria: 'Especial', icone: '💪', tipo: 'failed_challenges',      criterio_valor: 1   },
    { id: 'all-content',    nome: 'Lenda da Temporada',    descricao: 'Some 40 conclusoes entre desafios e minigames.',                categoria: 'Geral',    icone: '💎', tipo: 'combined',               criterio_valor: 40  },
    { id: 'ultra-instinct', nome: 'Ultra Instinct',        descricao: 'Reflexos perfeitos. 100% de acertos em todos os desafios.',    categoria: 'Lendário', icone: '⚡', tipo: 'all_levels_performance', criterio_valor: 100 },
    { id: 'perfectly-balanced', nome: 'Perfeitamente Equilibrado', descricao: 'Perfeitamente equilibrado, como tudo deve ser.',       categoria: 'Lendário', icone: '⚖️', tipo: 'all_levels_performance', criterio_valor: 'balanced' },
    { id: 'skill-issue',    nome: 'Skill Issue',           descricao: 'Acontece nas melhores famílias.',                               categoria: 'Lendário', icone: '💀', tipo: 'all_levels_performance', criterio_valor: 0   },
    { id: 'the-one-above-all', nome: 'The One Above All',  descricao: 'Um nível acima de todos os outros jogadores.',                  categoria: 'Lendário', icone: '☄️', tipo: 'ranking',               criterio_valor: 1   }
];

function withTimeout(promise, ms) {
    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Firebase timeout')), ms)
    );
    return Promise.race([promise, timeout]);
}

async function loadAchievementsFromFirebase() {
    // 1. Checar cache local (24h — definições de conquistas não mudam durante a temporada)
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            if (parsed._ts && Date.now() - parsed._ts < CACHE_TTL_MS) {
                conquistasDebugLog('[Conquistas] ✅ Achievements carregados do cache local');
                return parsed.data;
            }
        } catch (_) {}
        localStorage.removeItem(CACHE_KEY);
    }

    // 2. Aguardar Firebase estar pronto (módulo ESM é assíncrono)
    await waitForFirebase();

    const db = window.firebaseDb;
    const { collection, getDocs } = await import('https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js');

    const snap = await withTimeout(
        getDocs(collection(db, 'achievements')),
        FIRESTORE_TIMEOUT_MS
    );

    const achievements = [];
    snap.forEach(docSnap => achievements.push({ id: docSnap.id, ...docSnap.data() }));

    if (achievements.length === 0) {
        throw new Error('No achievements found in Firebase');
    }

    localStorage.setItem(CACHE_KEY, JSON.stringify({ data: achievements, _ts: Date.now() }));
    conquistasDebugLog(`[Conquistas] ✅ ${achievements.length} achievements loaded from Firebase`);
    return achievements;
}

/**
 * Aguarda window.firebaseDb estar disponível (o script type="module" é assíncrono)
 */
function waitForFirebase(timeoutMs = 5000) {
    if (window.firebaseDb) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const check = () => {
            if (window.firebaseDb) return resolve();
            if (Date.now() - start > timeoutMs) return reject(new Error('Firebase init timeout'));
            setTimeout(check, 50);
        };
        check();
    });
}

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
        }
    });
}, { threshold: 0.1 });

function getStorageType() {
    if (sessionStorage.getItem('cx_logged_in_user')) return sessionStorage;
    if (localStorage.getItem('cx_logged_in_user')) return localStorage;
    return window.CxSession?.getPrimaryStorage?.() || sessionStorage;
}

function getUsersData() {
    const storage = getStorageType();
    return JSON.parse(storage.getItem('cx_users') || '{}');
}

function saveUsersData(users) {
    const storage = getStorageType();
    storage.setItem('cx_users', JSON.stringify(users));
}

function getLoggedInUserKey() {
    return window.CxSession?.getSessionValue?.('cx_logged_in_user') || localStorage.getItem('cx_logged_in_user') || sessionStorage.getItem('cx_logged_in_user');
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

function getProtectedHeaders() {
    return window.CxSession?.buildProtectedHeaders?.({ Accept: 'application/json' }) || { Accept: 'application/json' };
}

async function loadProtectedProgress() {
    const response = await fetch('/api/progress', {
        method: 'GET',
        headers: getProtectedHeaders()
    });

    if (!response.ok) {
        throw new Error(`progress_${response.status}`);
    }

    return response.json();
}

async function loadProtectedFlowStatus(seasonId = 'S-2025-01') {
    const response = await fetch(`/api/user-flow-status?seasonId=${encodeURIComponent(seasonId)}`, {
        method: 'GET',
        headers: getProtectedHeaders()
    });

    if (!response.ok) {
        throw new Error(`flow_status_${response.status}`);
    }

    return response.json();
}

async function loadRankingPosition(user) {
    const rankingCode = String(user?.ranking_code || user?.rankingCode || '').trim().toLowerCase();
    if (!rankingCode) {
        return null;
    }

    const response = await fetch(RANKING_API_URL, {
        method: 'GET',
        headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
        throw new Error(`ranking_${response.status}`);
    }

    const payload = await response.json();
    const rankingEntries = Array.isArray(payload?.ranking) ? payload.ranking : [];
    const currentEntry = rankingEntries.find(entry =>
        String(entry?.ranking_code || '').trim().toLowerCase() === rankingCode
    );

    return currentEntry?.rank || null;
}

function deriveFailedChallenges(flowStatus, fallback = []) {
    const statuses = Array.isArray(flowStatus?.challenge_statuses) ? flowStatus.challenge_statuses : [];
    const failedFromFlow = statuses
        .filter(item => item?.status === 'failed' && item?.challenge_id)
        .map(item => item.challenge_id);

    return failedFromFlow.length > 0 ? failedFromFlow : (Array.isArray(fallback) ? fallback : []);
}

function mergeRemoteProgressIntoUser(localUser, remoteProgress, flowStatus) {
    if (!remoteProgress && !flowStatus) {
        return localUser;
    }

    const failedChallenges = deriveFailedChallenges(flowStatus, localUser?.failedChallenges);

    return {
        ...localUser,
        xp: Number(remoteProgress?.xp ?? localUser?.xp ?? 0),
        level: Number(remoteProgress?.level ?? localUser?.level ?? 1),
        completedChallenges: Array.isArray(remoteProgress?.completed_challenges)
            ? remoteProgress.completed_challenges
            : (localUser?.completedChallenges || []),
        completedMinigames: Array.isArray(remoteProgress?.completed_minigames)
            ? remoteProgress.completed_minigames
            : (localUser?.completedMinigames || []),
        failedChallenges,
        logumChallenges: Array.isArray(localUser?.logumChallenges) ? localUser.logumChallenges : [],
        display_name: remoteProgress?.display_name || localUser?.display_name || localUser?.displayName || null,
        ranking_code: remoteProgress?.ranking_code || localUser?.ranking_code || localUser?.rankingCode || null,
        avatar_file_name: remoteProgress?.avatar_file_name || localUser?.avatar_file_name || null
    };
}

function persistResolvedUser(userKey, user) {
    if (!userKey || !user) {
        return;
    }

    const users = getUsersData();
    users[userKey] = {
        ...(users[userKey] || {}),
        ...user
    };
    saveUsersData(users);

    const storage = getStorageType();
    if (user.display_name) {
        storage.setItem('cx_display_name', user.display_name);
    }
    if (user.ranking_code) {
        storage.setItem('cx_ranking_code', user.ranking_code);
    }
}

/**
 * Une a lista local (canônica) com a do Firebase por id.
 * Garante que todas as conquistas conhecidas apareçam; dados do Firebase
 * enriquecem/sobrescrevem os campos quando o mesmo id existe, e ids novos
 * do Firebase são adicionados ao final.
 */
function mergeAchievements(base, extra) {
    const byId = new Map();
    (base || []).forEach(a => { if (a && a.id) byId.set(a.id, { ...a }); });
    (extra || []).forEach(a => {
        if (!a || !a.id) return;
        byId.set(a.id, { ...(byId.get(a.id) || {}), ...a });
    });
    return Array.from(byId.values());
}

function buildAchievements(rawList, user, extras = {}) {
    const progress = normalizeAchievementProgress(user, {
        failedChallenges: extras.failedChallenges,
        logumChallenges: Array.isArray(user?.logumChallenges) ? user.logumChallenges : []
    });

    return buildAchievementCards(rawList, progress, {
        allLevelsPerformance: extras.allLevelsPerformance || null,
        rankingPosition: extras.rankingPosition || null
    });
}


function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const RAR_STAR    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3 L14.5 9 L21 9.5 L16 13.5 L17.5 20 L12 16.5 L6.5 20 L8 13.5 L3 9.5 L9.5 9 Z"/></svg>';
const RAR_DIAMOND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 3 H18 L22 9 L12 21 L2 9 Z"/><path d="M2 9 H22 M9 3 L7 9 L12 21 M15 3 L17 9 L12 21"/></svg>';
const RAR_CROWN   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7 L7 11 L12 5 L17 11 L21 7 L19 19 H5 Z"/></svg>';

const SPOTIFY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#fff"/><path d="M6.5 9.5c4-1 8-0.5 11 1.2M7 13c3-0.7 6.5-0.3 9 1.1M7.5 16c2.4-0.5 5-0.2 7 0.9" stroke="#1DB954" stroke-width="1.7" stroke-linecap="round" fill="none"/></svg>';

const RARITY = {
    normal: { cls: 'rn', label: 'Normal',   xp: 50,  corner: null },
    raro:   { cls: 'rr', label: 'Raro',     xp: 120, corner: { color: '#2D7DD2', icon: RAR_STAR } },
    epico:  { cls: 're', label: 'Épico',    xp: 300, corner: { color: '#A78BFA', icon: RAR_DIAMOND } },
    lend:   { cls: 'rl', label: 'Lendário', xp: 500, corner: { color: 'var(--y)', icon: RAR_CROWN } }
};

// Trilha musical por conquista. POR ENQUANTO só a primeira conquista (Primeiro Upgrade)
// FONTE PRIMÁRIA = Firebase: cada conquista pode ter `song`/`artist` no doc.
// VINYL_META abaixo é só FALLBACK (caso o doc não tenha os campos / Firebase falhe).
const VINYL_META = {
    'xp-100': { song: 'ABC', artist: 'Jackson 5' },
    'the-one-above-all': { song: 'Number One', artist: 'Bankai feat. Hazel Fernandes' }
};

function rarityFor(card) {
    const cat = (card.categoria || card.category || '').toLowerCase();
    if (cat.includes('lend')) return 'lend';
    if (cat.includes('especial') || cat.includes('geral')) return 'epico';
    return 'normal';
}

function metaFor(card) {
    const rarity = rarityFor(card);
    const fb = VINYL_META[card.id] || {};
    // lê do Firebase (card.song/card.artist); cai no fallback só se não vier do doc
    const song = card.song || card.music_song || (card.music && card.music.song) || fb.song || null;
    const artist = card.artist || card.music_artist || (card.music && card.music.artist) || fb.artist || null;
    if (song) return { song, artist, hasSong: true, rarity };
    return { song: null, artist: null, hasSong: false, rarity };
}

function spotifyUrl(song, artist) {
    return 'https://open.spotify.com/search/' + encodeURIComponent(`${song} ${artist}`);
}

// Paleta dos discos por raridade.
// Normal usa um selo claro (cor de papel) p/ NÃO parecer bloqueado (que é cinza-escuro).
const VINYL_DISC = {
    normal: { face: '#1b1b1b', rim: '#6b6660', groove: '#2a2a2a', lbl: '#E7E2D6', lblRim: '#0A0A0A', exp: '#7a7570', ttl: '#0A0A0A', hole: '#888' },
    raro:   { face: '#090e18', rim: '#2D7DD2', groove: '#0d1828', lbl: '#0c1a30', lblRim: '#2D7DD2', exp: '#2D7DD2', ttl: '#ffffff', hole: '#2D7DD2' },
    epico:  { face: '#0e0718', rim: '#7C3AED', groove: '#160d28', lbl: '#150830', lblRim: '#7C3AED', exp: '#A78BFA', ttl: '#ffffff', hole: '#7C3AED' },
    lend:   { face: '#100a00', rim: '#E5A800', groove: '#1e1400', lbl: '#1e1200', lblRim: '#E5A800', exp: '#FFC700', ttl: '#FFE066', hole: '#E5A800' }
};

function discSVG(rarity, centerLabel) {
    const c = VINYL_DISC[rarity] || VINYL_DISC.normal;
    const lbl = escapeHtml(String(centerLabel || '').toUpperCase().slice(0, 14));
    return `<svg class="vdisc" viewBox="0 0 130 130" aria-hidden="true">
        <circle cx="65" cy="65" r="64" fill="${c.face}" stroke="${c.rim}" stroke-width="2"/>
        <circle cx="65" cy="65" r="56" fill="none" stroke="${c.groove}" stroke-width="1"/>
        <circle cx="65" cy="65" r="48" fill="none" stroke="${c.groove}" stroke-width="1"/>
        <circle cx="65" cy="65" r="40" fill="none" stroke="${c.groove}" stroke-width="1"/>
        <circle cx="65" cy="65" r="29" fill="${c.lbl}" stroke="${c.lblRim}" stroke-width="2"/>
        <text x="65" y="60" font-family="Space Mono" font-weight="700" font-size="7" fill="${c.exp}" text-anchor="middle" letter-spacing="1.5">EXP</text>
        <text x="65" y="71" font-family="DM Sans" font-weight="800" font-size="5.6" fill="${c.ttl}" text-anchor="middle">${lbl}</text>
        <circle cx="65" cy="65" r="3.3" fill="#0a0a0a" stroke="${c.hole}" stroke-width="1"/>
    </svg>`;
}

function discLockedSVG() {
    return `<svg class="vdisc" viewBox="0 0 130 130" aria-hidden="true">
        <circle cx="65" cy="65" r="64" fill="#0d0d0d" stroke="#2a2a2a" stroke-width="2"/>
        <circle cx="65" cy="65" r="56" fill="none" stroke="#161616" stroke-width="1"/>
        <circle cx="65" cy="65" r="48" fill="none" stroke="#161616" stroke-width="1"/>
        <circle cx="65" cy="65" r="40" fill="none" stroke="#161616" stroke-width="1"/>
        <circle cx="65" cy="65" r="29" fill="#191919" stroke="#333" stroke-width="2"/>
        <g transform="translate(56.5,57)" stroke="#4a4a4a" stroke-width="2" fill="none"><rect x="0" y="7" width="17" height="12.5" rx="2"/><path d="M3 7 V4.5 a5.5 5.5 0 0 1 11 0 V7"/></g>
        <circle cx="65" cy="65" r="3.3" fill="#0a0a0a" stroke="#333" stroke-width="1"/>
    </svg>`;
}

const PLAY_ICON  = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.79-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/></svg>';
const PREV_ICON  = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><polygon points="19 20 9 12 19 4 19 20"/><rect x="4" y="5" width="2.4" height="14" rx="1"/></svg>';
const NEXT_ICON  = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><polygon points="5 4 15 12 5 20 5 4"/><rect x="17.6" y="5" width="2.4" height="14" rx="1"/></svg>';

function fmtTime(s) { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

const _previewCache = new Map(); // "song|artist" -> previewUrl | null

function itunesSearch(term) {
    return new Promise((resolve) => {
        const cb = '__it_' + Math.random().toString(36).slice(2);
        const script = document.createElement('script');
        let done = false;
        const finish = (val) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try { delete window[cb]; } catch (e) { window[cb] = undefined; }
            script.remove();
            resolve(val);
        };
        const timer = setTimeout(() => finish(null), 6000);
        window[cb] = (data) => finish(data);
        script.onerror = () => finish(null);
        script.src = 'https://itunes.apple.com/search?term=' + encodeURIComponent(term)
            + '&entity=song&limit=1&callback=' + cb;
        document.body.appendChild(script);
    });
}

async function fetchApplePreview(song, artist) {
    const key = `${song}|${artist}`;
    if (_previewCache.has(key)) return _previewCache.get(key);
    const data = await itunesSearch(`${song} ${artist}`);
    const r = data && data.results && data.results[0];
    const url = (r && r.previewUrl) || null;
    _previewCache.set(key, url);
    return url;
}

let _audio = null;
let _playingCard = null;

function setProg(card, frac) {
    const fill = card.querySelector('.vplayer__prog-fill');
    if (fill) fill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
    const cur = card.querySelector('.vpb__cur');
    const tot = card.querySelector('.vpb__total');
    if (_audio && _playingCard === card) {
        if (cur) cur.textContent = fmtTime(_audio.currentTime);
        if (tot && _audio.duration) tot.textContent = fmtTime(_audio.duration);
    } else if (cur) {
        cur.textContent = '0:00';
    }
}

function setPlayState(card, playing) {
    const ic = card.querySelector('.vplayer__ic');
    if (ic) ic.innerHTML = playing ? PAUSE_ICON : PLAY_ICON;
    card.classList.toggle('is-playing', playing);
    if (!playing) setProg(card, 0);
}

function stopPreview() {
    if (_audio) {
        _audio.onended = null;
        _audio.ontimeupdate = null;
        _audio.pause();
    }
    if (_playingCard) {
        setPlayState(_playingCard, false);
        _playingCard = null;
    }
}

async function togglePreview(card) {
    if (_playingCard === card) { stopPreview(); return; }
    stopPreview();

    const song = card.dataset.song || '';
    const artist = card.dataset.artist || '';
    const btn = card.querySelector('.vplayer__play');

    btn && btn.classList.add('is-loading');
    const url = await fetchApplePreview(song, artist);
    btn && btn.classList.remove('is-loading');

    if (!url) {
        // Sem preview na Apple Music — esconde o player e mostra só "Ouvir no Spotify".
        card.classList.add('no-preview');
        return;
    }

    if (!_audio) _audio = new Audio();
    _audio.src = url;
    _audio.ontimeupdate = () => { if (_audio.duration) setProg(card, _audio.currentTime / _audio.duration); };
    _audio.onended = () => stopPreview();
    try {
        await _audio.play();
        _playingCard = card;
        setPlayState(card, true);
    } catch (e) {
        /* play bloqueado — ignora silenciosamente */
    }
}

const SEASON_NAME = 'Conexões';
const CLOSE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

function vhistBlock(categoria) {
    // "Conexões" (nome da temporada) destacado em amarelo
    return `<div class="vhist">
        <span class="vhist-i"><span class="vhist-k">Temporada</span><span class="vhist-v" style="color:var(--y)">${escapeHtml(SEASON_NAME)}</span></span>
        <span class="vhist-i"><span class="vhist-k">Coleção</span><span class="vhist-v">${escapeHtml(categoria || '—')}</span></span>
    </div>`;
}

function musicBlock(meta, locked) {
    if (locked) return `<div class="vmusic"><div class="vsong" style="color:rgba(255,255,255,.2)">♪ ? ? ?</div><div class="vartist">A descobrir</div></div>`;
    return meta.hasSong
        ? `<div class="vmusic"><div class="vsong">♪ ${escapeHtml(meta.song)}</div><div class="vartist">${escapeHtml(meta.artist)}</div></div>`
        : `<div class="vmusic"><div class="vsong" style="color:rgba(255,255,255,.4)">Trilha em breve</div><div class="vartist">—</div></div>`;
}

function playerBlock(meta) {
    if (!meta.hasSong) return '';
    const spUrl = spotifyUrl(meta.song, meta.artist);
    return `<div class="vplayer">
            <div class="vplayer__row">
                <button class="vplayer__play" type="button" aria-label="Tocar preview de ${escapeHtml(meta.song)}"><span class="vplayer__ic">${PLAY_ICON}</span></button>
                <div class="vplayer__eq" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
                <a class="vplayer__sp" href="${spUrl}" target="_blank" rel="noopener" aria-label="Ouvir no Spotify">${SPOTIFY_ICON}</a>
            </div>
            <div class="vplayer__prog"><span class="vplayer__prog-fill"></span></div>
        </div>
        <a class="vspotify-full" href="${spUrl}" target="_blank" rel="noopener">${SPOTIFY_ICON} Ouvir no Spotify</a>`;
}

function playerBarBlock(d) {
    const meta = d.meta;
    const discHtml = d.unlocked ? discSVG(d.rarity, d.nome) : discLockedSVG();
    if (!(d.unlocked && meta.hasSong)) {
        const note = !d.unlocked ? 'Conquista bloqueada' : 'Trilha em breve';
        return `<div class="vpbar vpbar--note">
            <div class="vpbar__art">${discHtml}</div>
            <div class="vpbar__meta"><div class="vpbar__song">${escapeHtml(d.nome)}</div><div class="vpbar__artist">${note}</div></div>
        </div>`;
    }
    const spUrl = spotifyUrl(meta.song, meta.artist);
    return `<div class="vpbar">
        <div class="vpbar__top">
            <div class="vpbar__art">${discHtml}</div>
            <div class="vpbar__meta"><div class="vpbar__song">${escapeHtml(meta.song)}</div><div class="vpbar__artist">${escapeHtml(meta.artist)}</div></div>
            <a class="vpbar__sp" href="${spUrl}" target="_blank" rel="noopener" aria-label="Ouvir no Spotify">${SPOTIFY_ICON}</a>
        </div>
        <div class="vpbar__controls">
            <button class="vplayer__play vpbar__playbtn" type="button" aria-label="Tocar preview"><span class="vplayer__ic">${PLAY_ICON}</span></button>
        </div>
        <div class="vpbar__progrow">
            <span class="vpb__cur">0:00</span>
            <div class="vplayer__prog vpbar__prog"><span class="vplayer__prog-fill"></span></div>
            <span class="vpb__total">0:30</span>
        </div>
    </div>`;
}

let _cardData = [];
let _modalEl = null;

function ensureModal() {
    if (_modalEl) return _modalEl;
    const el = document.createElement('div');
    el.className = 'vmodal';
    el.id = 'vinyl-modal';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<div class="vmodal__scrim" data-close></div>
        <div class="vmodal__card"><button class="vmodal__close" type="button" aria-label="Fechar" data-close>${CLOSE_ICON}</button><div class="vmodal__body"></div></div>`;
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
        if (e.target.closest('[data-close]')) { closeVinylModal(); return; }
        const cardEl = el.querySelector('.vmodal__card');
        if (e.target.closest('.vpbar__prev')) {
            if (_audio && _playingCard === cardEl) { _audio.currentTime = 0; setProg(cardEl, 0); }
            return;
        }
        const seek = e.target.closest('.vpbar__prog');
        if (seek && _audio && _playingCard === cardEl && _audio.duration) {
            const r = seek.getBoundingClientRect();
            _audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * _audio.duration;
            return;
        }
        const play = e.target.closest('.vplayer__play');
        if (play) { e.preventDefault(); togglePreview(cardEl); }
    });
    _modalEl = el;
    return el;
}

function openVinylModal(idx) {
    const d = _cardData[idx];
    if (!d) return;
    stopPreview();

    const el = ensureModal();
    const cardEl = el.querySelector('.vmodal__card');
    cardEl.className = `vmodal__card r-${d.rarity}`;
    delete cardEl.dataset.song;
    delete cardEl.dataset.artist;

    if (d.unlocked && d.meta.hasSong) {
        cardEl.dataset.song = d.meta.song;
        cardEl.dataset.artist = d.meta.artist;
    }

    el.querySelector('.vmodal__body').innerHTML = `
        <div class="vpbar__kicker"><span class="vrar ${d.r.cls}"${d.unlocked ? '' : ' style="opacity:.5"'}>${d.r.label}</span> ${escapeHtml(d.nome)}</div>
        ${playerBarBlock(d)}
    `;

    el.classList.add('open');
    document.body.style.overflow = 'hidden';
}

function closeVinylModal() {
    stopPreview();
    if (_modalEl) _modalEl.classList.remove('open');
    document.body.style.overflow = '';
}

function setupGridClick(grid) {
    if (grid.dataset.clickBound) return;
    grid.dataset.clickBound = '1';
    grid.addEventListener('click', (e) => {
        const card = e.target.closest('.vc');
        if (!card || card.dataset.idx == null) return;
        openVinylModal(Number(card.dataset.idx));
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeVinylModal();
    });
}

function renderAchievements(cards) {
    const grid = document.getElementById('achievements-grid');
    if (!grid) return;
    stopPreview();

    // Fade-out dos skeletons antes de substituir
    grid.style.opacity = '0';
    grid.style.transition = 'opacity 0.2s ease';

    setTimeout(() => {
        grid.innerHTML = '';
        grid.style.opacity = '';
        grid.style.transition = '';
        setupGridClick(grid);
        _cardData = [];

        cards.forEach((card, i) => {
            const nome      = card.nome || card.title || '—';
            const descricao = card.descricao || card.description || '';
            const categoria = card.categoria || card.category || '';
            const meta      = metaFor(card);
            const rarity    = meta.rarity;
            const r         = RARITY[rarity] || RARITY.normal;
            const unlocked  = !!card.unlocked;
            const serial    = '#' + String(i + 1).padStart(3, '0');

            _cardData[i] = { nome, descricao, categoria, meta, rarity, r, unlocked, serial, isSpecial: !!card.isSpecial, progress: card.progress || 0 };

            const corner = r.corner
                ? `<span class="vc-rar-corner" style="color:${r.corner.color}">${r.corner.icon}</span>`
                : '';

            const element = document.createElement('article');
            element.className = `vc r-${rarity} ${unlocked ? '' : 'v-locked'}`.trim();
            element.style.transitionDelay = `${i * 55}ms`;
            element.dataset.idx = String(i);

            if (unlocked) {
                element.innerHTML = `
                    <span class="vc-serial">${serial}</span>
                    ${corner}
                    ${discSVG(rarity, nome)}
                    ${musicBlock(meta, false)}
                    ${meta.hasSong ? '<div class="vc-hint"><svg viewBox="0 0 24 24" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"/></svg> Clique para ouvir</div>' : ''}
                    <div class="vtitle">${escapeHtml(nome)}</div>
                    <div class="vdesc">${escapeHtml(descricao)}</div>
                    ${vhistBlock(categoria)}
                    <div class="vfoot">
                        <span class="vrar ${r.cls}">${r.label}</span>
                        <span class="vxp">+${r.xp} XP</span>
                    </div>
                `;
            } else {
                const progHtml = card.isSpecial
                    ? ''
                    : `<div class="vprog"><div class="vprog__fill" data-fill="${Math.max(0, Math.min(100, card.progress || 0))}"></div></div>`;
                element.innerHTML = `
                    <span class="vc-serial">#???</span>
                    ${corner}
                    ${discLockedSVG()}
                    ${musicBlock(null, true)}
                    <div class="vtitle">${escapeHtml(nome)}</div>
                    <div class="vdesc">${escapeHtml(descricao)}</div>
                    ${progHtml}
                    <div class="vfoot">
                        <span class="vrar ${r.cls}" style="opacity:.5">${r.label}</span>
                        <span class="vxp locked">+${r.xp} XP</span>
                    </div>
                `;
            }

            grid.appendChild(element);
            observer.observe(element);
        });

        // Anima as barras de progresso (discos bloqueados) de 0 -> valor atual
        requestAnimationFrame(() => requestAnimationFrame(() => {
            grid.querySelectorAll('.vprog__fill[data-fill]').forEach(f => {
                f.style.width = `${f.dataset.fill}%`;
            });
        }));
    }, 200); // aguarda fade-out dos skeletons
}

function renderLoadingState() {
    // Os skeletons já estão no HTML — não é preciso sobrescrever o grid.
    // Esta função fica vazia para compatibilidade com chamadas existentes.
}

function renderErrorState(msg) {
    const grid = document.getElementById('achievements-grid');
    if (!grid) return;
    grid.innerHTML = `
        <div class="cq-state">
            <div class="cq-state__title">Discoteca indisponível</div>
            <div class="cq-state__text">${escapeHtml(msg)}</div>
        </div>`;
}

function updateSummary(cards) {
    const unlockedCount = cards.filter(c => c.unlocked).length;
    const totalCount    = cards.length;
    const percent       = totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;
    const el = id => document.getElementById(id);
    if (el('achievements-unlocked')) el('achievements-unlocked').textContent = String(unlockedCount);
    if (el('achievements-total'))    el('achievements-total').textContent    = String(totalCount);
    if (el('achievements-percent'))  el('achievements-percent').textContent  = `${percent}%`;
}

function updateUserHeader(user) {
    const displayName  = getPublicDisplayName(user);
    const displayLevel = user?.level || 1;
    const displayXp    = Number(user?.xp || 0);
    const initials     = getInitials(displayName);

    const clearSkeleton = (el) => {
        if (!el) return;
        el.classList.remove('home-skeleton-text', 'home-skeleton-text--name',
            'home-skeleton-text--level', 'home-skeleton-text--xp');
    };

    [
        ['header-user-name',   displayName],
        ['mobile-user-name',   displayName],
        ['header-user-level',  `Nível ${displayLevel}`],
        ['mobile-user-level',  `Nível ${displayLevel}`],
        ['header-user-xp',     `${displayXp} XP`]
    ].forEach(([id, text]) => {
        const el = document.getElementById(id);
        if (el) { el.textContent = text; clearSkeleton(el); }
    });
    
    const headerAvatarContainer = document.getElementById('header-user-avatar');
    const mobileAvatarContainer = document.getElementById('mobile-user-avatar');
    
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
            
            // Fallback to initials if image fails to load
            img.onerror = () => {
                container.innerHTML = `<span class="user-avatar__initials">${initials}</span>`;
            };
            
            container.appendChild(img);
        } else {
            container.innerHTML = `<span class="user-avatar__initials">${initials}</span>`;
        }
        
        // Re-add avatar status indicator for header avatar
        if (!isLarge) {
            const statusIndicator = document.createElement('div');
            statusIndicator.className = 'avatar-status';
            container.appendChild(statusIndicator);
        }
    };
    
    updateAvatar(headerAvatarContainer, false);
    updateAvatar(mobileAvatarContainer, true);
}

function toggleMobileMenu() {
    const btn     = document.getElementById('mobile-menu-btn');
    const nav     = document.getElementById('mobile-nav');
    const overlay = document.getElementById('mobile-nav-overlay');
    const isOpen  = nav.classList.contains('open');
    btn.classList.toggle('active');
    nav.classList.toggle('open');
    overlay.classList.toggle('visible');
    document.body.style.overflow = isOpen ? '' : 'hidden';
}

function handleLogout() {
    document.body.style.opacity    = '0';
    document.body.style.transition = 'opacity 0.35s ease';
    setTimeout(() => {
        window.CxSession?.clearSessionState?.();
        window.location.replace('login.html');
    }, 350);
}

function initHeaderScrollEffect() {
    window.addEventListener('scroll', () => {
        const header = document.getElementById('header');
        if (!header) return;
        header.classList.toggle('scrolled', window.scrollY > 10);
    }, { passive: true });
}

document.addEventListener('DOMContentLoaded', async () => {
    const loggedInUser = getLoggedInUserKey();
    const loggedIn     = window.CxSession?.hasActiveSession?.() || localStorage.getItem('loggedIn') || sessionStorage.getItem('loggedIn');

    if (!loggedInUser || !loggedIn) {
        window.CxSession?.redirectToLogin?.() || window.location.replace('login.html');
        return;
    }

    const users  = getUsersData();
    const storage = getStorageType();
    let user   = users[loggedInUser] || {
        display_name: storage.getItem('cx_display_name') || 'Agente EC',
        ranking_code: storage.getItem('cx_ranking_code') || null,
        level: 1, xp: 0, completedChallenges: [], completedMinigames: [], failedChallenges: [], logumChallenges: []
    };

    const remoteProgress = await loadProtectedProgress().catch(() => null);
    const flowStatus = await loadProtectedFlowStatus().catch(() => null);
    user = mergeRemoteProgressIntoUser(user, remoteProgress, flowStatus);
    persistResolvedUser(loggedInUser, user);

    updateUserHeader(user);
    initHeaderScrollEffect();

    await initSyncIndicators();

    renderLoadingState();

    const rankingPosition = await loadRankingPosition(user).catch(() => null);
    const failedChallenges = deriveFailedChallenges(flowStatus, user.failedChallenges);
    const allLevelsPerformance = deriveAllLevelsPerformance(flowStatus);

    // Sempre parte do conjunto local conhecido e MESCLA o que vier do Firebase.
    // Assim a página nunca perde conquistas, mesmo se o Firestore negar/cair.
    let rawList = ACHIEVEMENTS_FALLBACK;
    try {
        const fbList = await loadAchievementsFromFirebase();
        rawList = mergeAchievements(ACHIEVEMENTS_FALLBACK, fbList);
        conquistasDebugLog(`[Conquistas] ✅ Firebase ${fbList.length} + fallback → ${rawList.length} conquistas`);
    } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        if (/permission/i.test(msg)) {
            console.warn('[Conquistas] ⚠️ Firestore negou a leitura de "achievements" (regras). Usando fallback local. Verifique firestore.rules.');
        } else {
            console.warn('[Conquistas] ⚠️ Firebase indisponível, usando fallback local:', msg);
        }
    }

    const cards = buildAchievements(rawList, remoteProgress || user, {
        failedChallenges,
        allLevelsPerformance,
        rankingPosition
    });
    renderAchievements(cards);
    updateSummary(cards);
});

async function initSyncIndicators() {
    const indicator = document.getElementById('sync-indicator');
    const iconEl = indicator?.querySelector('.sync-icon');
    const textEl = indicator?.querySelector('.sync-text');
    
    if (!indicator) {
        console.warn('[Conquistas] Sync indicator element not found');
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

    // Animação fake: syncing -> success -> idle (rápida)
    updateIcon('syncing');
    indicator.className = 'sync-indicator syncing';
    if (textEl) textEl.textContent = 'Sincronizando...';
    
    // Simular sucesso após 500ms (rápido)
    setTimeout(() => {
        indicator.className = 'sync-indicator success';
        updateIcon('success');
        if (textEl) textEl.textContent = 'Sincronizado';
        
        // Voltar ao idle após 1.2s
        setTimeout(() => {
            indicator.className = 'sync-indicator';
            updateIcon('idle');
            if (textEl) textEl.textContent = 'Pronto';
        }, 1200);
    }, 500);
}

window.toggleMobileMenu = toggleMobileMenu;
window.handleLogout     = handleLogout;

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
