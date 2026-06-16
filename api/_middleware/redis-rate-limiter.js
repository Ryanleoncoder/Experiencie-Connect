/**
 * Rate limiter — API-mediated VPS Redis client (sliding window).
 * Thin client to `/api/internal/ratelimit/check`; Redis port stays closed to the internet.
 * Fail-fast: if the internal API is unavailable the whole VPS is likely down — throw and let the caller deny.
 */

const { postInternal, isInternalApiConfigured } = require('../_utils/internal-api-client');

async function checkRateLimit(key, maxRequests, windowSeconds) {
  try {
    const data = await postInternal('/api/internal/ratelimit/check', {
      key,
      max_requests: maxRequests,
      window_seconds: windowSeconds
    });

    if (data && data.allowed) {
      return { allowed: true };
    }

    return {
      allowed: false,
      retryAfter: Math.max(1, Number(data && data.retry_after) || windowSeconds)
    };
  } catch (error) {
    console.error('[rate-limiter] Internal API error:', error);
    throw new Error('Rate limiting service unavailable');
  }
}

function isRedisAvailable() {
  return isInternalApiConfigured();
}

module.exports = {
  checkRateLimit,
  isRedisAvailable
};
