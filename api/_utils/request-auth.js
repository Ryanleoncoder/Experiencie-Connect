const { verifySessionToken } = require('./session-token');
const { getSessionTokenHash } = require('./privacy');
const { getSessionCookie } = require('./cookies');

function extractBearerToken(req) {
  const authHeader = req?.headers?.authorization || req?.headers?.Authorization || '';
  const match = String(authHeader).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function extractSessionToken(req) {
  return extractBearerToken(req) || getSessionCookie(req);
}

function requireCxSession(req) {
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
  requireCxSession
};
