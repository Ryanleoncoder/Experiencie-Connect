(function initCxSession(root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.CxSession = api;
  }
})(typeof window !== 'undefined' ? window : globalThis, function buildCxSession(root) {
  const STATUS_CACHE_KEY = 'cx_platform_status';
  const STATUS_CACHE_TTL = 5 * 60 * 1000;
  const SESSION_STORAGE_KEYS = [
    'cx_session_token',
    'cx_logged_in_user',
    'cx_logged_in_user_email',
    'cx_ranking_code',
    'cx_display_name',
    'cx_users',
    'loggedIn',
    STATUS_CACHE_KEY
  ];
  const SCOPED_PREFIXES = [
    'intermission_manifest_',
    'intermission_manifest_id_',
    'validation_',
    'val_result_'
  ];
  const PROTECTED_PATH_PATTERNS = [
    /\/api\/progress(?:\?|$)/,
    /\/api\/user-flow-status(?:\?|$)/,
    /\/api\/validate-challenge-access(?:\?|$)/,
    /\/api\/validate-answer(?:\?|$)/,
    /\/api\/intermission\/sessions\/[^/]+(?:\/(?:guess|hint|complete))?(?:\?|$)/,
    /\/api\/intermission\/manifest(?:\?|$)/
  ];

  let fetchGuardInstalled = false;
  let authFailureRedirecting = false;

  function safeStorage(storageName) {
    try {
      return root?.[storageName] || null;
    } catch (error) {
      return null;
    }
  }

  function getPrimaryStorage() {
    return safeStorage('sessionStorage');
  }

  function getFallbackStorage() {
    return safeStorage('localStorage');
  }

  function getSessionValue(key) {

    if (key === 'cx_session_token') return null;
    const primary = getPrimaryStorage();
    const fallback = getFallbackStorage();
    return primary?.getItem?.(key) || fallback?.getItem?.(key) || null;
  }

  function getCookie(name) {
    if (typeof root?.document?.cookie !== 'string') return null;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = root.document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function hasAuthCookie() {
    return getCookie('cx_auth') === '1';
  }

  function getVpsApiHost() {
    try {
      const base = root?.CXGAME_VPS_API_BASE || root?.__APP_CONFIG__?.CXGAME_VPS_API_BASE;
      return base ? new URL(base).host : null;
    } catch (error) {
      return null;
    }
  }

  function getSessionSnapshot() {
    return {
      token: getSessionValue('cx_session_token'),
      userId: getSessionValue('cx_logged_in_user'),
      loggedIn: getSessionValue('loggedIn') === 'true',
      displayName: getSessionValue('cx_display_name'),
      rankingCode: getSessionValue('cx_ranking_code')
    };
  }

  function hasActiveSession() {
    return hasAuthCookie();
  }

  function prunePrefixedEntries(storage) {
    if (!storage || typeof storage.length !== 'number' || typeof storage.key !== 'function') {
      return;
    }

    const keys = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key && SCOPED_PREFIXES.some(prefix => key.startsWith(prefix))) {
        keys.push(key);
      }
    }

    keys.forEach(key => storage.removeItem(key));
  }

  function clearStorageKeys(storage) {
    if (!storage) return;
    SESSION_STORAGE_KEYS.forEach(key => storage.removeItem(key));
    prunePrefixedEntries(storage);
  }

  function clearServerSession() {
   
    try {
      if (typeof root?.fetch === 'function') {
        root.fetch('/api/logout', { method: 'POST', credentials: 'include', keepalive: true })
          .catch(() => {});
      }
    } catch (error) {

    }
  }

  function clearSessionState() {
    clearServerSession();
    clearStorageKeys(getPrimaryStorage());
    clearStorageKeys(getFallbackStorage());
  }


  let hydrationPromise = null;
  function ensureSessionHydrated() {
    if (getSessionValue('cx_logged_in_user')) return Promise.resolve(true);
    if (!hasAuthCookie() || typeof root?.fetch !== 'function') return Promise.resolve(false);
    if (hydrationPromise) return hydrationPromise;

    hydrationPromise = (async () => {
      try {
        const response = await root.fetch('/api/progress', { credentials: 'include' });
        if (!response.ok) {
          
          if (response.status === 401 || response.status === 403) {
            try { await root.fetch('/api/logout', { method: 'POST', credentials: 'include' }); } catch (error) {}
          }
          return false;
        }
        const data = await response.json();
        if (!data || !data.user_id) return false;

        const storage = getPrimaryStorage() || getFallbackStorage();
        if (storage) {
          storage.setItem('cx_logged_in_user', data.user_id);
          storage.setItem('loggedIn', 'true');
          if (data.nickname) storage.setItem('cx_logged_in_user_email', data.nickname);
          if (data.display_name) storage.setItem('cx_display_name', data.display_name);
          if (data.ranking_code) storage.setItem('cx_ranking_code', data.ranking_code);
          let users = {};
          try { users = JSON.parse(storage.getItem('cx_users') || '{}'); } catch (error) { users = {}; }
          users[data.user_id] = {
            ...(users[data.user_id] || {}),
            id: data.user_id,
            nickname: data.nickname || null,
            display_name: data.display_name || null,
            ranking_code: data.ranking_code || null,
            avatar_file_name: data.avatar_file_name || null,
            completedChallenges: data.completed_challenges || [],
            completedMinigames: data.completed_minigames || []
          };
          storage.setItem('cx_users', JSON.stringify(users));
        }
        return true;
      } catch (error) {
        return false;
      } finally {
        hydrationPromise = null;
      }
    })();
    return hydrationPromise;
  }

  function hideDocument() {
    if (!root?.document?.documentElement) return;
    root.document.documentElement.style.visibility = 'hidden';
    root.document.documentElement.setAttribute('data-cx-guard', 'pending');
  }

  function showDocument() {
    if (!root?.document?.documentElement) return;
    root.document.documentElement.style.visibility = '';
    root.document.documentElement.removeAttribute('data-cx-guard');
  }

  function getStatusScreenUrl(status) {
    const redirects = {
      maintenance: '/maintenance.html',
      platform_disabled: '/maintenance.html',
      season_closed: '/season-closed.html',
      outside_window: '/outside-window.html'
    };

    const baseUrl = redirects[status?.reason] || '/maintenance.html';
    const url = new URL(baseUrl, root.location.origin);
    if (status?.reason) url.searchParams.set('reason', status.reason);
    if (status?.message) url.searchParams.set('message', encodeURIComponent(status.message));
    if (status?.next_open_time) url.searchParams.set('next_open', status.next_open_time);
    return url.toString();
  }

  function getCachedStatus() {
    const storage = getPrimaryStorage();
    if (!storage) return null;

    try {
      const cached = storage.getItem(STATUS_CACHE_KEY);
      if (!cached) return null;
      const parsed = JSON.parse(cached);
      if (!parsed?.timestamp || !parsed?.data) {
        storage.removeItem(STATUS_CACHE_KEY);
        return null;
      }
      if (Date.now() - parsed.timestamp > STATUS_CACHE_TTL) {
        storage.removeItem(STATUS_CACHE_KEY);
        return null;
      }
      return parsed.data;
    } catch (error) {
      storage.removeItem(STATUS_CACHE_KEY);
      return null;
    }
  }

  function cacheStatus(status) {
    const storage = getPrimaryStorage();
    if (!storage) return;

    try {
      storage.setItem(STATUS_CACHE_KEY, JSON.stringify({
        data: status,
        timestamp: Date.now()
      }));
    } catch (error) {
     
    }
  }

  async function checkPlatformStatus(options = {}) {
    const { forceRefresh = false, timeoutMs = 2000 } = options;
    if (!forceRefresh) {
      const cached = getCachedStatus();
      if (cached) {
        return cached;
      }
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? root.setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const response = await root.fetch('/api/platform-status', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller?.signal
      });

      if (timeoutId) {
        root.clearTimeout(timeoutId);
      }

      if (!response.ok) {
        return { allowed: true, error: `status_${response.status}` };
      }

      const status = await response.json();
      cacheStatus(status);
      return status;
    } catch (error) {
      if (timeoutId) {
        root.clearTimeout(timeoutId);
      }
      return { allowed: true, error: error?.name || 'status_fetch_failed' };
    }
  }

  function redirect(target) {
    if (!root?.location) return;
    root.location.replace(target);
  }

  function redirectToLogin() {
    if (authFailureRedirecting) return;
    authFailureRedirecting = true;
    clearStorageKeys(getPrimaryStorage());
    clearStorageKeys(getFallbackStorage());
    redirect('login.html');
  }

  function normalizeHeaders(headersLike) {
    const normalized = new Map();
    if (!headersLike) return normalized;

    if (typeof Headers !== 'undefined' && headersLike instanceof Headers) {
      headersLike.forEach((value, key) => normalized.set(String(key).toLowerCase(), value));
      return normalized;
    }

    if (Array.isArray(headersLike)) {
      headersLike.forEach(([key, value]) => normalized.set(String(key).toLowerCase(), value));
      return normalized;
    }

    Object.entries(headersLike).forEach(([key, value]) => {
      normalized.set(String(key).toLowerCase(), value);
    });
    return normalized;
  }

  function getRequestUrl(input) {
    try {
      if (typeof input === 'string') {
        return new URL(input, root.location.origin);
      }
      if (typeof Request !== 'undefined' && input instanceof Request) {
        return new URL(input.url, root.location.origin);
      }
      if (input?.url) {
        return new URL(input.url, root.location.origin);
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  function shouldHandleProtectedFailure(input, init, response) {
    if (![401, 403].includes(response?.status)) {
      return false;
    }

    const headers = normalizeHeaders(
      init?.headers
      || (typeof Request !== 'undefined' && input instanceof Request ? input.headers : null)
      || input?.headers
    );
    const authHeader = headers.get('authorization');
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
      return true;
    }

    const url = getRequestUrl(input);
    const path = url?.pathname || '';
    return PROTECTED_PATH_PATTERNS.some(pattern => pattern.test(path));
  }

  function shouldSendCredentials(input) {
    const url = getRequestUrl(input);
    if (!url) return false;
    const vpsHost = getVpsApiHost();
    if (vpsHost && url.host === vpsHost) return true;
    return PROTECTED_PATH_PATTERNS.some(pattern => pattern.test(url.pathname));
  }

  function installProtectedFetchGuard() {
    if (fetchGuardInstalled || typeof root?.fetch !== 'function') {
      return;
    }

    const originalFetch = root.fetch.bind(root);
    root.fetch = async function guardedFetch(input, init) {
      let nextInit = init;
      // Garante que o cookie de sessao viaje nas chamadas protegidas/VPS
      // (cross-origin precisa de credentials: 'include').
      if ((typeof input === 'string' || init) && shouldSendCredentials(input)) {
        nextInit = { ...(init || {}) };
        if (!nextInit.credentials) {
          nextInit.credentials = 'include';
        }
      }

      const response = await originalFetch(input, nextInit);
      if (shouldHandleProtectedFailure(input, nextInit, response)) {
        root.setTimeout(() => redirectToLogin(), 0);
      }
      return response;
    };

    fetchGuardInstalled = true;
  }

  function buildProtectedHeaders(extraHeaders = {}) {
    return { ...extraHeaders };
  }

  async function bootstrapPage(options = {}) {
    const {
      mode = 'protected',
      hide = true,
      reveal = true,
      redirectAuthenticatedTo = '/app',
      redirectUnauthenticatedTo = 'login.html',
      enforcePlatformStatus = true
    } = options;

    installProtectedFetchGuard();

    if (hide) {
      hideDocument();
    }

    if (mode === 'protected' && !hasActiveSession()) {
      redirect(redirectUnauthenticatedTo);
      return false;
    }

    // So tem o cookie (aba nova): hidrata a identidade local antes de seguir.
    if (mode === 'protected' && !getSessionValue('cx_logged_in_user')) {
      const hydrated = await ensureSessionHydrated();
      if (!hydrated) {
        redirect(redirectUnauthenticatedTo);
        return false;
      }
    }

    if (enforcePlatformStatus) {
      const status = await checkPlatformStatus();
      if (!status.allowed) {
        redirect(getStatusScreenUrl(status));
        return false;
      }
    }

    if (mode === 'public' && hasActiveSession()) {
      redirect(redirectAuthenticatedTo);
      return false;
    }

    if (reveal) {
      showDocument();
    }

    if (mode === 'protected') {
      root.addEventListener('pageshow', (event) => {
        if (event.persisted && !hasActiveSession()) {
          hideDocument();
          redirect(redirectUnauthenticatedTo);
        }
      });
    }

    return true;
  }

  // Polling para pré-popular avatar e evitar flash — para ao preencher os dois slots
  (function startAvatarObserver() {
    if (typeof document === 'undefined') return;

    function tryPopulate() {
      const deskContainer = document.getElementById('header-user-avatar');
      const mobContainer = document.getElementById('mobile-user-avatar');

      if (deskContainer || mobContainer) {
        try {
          const storage = sessionStorage.getItem('cx_logged_in_user') ? sessionStorage : localStorage;
          const loggedInUser = storage.getItem('cx_logged_in_user');
          if (loggedInUser) {
            const users = JSON.parse(storage.getItem('cx_users') || '{}');
            const user = users[loggedInUser];
            if (user && user.avatar_file_name) {
              const avatarPath = '/frontend/assets/image/avatar/' + user.avatar_file_name;

              if (deskContainer && !deskContainer.querySelector('.user-avatar__img')) {
                const img = document.createElement('img');
                img.src = avatarPath;
                img.alt = user.display_name || 'Avatar';
                img.className = 'user-avatar__img';
                img.draggable = false;
                deskContainer.insertBefore(img, deskContainer.firstChild);
                const initials = deskContainer.querySelector('.user-avatar__initials');
                if (initials) initials.style.display = 'none';
              }

              if (mobContainer && !mobContainer.querySelector('.user-avatar__img')) {
                const img = document.createElement('img');
                img.src = avatarPath;
                img.alt = user.display_name || 'Avatar';
                img.className = 'user-avatar__img';
                img.draggable = false;
                mobContainer.insertBefore(img, mobContainer.firstChild);
                const initials = mobContainer.querySelector('.user-avatar__initials');
                if (initials) initials.style.display = 'none';
              }
            }
          }
        } catch (e) {
          // Ignore errors
        }
      }

      const dPop = deskContainer && deskContainer.querySelector('.user-avatar__img');
      const mPop = mobContainer && mobContainer.querySelector('.user-avatar__img');
      return (!deskContainer || dPop) && (!mobContainer || mPop);
    }

    const poll = setInterval(() => {
      if (tryPopulate()) clearInterval(poll);
    }, 50);
    setTimeout(() => clearInterval(poll), 5000);
  })();

  return {
    bootstrapPage,
    buildProtectedHeaders,
    checkPlatformStatus,
    clearSessionState,
    ensureSessionHydrated,
    getPrimaryStorage,
    getSessionSnapshot,
    getSessionValue,
    getStatusScreenUrl,
    hasActiveSession,
    hideDocument,
    installProtectedFetchGuard,
    redirectToLogin,
    showDocument
  };
});
