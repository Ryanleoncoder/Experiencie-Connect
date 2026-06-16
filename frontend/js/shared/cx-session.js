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
    const primary = getPrimaryStorage();
    const fallback = getFallbackStorage();
    return primary?.getItem?.(key) || fallback?.getItem?.(key) || null;
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
    const session = getSessionSnapshot();
    return Boolean(session.token && session.userId && session.loggedIn);
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

  function clearSessionState() {
    clearStorageKeys(getPrimaryStorage());
    clearStorageKeys(getFallbackStorage());
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
      // Ignore cache failures.
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
    clearSessionState();
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

  function installProtectedFetchGuard() {
    if (fetchGuardInstalled || typeof root?.fetch !== 'function') {
      return;
    }

    const originalFetch = root.fetch.bind(root);
    root.fetch = async function guardedFetch(input, init) {
      const response = await originalFetch(input, init);
      if (shouldHandleProtectedFailure(input, init, response)) {
        root.setTimeout(() => redirectToLogin(), 0);
      }
      return response;
    };

    fetchGuardInstalled = true;
  }

  function buildProtectedHeaders(extraHeaders = {}) {
    const token = getSessionValue('cx_session_token');
    return token
      ? { ...extraHeaders, Authorization: `Bearer ${token}` }
      : { ...extraHeaders };
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
