const { validateCORS } = require('./_middleware/cors');
const { buildClearCookies } = require('./_utils/cookies');
const { extractSessionToken } = require('./_utils/request-auth');
const { verifySessionToken } = require('./_utils/session-token');
const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (!validateCORS(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }


  try {
    const token = extractSessionToken(req);
    const claims = token ? verifySessionToken(token) : null;
    if (claims?.jti && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
      await supabase
        .from('auth_sessions')
        .update({ revoked_at: new Date().toISOString(), revoked_reason: 'user_logout' })
        .eq('id', claims.jti)
        .eq('user_id', claims.sub)
        .is('revoked_at', null);
    }
  } catch (error) {

  }

  res.setHeader('Set-Cookie', buildClearCookies());
  return res.status(200).json({ success: true });
};
