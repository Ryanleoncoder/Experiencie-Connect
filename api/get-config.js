function apiDebugLog(...args) {
  if (process.env.CXGAME_DEBUG_API === 'true') {
    console.debug(...args);
  }
}

/**
 * SECURITY: Only exposes SUPABASE_URL and the public Supabase key.
 * Never exposes SUPABASE_SERVICE_ROLE_KEY or other sensitive credentials.
 *
 * This endpoint solves the credential injection problem: client fetches config
 * from here instead of needing env vars baked into HTML or Vercel Root Directory
 * configuration changes.
 */

const { getSupabasePublicConfig } = require('./_utils/supabase-public-key');
const { validateCORS } = require('./_middleware/cors');

module.exports = function handler(req, res) {
  if (!validateCORS(req, res)) return;

  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    // SUPABASE_ANON_KEY/SUPABASE_KEY are kept as aliases for older frontend code.
    const config = getSupabasePublicConfig();

    if (process.env.NODE_ENV !== 'production') {
      apiDebugLog('[Config API] Returning configuration:', {
        SUPABASE_URL: config.SUPABASE_URL ? 'present' : 'missing',
        SUPABASE_PUBLISHABLE_KEY: config.SUPABASE_PUBLISHABLE_KEY ? 'present' : 'missing',
        CXGAME_VPS_API_BASE: config.CXGAME_VPS_API_BASE ? 'present' : 'missing'
      });
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=300');
    
    res.status(200).json(config);

  } catch (error) {
    console.error('[Config API] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
