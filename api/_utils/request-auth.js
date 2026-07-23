const { verifySessionToken } = require('./session-token');
const { getSessionTokenHash } = require('./privacy');
const { getSessionCookie } = require('./cookies');
const { createClient } = require('@supabase/supabase-js');

function extractBearerToken(req) {
  const authHeader = req?.headers?.authorization || req?.headers?.Authorization || '';
  const match = String(authHeader).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function extractSessionToken(req) {
  return getSessionCookie(req) || extractBearerToken(req);
}

function createSupabaseClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function isSessionActive(claims) {
  if (!claims?.jti || !claims?.sub || !Number.isInteger(claims.sv)) return false;
  const supabase = createSupabaseClient();
  if (!supabase) return false;
  try {
    const { data: session, error: sessionError } = await supabase
      .from('auth_sessions')
      .select('id,user_id,auth_version,revoked_at,expires_at')
      .eq('id', claims.jti)
      .eq('user_id', claims.sub)
      .is('revoked_at', null)
      .maybeSingle();
    if (sessionError || !session || Number(session.auth_version) !== claims.sv || new Date(session.expires_at).getTime() <= Date.now()) {
      return false;
    }
    const { data: user, error: userError } = await supabase
      .from('usuarios')
      .select('id,banned,auth_version')
      .eq('id', claims.sub)
      .maybeSingle();
    return !userError && Boolean(user) && !user.banned && Number(user.auth_version) === claims.sv;
  } catch (error) {
    // The database is the revocation authority; failing open here is unsafe.
    return false;
  }
}

async function requireCxSession(req) {
  const token = extractSessionToken(req);

  if (!token) {
    return {
      ok: false,
      status: 401,
      error: 'missing_session_token',
      message: 'Sessao obrigatoria.'
    };
  }

  try {
    const claims = verifySessionToken(token);
    const exp = Number(claims.exp);
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (claims.typ !== 'cx_session' || !claims.sub || !Number.isFinite(exp) || exp <= nowSeconds) {
      return {
        ok: false,
        status: 401,
        error: 'invalid_session_token',
        message: 'Sessao invalida.'
      };
    }

    if (!(await isSessionActive(claims))) {
      return {
        ok: false,
        status: 401,
        error: 'invalid_session_token',
        message: 'Sessao invalida.'
      };
    }

    return {
      ok: true,
      token,
      tokenHash: getSessionTokenHash(token),
      user: {
        id: claims.sub,
        nickname: claims.nickname || null
      },
      claims
    };
  } catch (error) {
    return {
      ok: false,
      status: 401,
      error: 'invalid_session_token',
      message: 'Sessao invalida.'
    };
  }
}

function rejectConflictingUserId(bodyUserId, sessionUserId) {
  if (!bodyUserId) return null;
  if (String(bodyUserId) === String(sessionUserId)) return null;

  return {
    status: 403,
    payload: {
      error: 'user_mismatch',
      message: 'Usuario do payload nao corresponde a sessao.'
    }
  };
}

module.exports = {
  extractBearerToken,
  extractSessionToken,
  rejectConflictingUserId,
  requireCxSession,
  isSessionActive
};
