
const { createClient } = require('@supabase/supabase-js');
const { validateCORS } = require('./_middleware/cors');
const { logRateLimit } = require('./_middleware/security-logger');
const { checkRateLimit: checkRateLimitRedis } = require('./_middleware/redis-rate-limiter');
const { getClientIPHash, getInviteTokenHash } = require('./_utils/privacy');

module.exports = async (req, res) => {
  if (!validateCORS(req, res)) {
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawToken = req.query.token;
  const token = typeof rawToken === 'string' ? rawToken : null;

  if (!token) {
    return res.status(400).json({
      valid: false,
      error: 'O token é obrigatório'
    });
  }

  if (token.length > 200) {
    return res.status(400).json({ valid: false, error: 'Token inválido' });
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[check-invite] SUPABASE_SERVICE_ROLE_KEY missing');
    return res.status(500).json({
      valid: false,
      error: 'Sistema temporariamente indisponível'
    });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    const inviteTokenHash = getInviteTokenHash(token);
    const ipHash = getClientIPHash(req);
    const rateLimitChecks = [
      { key: `invite:${inviteTokenHash}:check`, max: 30, window: 60 },
      { key: `iphash:${ipHash}:check`, max: 240, window: 60 }
    ];

    try {
      for (const limit of rateLimitChecks) {
        const rateLimitData = await checkRateLimitRedis(limit.key, limit.max, limit.window);
        if (!rateLimitData || rateLimitData.allowed) {
          continue;
        }

        logRateLimit(req, '/api/check-invite');

        const retryAfter = rateLimitData.retry_after || rateLimitData.retryAfter || 60;
        return res.status(429)
          .setHeader('Retry-After', retryAfter)
          .json({
            valid: false,
            error: 'Muitas requisicoes. Tente novamente em alguns segundos.',
            retry_after: retryAfter
          });
      }
    } catch (error) {
      console.error('[check-invite] Redis VPS unavailable:', error.message);
      return res.status(503).json({
        valid: false,
        error: 'Sistema temporariamente indisponível. Tente novamente em alguns instantes.'
      });
    }
    const { data: invite, error } = await supabase
      .from('invite_token')
      .select('nickname, invite_expires, invite_used, blocked_at, attempt_count')
      .eq('invite_token', token)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
        return res.status(404).json({ valid: false, error: 'Convite não encontrado' });
      }
      console.error('[check-invite] Supabase error:', error.code);
      return res.status(503).json({ valid: false, error: 'Sistema temporariamente indisponível' });
    }
    if (!invite) {
      return res.status(404).json({ valid: false, error: 'Convite não encontrado' });
    }

    if (invite.blocked_at) {
      const blockedTime = new Date(invite.blocked_at);
      const now = new Date();
      const hoursPassed = (now - blockedTime) / (1000 * 60 * 60);

      if (hoursPassed < 1) {
        const minutesLeft = Math.ceil((1 - hoursPassed) * 60);
        const secondsLeft = minutesLeft * 60;

        // No cache — block expires dynamically
        return res.status(403).json({
          valid: false,
          error: `Convite temporariamente bloqueado por múltiplas tentativas incorretas. Tente novamente em ${minutesLeft} minutos.`,
          retry_after: secondsLeft
        });
      }

      const { error: updateError } = await supabase
        .from('invite_token')
        .update({
          attempt_count: 0,
          blocked_at: null
        })
        .eq('invite_token', token);

      if (updateError) {
        console.error('Error resetting blocked invite:', updateError);
      }
    }

    if (invite.invite_used) {
      // Permanent state — safe to cache for longer
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
      return res.status(410).json({
        valid: false,
        error: 'Este convite já foi utilizado. Faça login na plataforma para acessar sua conta.'
      });
    }

    const expiresAt = new Date(invite.invite_expires);
    const now = new Date();

    if (expiresAt < now) {
      // Permanent state — safe to cache for longer
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
      return res.status(410).json({
        valid: false,
        error: 'Este convite expirou. Solicite um novo convite ao administrador.'
      });
    }

    return res.status(200).json({
      valid: true,
      nickname: invite.nickname
    });

  } catch (error) {
    console.error('check-invite error:', error);
    return res.status(500).json({
      valid: false,
      error: 'Erro interno no servidor'
    });
  }
};
