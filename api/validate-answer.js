
const { checkRateLimit: checkRateLimitRedis } = require('./_middleware/redis-rate-limiter');
const { createClient } = require('@supabase/supabase-js');
const { logTooFast } = require('./_middleware/security-logger');
const { validatePlatformAccess } = require('./_middleware/platform-access');
const { requireCxSession, rejectConflictingUserId } = require('./_utils/request-auth');
const { validateChallengeAccessForUser } = require('./_utils/challenge-flow');
const { getPhaseSessionFromVps, resolvePhaseNode } = require('./_utils/phase-session-client');
const { getClientIPHash } = require('./_utils/privacy');

const admin = require('firebase-admin');
const { getServiceAccount } = require('./_config/firebase-service-account');

function debugLog(...args) {
  if (process.env.CXGAME_DEBUG_API === 'true') {
    console.debug(...args);
  }
}

let firebaseInitError = null;
if (!admin.apps.length) {
  try {
    const serviceAccount = getServiceAccount();

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (error) {
    firebaseInitError = error;
    console.error('[validate-answer] Firebase Admin initialization failed:', error.message);
    console.error('[validate-answer] Error stack:', error.stack);
  }
}

const answerKeyCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in-memory cache to reduce Firebase reads

/**
 * In-memory circuit breaker for the Logun-IA service.
 * States: CLOSED → OPEN → HALF_OPEN → CLOSED
 * Thresholds: 50% error rate over min 10 requests, 60s open duration.
 */
class SimpleCircuitBreaker {
  constructor() {
    this.state = 'CLOSED';
    this.errors = [];
    this.openedAt = null;
    this.halfOpenProbeInFlight = false;
    this.config = {
      errorThreshold: 0.5,
      minRequests: 10,
      openDuration: 60000
    };
  }

  recordResult(success) {
    const now = Date.now();
    this.halfOpenProbeInFlight = false;

    this.errors.push({ timestamp: now, success });

    const tenMinutesAgo = now - 10 * 60 * 1000;
    this.errors = this.errors.filter(e => e.timestamp > tenMinutesAgo);

    this.updateState();
  }

  updateState() {
    const now = Date.now();

    if (this.state === 'OPEN') {
      if (now - this.openedAt >= this.config.openDuration) {
        debugLog('[circuit-breaker] Transitioning OPEN → HALF_OPEN (timeout expired)');
        this.state = 'HALF_OPEN';
      }
      return;
    }

    if (this.state === 'HALF_OPEN') {
      const lastResult = this.errors[this.errors.length - 1];
      if (lastResult.success) {
        debugLog('[circuit-breaker] Transitioning HALF_OPEN → CLOSED (test request succeeded)');
        this.state = 'CLOSED';
        this.errors = [];
      } else {
        debugLog('[circuit-breaker] Transitioning HALF_OPEN → OPEN (test request failed)');
        this.state = 'OPEN';
        this.openedAt = now;
      }
      return;
    }

    if (this.state === 'CLOSED') {
      if (this.errors.length < this.config.minRequests) {
        return;
      }

      const failures = this.errors.filter(e => !e.success).length;
      const errorRate = failures / this.errors.length;

      if (errorRate >= this.config.errorThreshold) {
        debugLog('[circuit-breaker] Transitioning CLOSED → OPEN (error rate:', errorRate, ')');
        this.state = 'OPEN';
        this.openedAt = now;
      }
    }
  }

  allowRequest() {
    if (this.state === 'CLOSED') {
      return true;
    }

    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenProbeInFlight) {
        return false;
      }

      this.halfOpenProbeInFlight = true;
      return true;
    }

    if (this.state === 'OPEN') {
      const now = Date.now();
      if (now - this.openedAt >= this.config.openDuration) {
        debugLog('[circuit-breaker] Transitioning OPEN → HALF_OPEN (timeout expired)');
        this.state = 'HALF_OPEN';
        this.halfOpenProbeInFlight = true;
        return true;
      }

      return false;
    }

    return true;
  }

  getStatus() {
    const failures = this.errors.filter(e => !e.success).length;
    const errorRate = this.errors.length > 0 ? failures / this.errors.length : 0;

    return {
      state: this.state,
      errorRate,
      totalRequests: this.errors.length,
      failures,
      openedAt: this.openedAt
    };
  }
}

const logunCircuitBreaker = new SimpleCircuitBreaker();



function createSupabaseClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      global: {
        fetch: (url, options = {}) => {
          // 8s timeout on all calls — within Vercel's 10s limit with 2s buffer
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

// Firebase é a fonte de verdade para gabaritos — challenges.json não é mais usado.

async function checkIdempotency(idempotencyKey, supabase, userId, challengeId) {
  try {
    const { data, error } = await supabase
      .from('challenge_attempts')
      .select('is_correct, xp_earned, attempt_number')
      .eq('idempotency_key', idempotencyKey)
      .eq('user_id', userId)
      .eq('challenge_id', challengeId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = row not found
      console.error('[validate-answer] Error checking idempotency:', {
        message: error.message,
        code: error.code,
        details: error.details
      });
      throw error;
    }

    return {
      exists: !!data,
      result: data
    };
  } catch (error) {
    console.error('[validate-answer] Unexpected error in checkIdempotency:', {
      message: error.message,
      code: error.code,
      name: error.name
    });
    throw error;
  }
}

async function getAnswerKeyFromFirebase(challengeId) {
  const cached = answerKeyCache.get(challengeId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    debugLog(`[validate-answer] Using cached answer key for ${challengeId}`);
    return cached.data;
  }

  try {
    const db = admin.firestore();
    const docRef = db.collection('answer_keys').doc(challengeId);
    const doc = await docRef.get();

    if (!doc.exists) {
      console.warn(`[validate-answer] Answer key not found in Firebase: ${challengeId}`);
      return null;
    }

    const data = doc.data();
    const answerKey = {
      answers: data.correct_answers || [],
      points: data.points || 0,
      is_text_question: data.is_text_question || false
    };

    answerKeyCache.set(challengeId, {
      data: answerKey,
      timestamp: Date.now()
    });

    debugLog(`[validate-answer] Fetched answer key from Firebase: ${challengeId}`);
    return answerKey;

  } catch (error) {
    console.error(`[validate-answer] Error fetching answer key from Firebase:`, error);
    return null;
  }
}

async function getAnswerKeyFromSupabase(challengeId) {
  const cached = answerKeyCache.get(challengeId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const supabase = createSupabaseClient();
    const { data, error } = await supabase
      .from('answer_keys')
      .select('correct_answers, resposta_correta, points, is_text_question')
      .eq('challenge_id', challengeId)
      .maybeSingle();

    if (error) {
      console.error('[validate-answer] Error fetching answer key from Supabase:', error.message);
      return null;
    }
    if (!data) {
      console.warn(`[validate-answer] Answer key not found in Supabase: ${challengeId}`);
      return null;
    }

    let answers = Array.isArray(data.correct_answers) ? data.correct_answers : [];
    if (answers.length === 0 && data.resposta_correta != null) {
      answers = Array.isArray(data.resposta_correta) ? data.resposta_correta : [data.resposta_correta];
    }
    const answerKey = {
      answers,
      points: data.points || 0,
      is_text_question: data.is_text_question || false
    };

    answerKeyCache.set(challengeId, { data: answerKey, timestamp: Date.now() });
    return answerKey;
  } catch (error) {
    console.error('[validate-answer] Error fetching answer key from Supabase:', error);
    return null;
  }
}

async function getAnswerKey(challengeId) {
  const source = String(process.env.CONTENT_SOURCE || 'supabase').trim().toLowerCase();
  return source === 'supabase'
    ? getAnswerKeyFromSupabase(challengeId)
    : getAnswerKeyFromFirebase(challengeId);
}

function detectQuestionType(answerKey) {
  if (!answerKey) {
    return { isTextQuestion: false, answerKey: null };
  }

  // Wildcard "*" nas respostas também marca a questão como dissertativa (texto)
  const isTextQuestion =
    answerKey.is_text_question === true ||
    (Array.isArray(answerKey.answers) && answerKey.answers.includes("*"));

  debugLog(`[validate-answer] Question type detection:`, {
    is_text_question: answerKey.is_text_question,
    has_wildcard: Array.isArray(answerKey.answers) && answerKey.answers.includes("*"),
    result: isTextQuestion ? 'TEXT' : 'MULTIPLE_CHOICE'
  });

  return { isTextQuestion, answerKey };
}

function transformLogunResponse(logunResponse, attemptResult) {
  const isCorrect = logunResponse.status === 'aprovado';

  return {
    correct: isCorrect,
    visual_correct: isCorrect,
    completed: true,
    score: attemptResult.xp_earned,
    attempt_number: attemptResult.attempt_number,
    xp_multiplier: attemptResult.xp_multiplier,
    attempts_remaining: attemptResult.attempts_remaining,
    status: attemptResult.status,

    logun_feedback: {
      confianca: logunResponse.confianca,
      feedback: logunResponse.feedback || {},
      sugestoes: logunResponse.sugestoes || [],
      provider_used: logunResponse.provider_used,
      validation_method: logunResponse.validation_method,
      keyword_match_score: logunResponse.keyword_match_score,
      word_count: logunResponse.word_count,
      min_word_count: logunResponse.min_word_count,
      recommended_keywords_found: logunResponse.recommended_keywords_found || [],
      recommended_keywords_missing: logunResponse.recommended_keywords_missing || []
    },

    acceptedAt: new Date().toISOString()
  };
}

function clampRatio(value, min = 0, max = 1) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return null;
  return Math.max(min, Math.min(max, numericValue));
}

function normalizeLogunScore(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return null;

  if (numericValue <= 1) {
    return clampRatio(numericValue);
  }

  return clampRatio(numericValue / 10);
}

function criterionToRatio(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number') return normalizeLogunScore(value);
  if (typeof value === 'string') {
    const normalized = value.toLowerCase();
    if (['true', 'ok', 'passou', 'aprovado', 'sim'].includes(normalized)) return 1;
    if (['false', 'falhou', 'reprovado', 'nao', 'não'].includes(normalized)) return 0;
    return normalizeLogunScore(value);
  }

  if (typeof value === 'object') {
    if (typeof value.passou === 'boolean') return value.passou ? 1 : 0;
    if (typeof value.passed === 'boolean') return value.passed ? 1 : 0;
    if (value.score !== undefined) return normalizeLogunScore(value.score);
    if (value.pontuacao !== undefined) return normalizeLogunScore(value.pontuacao);
  }

  return null;
}

function collectLogunCriterionRatios(logunResponse) {
  const feedback = logunResponse?.feedback || {};
  const criteriaSource = feedback.criterios && typeof feedback.criterios === 'object'
    ? feedback.criterios
    : feedback;
  const ratios = [];

  if (criteriaSource && typeof criteriaSource === 'object') {
    Object.entries(criteriaSource).forEach(([key, value]) => {
      if (['score', 'confianca', 'keyword_match_score'].includes(key)) return;
      const ratio = criterionToRatio(value);
      if (ratio !== null) ratios.push(ratio);
    });
  }

  return ratios;
}

function calculateLogunAwardedBaseXP(logunResponse, baseXP) {
  const numericBaseXP = Number(baseXP) || 0;
  if (numericBaseXP <= 0) return 0;

  const ratios = collectLogunCriterionRatios(logunResponse);
  const feedback = logunResponse?.feedback || {};
  const fallbackRatio =
    normalizeLogunScore(feedback.score) ??
    normalizeLogunScore(logunResponse?.keyword_match_score) ??
    normalizeLogunScore(logunResponse?.confianca) ??
    (logunResponse?.status === 'aprovado' || logunResponse?.status === 'approved' ? 1 : 0.35);

  const averageRatio = ratios.length
    ? ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length
    : fallbackRatio;

  const isApproved = logunResponse?.status === 'aprovado' || logunResponse?.status === 'approved';
  const statusFloor = isApproved ? 0.75 : 0.1;
  const statusCeiling = isApproved ? 1 : 0.74;
  const finalRatio = clampRatio(Math.max(averageRatio, statusFloor), statusFloor, statusCeiling) ?? statusFloor;

  return Math.max(1, Math.floor(numericBaseXP * finalRatio));
}

function sendLogunWarmingResponse(res, reason, circuitStatus = null) {
  const retryAfter = 10;
  const payload = {
    error: 'service_warming_up',
    message: 'O Sentury esta iniciando. Aguarde alguns segundos e tente novamente.',
    retryable: true,
    retry_after: retryAfter,
    service: 'logun',
    reason
  };

  if (circuitStatus) {
    payload.circuit_breaker = {
      state: circuitStatus.state,
      error_rate: circuitStatus.errorRate
    };
  }

  return res.status(503)
    .setHeader('Retry-After', retryAfter)
    .json(payload);
}

function validateTextSecurity(text, maxLength = 2000) {
  if (text.length > maxLength) {
    console.warn('[validate-answer] Text exceeds max length:', {
      length: text.length,
      maxLength
    });
    return {
      valid: false,
      error: `Texto muito longo. Máximo: ${maxLength} caracteres.`
    };
  }

  const controlCharsRegex = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;
  if (controlCharsRegex.test(text)) {
    console.warn('[validate-answer] Text contains control characters');
    return {
      valid: false,
      error: 'Texto contém caracteres inválidos.'
    };
  }

  // Chars de largura zero e bidi override — usados em ataques de injeção/ofuscação
  const suspiciousUnicodeRegex = /[\u200B-\u200D\u202A-\u202E\uFEFF]/;
  if (suspiciousUnicodeRegex.test(text)) {
    console.warn('[validate-answer] Text contains suspicious unicode');
    return {
      valid: false,
      error: 'Texto contém caracteres inválidos.'
    };
  }

  return { valid: true };
}

function anonymizePIIForExternalService(text) {
  return String(text || '')
    .replace(/\b[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[email]')
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]')
    .replace(/(?:\+?55\s?)?(?:\(?\d{2}\)?\s?)?\d{4,5}[-\s]?\d{4}\b/g, '[telefone]');
}

async function getCachedValidation(cacheKey, redis) {
  if (!redis) {
    return null;
  }

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      debugLog('[validate-answer] Cache hit:', { cacheKey });
      return JSON.parse(cached);
    }
    debugLog('[validate-answer] Cache miss:', { cacheKey });
    return null;
  } catch (error) {
    console.error('[validate-answer] Cache read error:', error.message);
    return null;
  }
}

async function cacheValidation(cacheKey, response, redis, ttl = 900) {
  if (!redis) {
    return;
  }

  try {
    await redis.setex(cacheKey, ttl, JSON.stringify(response));
    debugLog('[validate-answer] Cached response:', { cacheKey, ttl });
  } catch (error) {
    console.error('[validate-answer] Cache write error:', error.message);
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const auth = await requireCxSession(req);
  if (!auth.ok) {
    return res.status(auth.status).json({
      error: auth.error,
      message: auth.message
    });
  }

  const access = await validatePlatformAccess(req, res);
  if (!access.allowed) {
    return res.status(403).json({
      error: 'Acesso negado',
      reason: access.reason,
      message: access.message,
      redirect: access.redirect,
      next_open_time: access.next_open_time
    });
  }

  if (firebaseInitError) {
    console.error('[validate-answer] ❌ Firebase not initialized, cannot process request');
    console.error('[validate-answer] Initialization error:', firebaseInitError.message);
    return res.status(500).json({
      error: 'service_unavailable',
      message: 'Servico temporariamente indisponivel.'
    });
  }

  try {
    const body = req.body || {};
    const { challengeId, phaseSessionId, answer, level, setor, seasonId, timeMs } = body;
    const userId = auth.user.id;
    const userConflict = rejectConflictingUserId(body.userId, userId);

    if (userConflict) {
      return res.status(userConflict.status).json(userConflict.payload);
    }

    debugLog('[validate-answer] Request received:', {
      challengeId,
      phaseSessionId: phaseSessionId || null,
      answer: answer ? `${answer.substring(0, 20)}...` : undefined,
      userId,
      level,
      setor,
      seasonId,
      timeMs,
      hasBody: !!req.body
    });

    if (!challengeId || typeof answer !== "string") {
      console.error('[validate-answer] Missing challengeId or answer:', { challengeId, answer: typeof answer });
      return res.status(400).json({ error: "challengeId e answer são obrigatórios" });
    }

    if (typeof challengeId === 'string' && challengeId.length > 100) {
      return res.status(400).json({ error: 'challengeId inválido' });
    }

    if (answer.length > 2000) {
      return res.status(400).json({ error: 'Resposta muito longa' });
    }

    const requirePhaseSession = process.env.CXGAME_REQUIRE_PHASE_SESSION === 'true';
    if (!level || !setor || !seasonId || (requirePhaseSession && !phaseSessionId)) {
      console.error('[validate-answer] Missing required fields:', {
        level,
        setor,
        seasonId,
        phaseSessionId: phaseSessionId ? 'present' : 'missing',
        levelType: typeof level,
        setorType: typeof setor,
        seasonIdType: typeof seasonId
      });
      return res.status(400).json({
        error: requirePhaseSession
          ? "level, setor, seasonId e phaseSessionId são obrigatórios"
          : "level, setor e seasonId são obrigatórios",
        received: { level, setor, seasonId, phaseSessionId: phaseSessionId ? 'present' : 'missing' }
      });
    }

    const idempotencyKey = req.headers["x-idempotency-key"];

    if (!idempotencyKey) {
      console.error('[validate-answer] Missing X-Idempotency-Key header');
      return res.status(400).json({
        error: 'Cabeçalho X-Idempotency-Key ausente'
      });
    }

    const supabase = createSupabaseClient();
    let phaseSession = null;
    let phaseNode = null;
    let logicalChallengeId = challengeId;
    let contentChallengeId = challengeId;

    if (phaseSessionId) {
      try {
        phaseSession = await getPhaseSessionFromVps({
          phaseSessionId,
          sessionToken: auth.token
        });

        if (phaseSession?.user_id && phaseSession.user_id !== userId) {
          return res.status(403).json({
            error: 'phase_session_mismatch',
            message: 'Sessao de fase nao pertence ao usuario.'
          });
        }

        phaseNode = resolvePhaseNode(phaseSession, challengeId);
        if (!phaseNode || phaseNode.type === 'game') {
          return res.status(403).json({
            error: 'challenge_access_denied',
            reason: 'challenge_not_in_phase_session'
          });
        }

        logicalChallengeId = phaseNode.logical_id || challengeId;
        contentChallengeId = phaseNode.content_id || phaseNode.challenge_id || challengeId;
      } catch (error) {
        console.error('[validate-answer] Phase session resolution failed:', {
          message: error.message,
          phaseSessionId,
          challengeId
        });
        return res.status(503).json({
          error: 'phase_session_unavailable',
          message: 'Sessao de fase temporariamente indisponivel.',
          retryable: true
        });
      }
    }

    debugLog('[validate-answer] Challenge identity resolved:', {
      challengeId,
      logicalChallengeId,
      contentChallengeId,
      phaseSessionId: phaseSessionId || null
    });

    const { exists, result } = await checkIdempotency(idempotencyKey, supabase, userId, logicalChallengeId);

    if (exists) {
      debugLog('[validate-answer] Idempotent request detected, returning cached result');
      return res.status(200).json({
        correct: result.is_correct,
        score: result.xp_earned,
        attempt_number: result.attempt_number ?? result.attempts_used,
        status: result.status || (result.challenge_completed ? 'completed' : (result.is_correct ? 'correct' : 'incorrect')),
        idempotent: true
      });
    }

    // Rate limit: user ID como chave primária, IP hash como sinal secundário
    const ipHash = getClientIPHash(req);
    const rateLimitChecks = [
      { key: `user:${userId}:answer`, max: 10, window: 60 },
      { key: `iphash:${ipHash}:answer`, max: 600, window: 60 }
    ];

    try {
      for (const limit of rateLimitChecks) {
        const rateLimitData = await checkRateLimitRedis(limit.key, limit.max, limit.window);

        if (!rateLimitData || rateLimitData.allowed) {
          continue;
        }

        const retryAfter = rateLimitData.retry_after || rateLimitData.retryAfter || 60;
        return res.status(429)
          .setHeader('Retry-After', retryAfter)
          .json({
            error: 'rate_limit_exceeded',
            message: 'Muitas requisicoes. Tente novamente em alguns segundos.',
            retry_after: retryAfter
          });
      }
    } catch (error) {
      // Fail open — Redis indisponível não deve bloquear requisições legítimas
      console.warn('[validate-answer] Redis unavailable, skipping rate limit check:', error.message);
    }

    if (timeMs && timeMs < 2000) {
      logTooFast(req, '/api/validate-answer', userId, timeMs);
    }

    let accessValidation;
    try {
      accessValidation = await validateChallengeAccessForUser({
        supabase,
        userId,
        challengeId,
        level,
        setor,
        seasonId,
        phaseSession
      });
    } catch (error) {
      console.error('[validate-answer] Challenge access validation failed:', {
        message: error.message,
        challengeId,
        logicalChallengeId,
        contentChallengeId,
        level
      });
      return res.status(503).json({
        error: 'challenge_access_unavailable',
        message: 'Validacao de acesso temporariamente indisponivel.',
        retryable: true
      });
    }

    if (!accessValidation.isValid) {
      return res.status(403).json({
        error: 'challenge_access_denied',
        redirectTo: accessValidation.redirectTo,
        reason: accessValidation.reason
      });
    }

    let entry;
    try {
      debugLog('[validate-answer] Fetching answer key from Firebase:', {
        challengeId: contentChallengeId,
        logicalChallengeId
      });
      entry = await getAnswerKey(contentChallengeId);
      debugLog('[validate-answer] answer key fetch result:', {
        challengeId: contentChallengeId,
        logicalChallengeId,
        entryExists: !!entry,
        entryType: typeof entry,
        hasAnswers: entry ? !!entry.answers : false,
        answersIsArray: entry ? Array.isArray(entry.answers) : false,
        answersLength: entry && Array.isArray(entry.answers) ? entry.answers.length : 0
      });
    } catch (firebaseError) {
      console.error('[validate-answer] Firebase error fetching answer key:', {
        challengeId: contentChallengeId,
        logicalChallengeId,
        error: firebaseError.message,
        stack: firebaseError.stack
      });
      entry = null;
    }

    if (!entry || !Array.isArray(entry.answers)) {
      console.error('[validate-answer] Answer key not found or invalid:', {
        challengeId: contentChallengeId,
        logicalChallengeId,
        entryExists: !!entry,
        answersIsArray: entry ? Array.isArray(entry.answers) : false,
        entry: entry
      });
      return res.status(400).json({
        error: "Gabarito não encontrado na base do servidor",
        challengeId: contentChallengeId,
        hint: "Entre em contato com o suporte se o problema persistir"
      });
    }

    const { isTextQuestion, answerKey } = detectQuestionType(entry);

    const baseXP = entry.points ?? 0;
    let isCorrect;
    let logunResponse = null;

    if (isTextQuestion) {
      debugLog('[validate-answer] Text question detected, routing to Logun-IA');

      // Anti-spam: 5 chamadas Logun por minuto por usuário. Fail open se Redis indisponível.
      const logunPerMinuteLimit = 5;

      try {
        const perMinuteKey = `rate_limit:logun:${userId}`;
        const perMinuteData = await checkRateLimitRedis(perMinuteKey, logunPerMinuteLimit, 60);

        if (perMinuteData && !perMinuteData.allowed) {
          console.warn('[validate-answer] Logun per-minute limit exceeded:', {
            userId,
            limit: logunPerMinuteLimit
          });
          return res.status(429)
            .setHeader('Retry-After', perMinuteData.retry_after || 60)
            .json({
              error: 'rate_limit_exceeded',
              message: `Muitas requisições. Aguarde ${perMinuteData.retry_after || 60} segundos.`,
              retry_after: perMinuteData.retry_after || 60
            });
        }

        debugLog('[validate-answer] Logun rate limit OK:', {
          userId,
          perMinuteRemaining: perMinuteData?.remaining
        });

      } catch (rateLimitError) {
        console.warn('[validate-answer] Logun rate limit check skipped (Redis unavailable):', rateLimitError.message);
      }

      const maxLength = parseInt(process.env.LOGUN_MAX_TEXT_LENGTH) || 2000;
      const securityCheck = validateTextSecurity(answer, maxLength);

      if (!securityCheck.valid) {
        console.warn('[validate-answer] Security validation failed:', securityCheck.error);
        return res.status(400).json({
          error: 'validation_error',
          message: securityCheck.error
        });
      }

      if (req.body.email) {
        console.warn('[validate-answer] Honeypot triggered:', { userId, challengeId });
        return res.status(400).json({
          error: 'validation_error',
          message: 'Requisição inválida.'
        });
      }

      const externalAnswer = anonymizePIIForExternalService(answer);

      const { LogunIAClient, generateCacheKey } = require('./_utils/logun-client');
      const cacheKey = generateCacheKey(contentChallengeId, externalAnswer);

      let cachedResponse = null;

      if (cachedResponse) {
        debugLog('[validate-answer] Using cached Logun response');
        logunResponse = cachedResponse;
        isCorrect = logunResponse.status === 'aprovado';
      } else {
        const logunUrl = process.env.LOGUN_IA_URL;
        const logunToken = process.env.LOGUN_API_TOKEN;
        const logunTimeout = parseInt(process.env.LOGUN_TIMEOUT_MS) || 8000;

        if (!logunUrl || !logunToken) {
          console.error('[validate-answer] Logun-IA not configured');
          return res.status(500).json({
            error: 'service_unavailable',
            message: 'Serviço de validação não configurado.',
            retryable: false
          });
        }

        if (!logunCircuitBreaker.allowRequest()) {
          console.warn('[validate-answer] Circuit breaker OPEN - Sentury still warming up');
          const status = logunCircuitBreaker.getStatus();

          return sendLogunWarmingResponse(res, 'circuit_open', status);
        } else {
          const logunClient = new LogunIAClient(logunUrl, logunToken, logunTimeout);

          try {
            const startTime = Date.now();

            logunResponse = await logunClient.validateText({
              text: externalAnswer,
              challengeId: contentChallengeId,
              userId,
              level
            });

            const latency = Date.now() - startTime;

            debugLog('[validate-answer] Logun-IA validation completed:', {
              challengeId,
              userId,
              latency,
              provider: logunResponse.provider_used,
              status: logunResponse.status,
              confidence: logunResponse.confianca
            });

            isCorrect = logunResponse.status === 'aprovado';

            logunCircuitBreaker.recordResult(true);

          } catch (error) {
            console.error('[validate-answer] Logun-IA validation failed:', {
              error: error.message,
              challengeId,
              userId
            });

            logunCircuitBreaker.recordResult(false);

            if (error.message === 'timeout' || error.message === 'service_unavailable') {
              console.warn('[validate-answer] Sentury unavailable before attempt recording:', {
                error: error.message,
                challengeId,
                userId
              });
              return sendLogunWarmingResponse(res, 'service_unavailable');
            } else {
              return res.status(500).json({
                error: 'internal_error',
                message: 'Erro ao processar resposta. Tente novamente.',
                retryable: true
              });
            }
          }
        }
      }
    } else {
      debugLog('[validate-answer] Multiple choice question detected, using local validation');

      try {
        const trimmedAnswer = answer.trim().toUpperCase();
        isCorrect = entry.answers.includes(trimmedAnswer);

        debugLog('[validate-answer] Validation details:', {
          challengeId,
          userAnswer: answer,
          trimmedAnswer,
          correctAnswers: entry.answers,
          isCorrect,
          baseXP,
          entryType: typeof entry,
          answersType: typeof entry.answers,
          answersIsArray: Array.isArray(entry.answers)
        });
      } catch (validationError) {
        console.error('[validate-answer] Error during multiple choice validation:', {
          error: validationError.message,
          stack: validationError.stack,
          entry: entry,
          answer: answer
        });
        throw validationError;
      }
    }

    let attemptResult, attemptError;
    const shouldCompleteChallenge = isTextQuestion && logunResponse ? true : isCorrect;
    
    let levelMultiplier = 1.0;
    const numericLevel = Number(level);
    if (numericLevel === 2) levelMultiplier = 1.5;
    else if (numericLevel === 3) levelMultiplier = 2.0;

    const awardedBaseXP = isTextQuestion && logunResponse 
      ? Math.max(1, Math.floor(calculateLogunAwardedBaseXP(logunResponse, 200) / levelMultiplier))
      : baseXP;

    try {
      const rpcResult = await supabase.rpc('record_challenge_attempt', {
        p_user_id: userId,
        p_challenge_id: logicalChallengeId,
        p_level: level,
        p_setor: setor,
        p_season_id: seasonId,
        p_user_answer: isTextQuestion ? answer : answer.trim().toUpperCase(),
        p_is_correct: shouldCompleteChallenge,
        p_base_xp: awardedBaseXP,
        p_time_taken_ms: timeMs || null,
        p_idempotency_key: idempotencyKey
      });

      attemptResult = rpcResult.data;
      attemptError = rpcResult.error;
    } catch (error) {
      console.error('[validate-answer] Supabase RPC network error:', {
        message: error.message,
        code: error.code,
        name: error.name,
        stack: error.stack
      });

      if (error.message?.includes('timeout') || error.code === 'ETIMEDOUT' || error.name === 'AbortError') {
        console.warn('[validate-answer] ⏱️ Request timeout occurred:', {
          userId,
          challengeId,
          idempotencyKey,
          timeoutMs: 8000,
          timestamp: new Date().toISOString()
        });

        return res.status(408).json({
          error: 'timeout',
          message: 'Erro de conexão. Tente novamente.',
          retryable: true
        });
      }

      return res.status(503).json({
        error: 'service_unavailable',
        message: 'Erro de conexão. Tente novamente.',
        retryable: true
      });
    }

    if (attemptError) {
      console.error('[validate-answer] Supabase RPC error:', {
        message: attemptError.message,
        code: attemptError.code,
        details: attemptError.details,
        hint: attemptError.hint
      });

      // PGRST301 = erro de conexão; prefixo 08 = classe de exceção de conexão PostgreSQL
      if (attemptError.code?.startsWith('08') || attemptError.code === 'PGRST301') {
        return res.status(503).json({
          error: 'service_unavailable',
          message: 'Erro de conexão. Tente novamente.',
          retryable: true
        });
      }

      return res.status(503).json({
        error: 'database_error',
        message: 'Erro de conexão. Tente novamente.',
        retryable: true
      });
    }

    if (attemptResult.error) {
      return res.status(400).json({
        error: attemptResult.error,
        attempts_remaining: 0,
        status: 'failed'
      });
    }

    if (isTextQuestion && logunResponse) {
      const transformedResponse = transformLogunResponse(logunResponse, attemptResult);

      return res.status(200).json({
        ...transformedResponse,
        meta: {
          challengeId,
          level,
          setor,
          seasonId,
          timeMs: timeMs ?? null,
          timeLimit: null
        }
      });
    } else {
      return res.status(200).json({
        correct: isCorrect,
        score: attemptResult.xp_earned,
        attempt_number: attemptResult.attempt_number,
        xp_multiplier: attemptResult.xp_multiplier,
        attempts_remaining: attemptResult.attempts_remaining,
        status: attemptResult.status,
        acceptedAt: new Date().toISOString(),
        meta: {
          challengeId,
          level,
          setor,
          seasonId,
          timeMs: timeMs ?? null,
          timeLimit: null
        }
      });
    }

  } catch (error) {
    console.error('[validate-answer] Unexpected error:', {
      message: error.message,
      code: error.code,
      name: error.name,
      stack: error.stack
    });

    if (error.message?.includes('timeout') || error.code === 'ETIMEDOUT' || error.name === 'AbortError') {
      console.warn('[validate-answer] ⏱️ Request timeout occurred (outer catch):', {
        timestamp: new Date().toISOString(),
        errorName: error.name,
        errorMessage: error.message
      });

      return res.status(408).json({
        error: 'timeout',
        message: 'Erro de conexão. Tente novamente.',
        retryable: true
      });
    }

    return res.status(500).json({
      error: 'internal_error',
      message: 'Erro de conexão. Tente novamente.',
      retryable: true
    });
  }
};
