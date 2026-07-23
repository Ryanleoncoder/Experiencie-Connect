const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');

function getSessionSecret() {
  const secret =
    process.env.CXGAME_SESSION_SECRET ||
    process.env.JWT_SECRET ||
    process.env.SUPABASE_JWT_SECRET;

  if (!secret) {
    throw new Error('CXGAME session secret is not configured');
  }

  return secret;
}

function createSessionToken(user, options = {}) {
  if (!user || !user.id) {
    throw new Error('User id is required to create a session token');
  }

  return jwt.sign(
    {
      sub: user.id,
      nickname: user.nickname || null,
      typ: 'cx_session',
      jti: options.sessionId || randomUUID(),
      sv: Number.isInteger(options.authVersion) ? options.authVersion : 1
    },
    getSessionSecret(),
    {
      algorithm: 'HS256',
      expiresIn: options.expiresIn || '4d',
      issuer: 'cx-game',
      audience: 'cxgame-vps'
    }
  );
}

function verifySessionToken(token) {
  return jwt.verify(token, getSessionSecret(), {
    algorithms: ['HS256'],
    issuer: 'cx-game',
    audience: 'cxgame-vps'
  });
}

module.exports = {
  createSessionToken,
  verifySessionToken
};
