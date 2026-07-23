const SESSION_COOKIE = 'cx_session';
const AUTH_FLAG_COOKIE = 'cx_auth';
const DEFAULT_MAX_AGE_SECONDS = 4 * 24 * 60 * 60; // event maximum

function isProduction() {
  return process.env.VERCEL_ENV === 'production' || process.env.ENVIRONMENT === 'production';
}

function serializeCookie(name, value, { maxAgeSeconds, httpOnly = false } = {}) {
  const parts = [`${name}=${value}`, 'Path=/', 'SameSite=Lax'];
  if (httpOnly) parts.push('HttpOnly');
  if (isProduction()) parts.push('Secure');

  const domain = process.env.CXGAME_COOKIE_DOMAIN;
  if (domain) parts.push(`Domain=${domain}`);

  if (Number.isFinite(maxAgeSeconds)) parts.push(`Max-Age=${maxAgeSeconds}`);
  return parts.join('; ');
}

function buildSessionCookies(token, { maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS } = {}) {
  return [
    serializeCookie(SESSION_COOKIE, token, { maxAgeSeconds, httpOnly: true }),
    serializeCookie(AUTH_FLAG_COOKIE, '1', { maxAgeSeconds, httpOnly: false })
  ];
}

function buildClearCookies() {
  return [
    serializeCookie(SESSION_COOKIE, '', { maxAgeSeconds: 0, httpOnly: true }),
    serializeCookie(AUTH_FLAG_COOKIE, '', { maxAgeSeconds: 0, httpOnly: false })
  ];
}

function parseCookies(req) {
  const header = req?.headers?.cookie || '';
  const out = {};
  String(header).split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(value);
      } catch (error) {
        out[key] = value;
      }
    }
  });
  return out;
}

function getSessionCookie(req) {
  return parseCookies(req)[SESSION_COOKIE] || null;
}

module.exports = {
  SESSION_COOKIE,
  AUTH_FLAG_COOKIE,
  DEFAULT_MAX_AGE_SECONDS,
  buildSessionCookies,
  buildClearCookies,
  parseCookies,
  getSessionCookie
};
