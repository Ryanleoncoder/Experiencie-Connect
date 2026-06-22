/**
 * Challenge Validator Module
 *
 * Enforces sequential challenge completion by validating user access
 * before rendering challenge UI. Prevents URL manipulation and ensures
 * fair progression through the challenge sequence.
 *
 * @module ChallengeValidator
 */

(function (window) {
    'use strict';

    // Constants
    const CACHE_TTL = 300000; // 5 minutes
    const VALIDATION_CACHE_TTL = 180000; // 3 minutos — acesso ao desafio não muda durante a sessão
    const VALIDATION_TIMEOUT = 1000; // 1 second
    const MAX_RETRIES = 2;
    const RETRY_DELAY = 500; // milliseconds
    const locationSearchCache = {
        search: null,
        phaseSessionId: ''
    };

    /**
     * Logs a message with the ChallengeValidator prefix
     * @param {...any} args - Arguments to log
     */
    function log(level, ...args) {
        if (!['warn', 'error'].includes(level) && !isValidationDebugEnabled()) {
            return;
        }

        console[level]('[ChallengeValidator]', ...args);
    }

    function normalizeChallengeId(challengeId) {
        return window.ProgressFlow?.normalizeChallengeId?.(challengeId) || challengeId;
    }

    function buildValidationCacheKey(userId, challengeId, phaseSessionId = '') {
        return `val_result_${userId}_${normalizeChallengeId(challengeId)}_${phaseSessionId || 'legacy'}`;
    }

    function generateRequestId() {
        return `cxv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function isValidationDebugEnabled() {
        return sessionStorage.getItem('cx_debug_challenge_validation') === '1'
            || window.__CX_DEBUG_CHALLENGE__ === true;
    }

    /**
     * ValidationResult interface
     * @typedef {Object} ValidationResult
     * @property {boolean} isValid - Can user access this challenge?
     * @property {string|null} redirectTo - Challenge ID to redirect to (if invalid)
     * @property {string} reason - Human-readable reason
     * @property {Object} performance - Performance metrics
     * @property {number} performance.duration - Validation duration in ms
     * @property {boolean} performance.cached - Was data cached?
     */

    /**
     * Sleep utility for retry delays
     * @param {number} ms - Milliseconds to sleep
     * @returns {Promise<void>}
     */
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function getCxSessionToken() {
        return sessionStorage.getItem('cx_session_token') || localStorage.getItem('cx_session_token') || '';
    }

    function getPhaseSessionIdFromLocation() {
        try {
            const search = window.location.search || '';
            if (locationSearchCache.search === search) {
                return locationSearchCache.phaseSessionId;
            }

            locationSearchCache.search = search;
            locationSearchCache.phaseSessionId = new URLSearchParams(search).get('phase_session_id') || '';
            return locationSearchCache.phaseSessionId;
        } catch (error) {
            locationSearchCache.search = null;
            locationSearchCache.phaseSessionId = '';
            return '';
        }
    }

    function buildProtectedHeaders(extraHeaders = {}) {
        const token = getCxSessionToken();
        return token
            ? { ...extraHeaders, Authorization: `Bearer ${token}` }
            : { ...extraHeaders };
    }

    /**
     * Validates if user can access the requested challenge
     * @param {string} challengeId - Challenge ID (e.g., "txt-203")
     * @param {string} userId - User ID
     * @param {boolean} skipCache - Skip validation cache (default: false)
     * @returns {Promise<ValidationResult>}
     */
    async function validateChallengeAccess(challengeId, userId, skipCache = false, options = {}) {
        const startTime = Date.now();
        const requestId = generateRequestId();
        const baseId = normalizeChallengeId(challengeId);
        const phaseSessionId = options.phaseSessionId || getPhaseSessionIdFromLocation();

        try {
            if (!skipCache) {
                const cachedResult = getValidationResultCache(userId, challengeId, phaseSessionId);
                if (cachedResult) {
                    if (isValidationDebugEnabled()) {
                        log('log', 'Using cached validation result (TTL: 30s)', {
                            requestId,
                            challengeId,
                            baseId
                        });
                    }
                    cachedResult.requestId = requestId;
                    cachedResult.baseId = baseId;
                    cachedResult.performance.cached = true;
                    cachedResult.performance.duration = Date.now() - startTime;
                    return cachedResult;
                }
            }

            const level = extractLevelFromChallengeId(challengeId);
            const seasonId = await getActiveSeasonId();

            if (!getCxSessionToken() && !(window.CxSession?.hasActiveSession?.())) {
                log('warn', 'Sem sessao ativa, bloqueando acesso ao desafio');
                return {
                    isValid: false,
                    redirectTo: null,
                    reason: 'missing_session_token',
                    performance: {
                        duration: Date.now() - startTime,
                        cached: false
                    }
                };
            }

            const response = await fetch('/api/validate-challenge-access', {
                method: 'POST',
                headers: buildProtectedHeaders({
                    'Content-Type': 'application/json',
                    'X-CX-Request-ID': requestId
                }),
                body: JSON.stringify({
                    challengeId,
                    phaseSessionId,
                    level,
                    setor: 'CX',
                    seasonId
                })
            });

            if (!response.ok) {
                log('error', 'API validation failed:', response.status);
                return {
                    isValid: false,
                    redirectTo: null,
                    reason: `api_error_${response.status}`,
                    performance: {
                        duration: Date.now() - startTime,
                        cached: false
                    }
                };
            }

            const result = await response.json();
            result.performance = result.performance || {};
            result.performance.cached = false;
            result.performance.duration = Date.now() - startTime;
            result.requestId = requestId;
            result.baseId = baseId;

            if (!result.isValid && result.redirectTo === challengeId) {
                result.redirectTo = null;
                result.reason = 'server_denied_without_redirect';
            }

            if (result.isValid) {
                cacheValidationResult(userId, challengeId, result, phaseSessionId);
            }

            if (result.isValid || isValidationDebugEnabled()) {
                log('log', 'Validation completed:', {
                    requestId,
                    challengeId,
                    baseId,
                    isValid: result.isValid,
                    redirectTo: result.redirectTo,
                    reason: result.reason,
                    duration: result.performance.duration
                });
            }

            return result;

        } catch (error) {
            log('error', 'Validation error:', {
                requestId,
                challengeId,
                baseId,
                error: error.message
            });

            return {
                isValid: false,
                redirectTo: null,
                reason: 'validation_error',
                requestId,
                baseId,
                performance: {
                    duration: Date.now() - startTime,
                    cached: false
                },
                error: error.message
            };
        }
    }


    /**
     * Clears validation cache (for testing/debugging)
     */
    function clearValidationCache() {
        try {
            const keys = Object.keys(sessionStorage);
            keys.forEach(key => {
                if (key.startsWith('validation_') || key.startsWith('val_result_')) {
                    sessionStorage.removeItem(key);
                }
            });
            log('log', 'Validation cache cleared');
        } catch (error) {
            log('error', 'Error clearing cache:', error);
        }
    }

    /**
     * Get validation result from cache
     * @param {string} userId - User ID
     * @param {string} challengeId - Challenge ID
     * @returns {Object|null} Cached validation result or null
     */
    function getValidationResultCache(userId, challengeId, phaseSessionId = '') {
        try {
            const key = buildValidationCacheKey(userId, challengeId, phaseSessionId);
            const cached = sessionStorage.getItem(key);

            if (!cached) {
                return null;
            }

            const data = JSON.parse(cached);

            if (Date.now() - data.timestamp > VALIDATION_CACHE_TTL) {
                sessionStorage.removeItem(key);
                return null;
            }

            return data.result;
        } catch (error) {
            log('error', 'Error reading validation result cache:', error);
            return null;
        }
    }

    /**
     * Cache validation result
     * @param {string} userId - User ID
     * @param {string} challengeId - Challenge ID
     */
    function cacheValidationResult(userId, challengeId, result, phaseSessionId = '') {
        try {
            const key = buildValidationCacheKey(userId, challengeId, phaseSessionId);
            const data = {
                result,
                timestamp: Date.now()
            };
            sessionStorage.setItem(key, JSON.stringify(data));
        } catch (error) {
            log('error', 'Error caching validation result:', error);
        }
    }

    /**
     * Invalidate validation cache for a specific challenge
     * @param {string} userId - User ID
     * @param {string} challengeId - Challenge ID
     */
    function invalidateValidationCache(userId, challengeId) {
        try {
            const key = buildValidationCacheKey(userId, challengeId);
            sessionStorage.removeItem(key);
            log('log', 'Validation cache invalidated for:', normalizeChallengeId(challengeId));
        } catch (error) {
            log('error', 'Error invalidating cache:', error);
        }
    }

    /**
     * Extracts level number from challenge ID
     * @param {string} challengeId - Challenge ID (e.g., "txt-203")
     * @returns {number} Level number (1, 2, or 3)
     */
    function extractLevelFromChallengeId(challengeId) {
        if (!challengeId) return 1;
        return window.ProgressFlow?.inferLevelFromChallengeId?.(challengeId) || 1;
    }

    /**
     * Get active season ID from FirebaseLoader
     * @returns {Promise<string>} Season ID
     */
    async function getActiveSeasonId() {
        try {
            if (window.FirebaseLoader && window.FirebaseLoader.getActiveSeason) {
                const season = await window.FirebaseLoader.getActiveSeason();
                return season.id;
            }

            // Fallback: try to get from sessionStorage
            const cached = sessionStorage.getItem('season_active');
            if (cached) {
                const season = JSON.parse(cached);
                return season.id;
            }

            // Default fallback
            return 'S-2025-01';
        } catch (error) {
            log('error', 'Error getting season ID:', error);
            return 'S-2025-01';
        }
    }

    /**
     * Get challenge order from Randomizer
     * @param {string} userId - User ID
     * @param {string} setor - Sector
     * @param {string} seasonId - Season ID
     * @returns {Promise<Array<Object>>} Ordered array of challenges
     */
    async function getChallengeOrder(userId, level, setor, seasonId) {
        try {
            if (!window.ChallengeRandomizer) {
                log('error', 'ChallengeRandomizer not available');
                return [];
            }

            // Try to get cached selection first
            let challengeOrder = window.ChallengeRandomizer.getCachedSelection(
                userId,
                seasonId,
                level,
                setor
            );

            if (challengeOrder && Array.isArray(challengeOrder)) {
                log('log', 'Using cached challenge order:', challengeOrder.length, 'challenges');
                return challengeOrder;
            }

            if (window.FirebaseLoader) {
                const levelData = await window.FirebaseLoader.loadLevel(level, setor, seasonId);

                if (levelData && levelData.questions) {
                    const selection = window.ChallengeRandomizer.selectRandomQuestions(
                        levelData.questions,
                        userId,
                        seasonId,
                        level,
                        20
                    );

                    if (Array.isArray(selection)) {
                        log('log', 'Generated new challenge order:', selection.length, 'challenges');
                        return selection;
                    }

                    if (selection && selection.questions) {
                        log('log', 'Generated new challenge order:', selection.questions.length, 'challenges');
                        return selection.questions;
                    }
                }
            }

            return [];
        } catch (error) {
            log('error', 'Error getting challenge order:', error);
            return [];
        }
    }

    // Module exports
    const ChallengeValidator = {
        validateChallengeAccess,
        clearValidationCache,
        invalidateValidationCache
    };

    // Expose to window
    window.ChallengeValidator = ChallengeValidator;

    log('log', 'Module loaded');

})(window);
