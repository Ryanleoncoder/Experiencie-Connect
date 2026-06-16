const crypto = require('crypto');

function getClientIP(req) {
  return (
    req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
    req?.headers?.['x-real-ip'] ||
    req?.headers?.['cf-connecting-ip'] ||
    req?.connection?.remoteAddress ||
    req?.socket?.remoteAddress ||
    'unknown'
  );
}

function getHashSecret() {
  const secret = process.env.IP_HASH_SECRET;
  if (secret) return secret;

  const isNonProduction =
    process.env.NODE_ENV === 'test' ||
    process.env.NODE_ENV === 'development' ||
    process.env.VERCEL_ENV === 'preview' ||
    process.env.VERCEL_ENV === 'development' ||
    (!process.env.NODE_ENV && !process.env.VERCEL_ENV);

  if (isNonProduction) {
    return process.env.CXGAME_SESSION_SECRET || process.env.JWT_SECRET || 'cxgame-dev-ip-hash-secret';
  }

  throw new Error('IP_HASH_SECRET is not configured');
}

function hashSensitiveValue(value, purpose = 'generic') {
  const normalized = String(value || 'unknown').trim();
  return crypto
    .createHmac('sha256', getHashSecret())
    .update(`${purpose}:${normalized}`)
    .digest('hex');
}

function getClientIPHash(req) {
  return hashSensitiveValue(getClientIP(req), 'ip');
}

function getInviteTokenHash(token) {
  return hashSensitiveValue(token, 'invite-token');
}

function getSessionTokenHash(token) {
  return hashSensitiveValue(token, 'session-token');
}

module.exports = {
  getClientIP,
  getClientIPHash,
  getInviteTokenHash,
  getSessionTokenHash,
  hashSensitiveValue
};
