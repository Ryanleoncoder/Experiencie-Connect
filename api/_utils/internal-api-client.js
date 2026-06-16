/**
 * Authenticated client for VPS internal endpoints (rate limiting, login attempts).
 * Serverless → authenticated API → local Redis, so Redis port stays closed to the internet.
 * Auth: shared secret in `X-Internal-Secret` header (INTERNAL_API_SECRET env var).
 */

const DEFAULT_VPS_API_BASE = 'https://api.expconnect.com.br';
const DEFAULT_TIMEOUT_MS = 3000;

function getBase() {
  return String(process.env.CXGAME_VPS_API_BASE || DEFAULT_VPS_API_BASE).replace(/\/+$/, '');
}

function getSecret() {
  return process.env.INTERNAL_API_SECRET || '';
}

function isInternalApiConfigured() {
  return Boolean(getSecret());
}

async function postInternal(path, body, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch } = {}) {
  const secret = getSecret();
  if (!secret) {
    throw new Error('INTERNAL_API_SECRET not configured');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${getBase()}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret
      },
      body: JSON.stringify(body || {}),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Internal API ${path} failed: HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  postInternal,
  isInternalApiConfigured
};
