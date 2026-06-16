window.__APP_CONFIG_READY__ = (async function loadEnvironmentVariables() {
  if (!window.__APP_CONFIG__) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch('/api/get-config', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      window.__APP_CONFIG__ = await response.json();
    } catch (error) {
      console.error('[EnvLoader] Failed to load public config:', error.message);
      window.__APP_CONFIG__ = {
        SUPABASE_URL: null,
        SUPABASE_PUBLISHABLE_KEY: null,
        SUPABASE_ANON_KEY: null,
        FIREBASE_API_KEY: null,
        FIREBASE_AUTH_DOMAIN: null,
        FIREBASE_PROJECT_ID: null,
        FIREBASE_STORAGE_BUCKET: null,
        FIREBASE_MESSAGING_SENDER_ID: null,
        FIREBASE_APP_ID: null
      };
    }
  }

  const config = window.__APP_CONFIG__;
  const supabasePublicKey = config.SUPABASE_PUBLISHABLE_KEY || config.SUPABASE_ANON_KEY || config.SUPABASE_KEY;

  if (!config.SUPABASE_URL || !supabasePublicKey) {
    console.error('[EnvLoader] Public Supabase config is incomplete');
    return config;
  }

  window.SUPABASE_URL = config.SUPABASE_URL;
  window.SUPABASE_PUBLISHABLE_KEY = supabasePublicKey;
  window.SUPABASE_ANON_KEY = supabasePublicKey;
  window.SUPABASE_KEY = supabasePublicKey;
  window.CXGAME_VPS_API_BASE = config.CXGAME_VPS_API_BASE || 'https://api.expconnect.com.br';

  return config;
})();

window.__ENV_READY__ = window.__APP_CONFIG_READY__;
