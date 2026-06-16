function apiDebugLog(...args) {
  if (process.env.CXGAME_DEBUG_API === 'true') {
    console.debug(...args);
  }
}

const { createClient } = require('@supabase/supabase-js');
const ProgressFlow = require('../frontend/js/services/ProgressFlow');
const { requireCxSession, rejectConflictingUserId } = require('./_utils/request-auth');
const { validateChallengeAccessForUser } = require('./_utils/challenge-flow');
const { getPhaseSessionFromVps } = require('./_utils/phase-session-client');

function createSupabaseClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      global: {
        fetch: (url, options = {}) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);

          return fetch(url, {
            ...options,
            signal: controller.signal
          }).finally(() => clearTimeout(timeoutId));
        }
      }
    }
  );
}

async function cleanupInvalidChallenges(userId, invalidChallengeId, validChallengeIds, supabase, options = {}) {
  const startTime = Date.now();
  const confirmCleanup = options.confirmCleanup === true;
  const dryRun = options.dryRun !== false || !confirmCleanup;
  const hasSufficientValidList = Array.isArray(validChallengeIds) && validChallengeIds.length >= 20;

  try {
    const validSet = new Set(validChallengeIds);

    const { data: attempts, error: queryError } = await supabase
      .from('challenge_attempts')
      .select('id, challenge_id')
      .eq('user_id', userId);

    if (queryError) {
      throw queryError;
    }

    const invalidAttempts = [];
    const invalidIds = new Set();

    (attempts || []).forEach(attempt => {
      const challengeId = attempt.challenge_id;
      const isIntermissionSlot = typeof challengeId === 'string' && challengeId.startsWith('ig-');
      if (!isIntermissionSlot && !validSet.has(challengeId)) {
        invalidAttempts.push(attempt.id);
        invalidIds.add(challengeId);
      }
    });

    const safeToMutate = !dryRun && confirmCleanup && hasSufficientValidList;
    let deletedCount = 0;

    if (invalidAttempts.length > 0 && safeToMutate) {
      const { error: deleteError, count } = await supabase
        .from('challenge_attempts')
        .delete({ count: 'exact' })
        .in('id', invalidAttempts);

      if (deleteError) {
        throw deleteError;
      }

      deletedCount = count || invalidAttempts.length;
    }

    return {
      success: true,
      dryRun: !safeToMutate,
      requiresConfirmation: !safeToMutate && invalidAttempts.length > 0,
      cleaned: {
        invalidChallengeId,
        totalInvalidIds: invalidIds.size,
        invalidIds: Array.from(invalidIds),
        wouldDeleteAttempts: invalidAttempts.length,
        deletedAttempts: deletedCount
      },
      performance: {
        duration: Date.now() - startTime
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      performance: {
        duration: Date.now() - startTime
      }
    };
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const auth = requireCxSession(req);
  if (!auth.ok) {
    return res.status(auth.status).json({
      error: auth.error,
      message: auth.message
    });
  }

  const supabase = createSupabaseClient();
  const body = req.body || {};
  const conflict = rejectConflictingUserId(body.userId, auth.user.id);
  if (conflict) {
    return res.status(conflict.status).json(conflict.payload);
  }

  const action = (req.query?.action || '').trim();
  if (action === 'cleanup') {
    const {
      invalidChallengeId,
      validChallengeIds,
      dryRun = true,
      confirmCleanup = false
    } = body;

    if (!invalidChallengeId || !Array.isArray(validChallengeIds)) {
      return res.status(400).json({
        error: 'missing_required_fields',
        required: ['invalidChallengeId', 'validChallengeIds']
      });
    }

    if (validChallengeIds.length > 500) {
      return res.status(400).json({ error: 'validChallengeIds_too_large' });
    }

    const result = await cleanupInvalidChallenges(
      auth.user.id,
      invalidChallengeId,
      validChallengeIds,
      supabase,
      { dryRun, confirmCleanup }
    );

    return res.status(result.success ? 200 : 500).json(result);
  }

  const startTime = Date.now();
  const requestId = req.headers['x-cx-request-id'] || req.headers['X-CX-Request-ID'] || null;
  const {
    challengeId,
    phaseSessionId,
    level,
    setor = 'CX',
    seasonId = 'S-2025-01'
  } = body;

  const requirePhaseSession = process.env.CXGAME_REQUIRE_PHASE_SESSION === 'true';
  if (!challengeId || !level || (requirePhaseSession && !phaseSessionId)) {
    return res.status(400).json({
      error: 'missing_required_fields',
      required: requirePhaseSession
        ? ['challengeId', 'phaseSessionId', 'level']
        : ['challengeId', 'level']
    });
  }

  try {
    let phaseSession = null;
    if (phaseSessionId) {
      try {
        phaseSession = await getPhaseSessionFromVps({
          phaseSessionId,
          sessionToken: auth.token
        });
      } catch (phaseError) {
        // Phase session expirada/invalidada (ex.: TTL vencido ou cache da VPS
        // limpo) NAO deve derrubar a validacao. Ignora e cai no fallback de
        // ordem do Firebase, em vez de retornar 503.
        console.warn('[validate-challenge-access] phase session indisponivel, usando fallback:', {
          requestId,
          phaseSessionId,
          message: phaseError.message
        });
        phaseSession = null;
      }

      if (phaseSession?.user_id && phaseSession.user_id !== auth.user.id) {
        return res.status(403).json({
          error: 'phase_session_mismatch',
          message: 'Sessao de fase nao pertence ao usuario.'
        });
      }
    }

    const result = await validateChallengeAccessForUser({
      supabase,
      userId: auth.user.id,
      challengeId,
      level,
      setor,
      seasonId,
      phaseSession
    });

    apiDebugLog('[validate-challenge-access] result:', {
      requestId,
      userId: auth.user.id,
      challengeId,
      phaseSessionId: phaseSessionId || null,
      baseId: ProgressFlow.normalizeChallengeId?.(challengeId) || challengeId,
      redirectTo: result.redirectTo,
      redirectBaseId: ProgressFlow.normalizeChallengeId?.(result.redirectTo) || result.redirectTo || null,
      reason: result.reason,
      duration: Date.now() - startTime
    });

    return res.status(200).json({
      isValid: result.isValid,
      redirectTo: result.redirectTo,
      reason: result.reason,
      phaseSessionId: phaseSessionId || null,
      performance: {
        duration: Date.now() - startTime,
        cached: false
      }
    });
  } catch (error) {
    console.error('[validate-challenge-access] validation failed:', {
      requestId,
      userId: auth.user.id,
      message: error.message,
      challengeId,
      baseId: ProgressFlow.normalizeChallengeId?.(challengeId) || challengeId,
      level
    });

    return res.status(503).json({
      isValid: false,
      redirectTo: null,
      reason: 'validation_service_unavailable',
      retryable: true,
      performance: {
        duration: Date.now() - startTime,
        cached: false
      }
    });
  }
};

module.exports.cleanupInvalidChallenges = cleanupInvalidChallenges;
module.exports.createSupabaseClient = createSupabaseClient;
