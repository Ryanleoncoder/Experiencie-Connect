/**
 * Idempotency Key Generator
 * 
 * Generates unique idempotency keys for request deduplication.
 * Format: {user_id}:{challenge_id}:{timestamp_ms}
 * 
 * Used to prevent duplicate attempt records when retrying after infrastructure errors.
 */

/**
 * Generate idempotency key for request deduplication
 * @param {string} userId - User ID (UUID)
 * @param {string} challengeId - Challenge ID
 * @returns {string} Idempotency key in format: {user_id}:{challenge_id}:{timestamp_ms}
 */
function generateIdempotencyKey(userId, challengeId) {
    if (!userId || !challengeId) {
        throw new Error('userId and challengeId are required for idempotency key generation');
    }

    const timestamp = Date.now();
    const key = `${userId}:${challengeId}:${timestamp}`;

    if (!validateIdempotencyKey(key)) {
        throw new Error('Generated idempotency key has invalid format');
    }

    return key;
}

/**
 * Validate idempotency key format
 * @param {string} key - Idempotency key to validate
 * @returns {boolean} True if valid format
 */
function validateIdempotencyKey(key) {
    if (!key || typeof key !== 'string') {
        return false;
    }

    // Format: {user_id}:{challenge_id}:{timestamp_ms}
    const parts = key.split(':');
    if (parts.length !== 3) {
        return false;
    }

    const [userId, challengeId, timestamp] = parts;

    // Validate userId (UUID format or non-empty string)
    if (!userId || userId.length === 0) {
        return false;
    }

    if (!challengeId || challengeId.length === 0) {
        return false;
    }

    const timestampNum = parseInt(timestamp, 10);
    if (isNaN(timestampNum) || timestampNum <= 0) {
        return false;
    }

    return true;
}

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.IdempotencyUtils = {
        generateIdempotencyKey,
        validateIdempotencyKey
    };
}
