
class StatusCheckService {
  constructor() {
    this.CACHE_KEY = 'cx_platform_status';
    this.CACHE_TTL = 5 * 60 * 1000;
    this.API_TIMEOUT = 2000;
  }

  async checkAndRedirect(options = {}) {
    if (this.isStatusPage()) {
      return true;
    }

    try {
      const status = await this.checkPlatformStatus(options);
      
      if (!status.allowed) {
        this.redirectToStatusScreen(status);
        return false;
      }
      
      return true;
      
    } catch (error) {
      console.error('[Status Check] Error checking status:', error);
      return true;
    }
  }

  async checkPlatformStatus(options = {}) {
    const { forceRefresh = false } = options;

    if (!forceRefresh) {
      const cached = this.getCachedStatus();
      if (cached) {
        return cached;
      }
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.API_TIMEOUT);

    try {
      const response = await fetch('/api/platform-status', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn('[Status Check] API returned error:', response.status);
        return { allowed: true, error: 'API error, allowing access' };
      }

      const status = await response.json();
      
      this.cacheStatus(status);
      
      return status;
      
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        console.warn('[Status Check] API timeout, allowing access (fail-open)');
      } else {
        console.error('[Status Check] API error:', error);
      }
      
      return { allowed: true, error: 'API failed, allowing access' };
    }
  }

  redirectToStatusScreen(status) {
    const redirectUrl = status.redirect || this.getDefaultRedirect(status.reason);
    
    const url = new URL(redirectUrl, window.location.origin);
    
    if (status.reason) {
      url.searchParams.set('reason', status.reason);
    }
    
    if (status.message) {
      url.searchParams.set('message', encodeURIComponent(status.message));
    }
    
    if (status.next_open_time) {
      url.searchParams.set('next_open', status.next_open_time);
    }
    
    window.location.href = url.toString();
  }

  getDefaultRedirect(reason) {
    const redirects = {
      'maintenance': '/maintenance.html',
      'platform_disabled': '/maintenance.html',
      'season_closed': '/season-closed.html',
      'outside_window': '/outside-window.html'
    };
    
    return redirects[reason] || '/maintenance.html';
  }

  isStatusPage() {
    const statusPages = [
      '/outside-window.html',
      '/season-closed.html',
      '/maintenance.html',
      '/status/outside-window.html',
      '/status/season-closed.html',
      '/status/maintenance.html'
    ];
    
    return statusPages.some(page => window.location.pathname.endsWith(page));
  }

  getCachedStatus() {
    try {
      const cached = sessionStorage.getItem(this.CACHE_KEY);
      if (!cached) return null;
      
      const { data, timestamp } = JSON.parse(cached);
      const now = Date.now();
      
      if (now - timestamp > this.CACHE_TTL) {
        // Cache expired
        sessionStorage.removeItem(this.CACHE_KEY);
        return null;
      }
      
      return data;
      
    } catch (error) {
      console.error('[Status Check] Error reading cache:', error);
      return null;
    }
  }

    cacheStatus(status) {
    try {
      const cacheData = {
        data: status,
        timestamp: Date.now()
      };
      
      sessionStorage.setItem(this.CACHE_KEY, JSON.stringify(cacheData));
      
    } catch (error) {
      console.error('[Status Check] Error caching status:', error);
    }
  }

    clearCache() {
    sessionStorage.removeItem(this.CACHE_KEY);
  }
}

// Export singleton instance
const statusCheckService = new StatusCheckService();
export default statusCheckService;

// Also expose globally for non-module scripts
if (typeof window !== 'undefined') {
  window.StatusCheckService = statusCheckService;
}
