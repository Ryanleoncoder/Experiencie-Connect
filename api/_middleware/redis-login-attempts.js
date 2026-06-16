/**
 * Login attempts tracker — API-mediated VPS Redis client.
 * Thin client to `/api/internal/login-attempts/*`; Redis port stays closed to the internet.
 * Fail-fast for check/increment (deny on outage); clear is non-critical.
 */

const { postInternal, isInternalApiConfigured } = require('../_utils/internal-api-client');

async function checkLoginAttempts(identifier) {
  try {
    const data = await postInternal('/api/internal/login-attempts/check', { identifier });

    if (data && data.blocked) {
      return { blocked: true, retryAfter: Number(data.retry_after) || undefined };
    }
    return { blocked: false };
  } catch (error) {
    console.error('[login-attempts] Internal API error (check):', error);
    throw new Error('Login attempts service unavailable');
  }
}

async function incrementLoginAttempts(identifier) {
  try {
    const data = await postInternal('/api/internal/login-attempts/increment', { identifier });

    if (data && data.blocked) {
      return { blocked: true, attemptsLeft: 0 };
    }
    return { blocked: false, attemptsLeft: Number(data && data.attempts_left) };
  } catch (error) {
    console.error('[login-attempts] Internal API error (increment):', error);
    throw new Error('Login attempts service unavailable');
  }
}

// Non-critical: never throws.
async function clearLoginAttempts(identifier) {
  try {
    await postInternal('/api/internal/login-attempts/clear', { identifier });
  } catch (error) {
    console.warn('[login-attempts] Could not clear attempts (non-critical):', error);
  }
}

function isRedisAvailable() {
  return isInternalApiConfigured();
}

module.exports = {
  checkLoginAttempts,
  incrementLoginAttempts,
  clearLoginAttempts,
  isRedisAvailable
};
