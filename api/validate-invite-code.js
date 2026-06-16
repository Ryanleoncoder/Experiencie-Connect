
const { createClient } = require('@supabase/supabase-js');
const { validateCORS } = require('./_middleware/cors');
const { logSecurityEvent } = require('./_middleware/security-logger');
const { checkRateLimit: checkRateLimitRedis } = require('./_middleware/redis-rate-limiter');
const { getClientIPHash, getInviteTokenHash } = require('./_utils/privacy');

function createSupabaseClient() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      global: {
        fetch: (url, options = {}) => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 8000);
          return fetch(url, { ...options, signal: controller.signal })
            .finally(() => clearTimeout(timeoutId));
        }
      }
    }
  );
}

module.exports = async (req, res) => {
  if (!validateCORS(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      valid: false,
      error: 'Method not allowed'
    });
  }

  const { token, invite_code } = req.body || {};

  if (!token || !invite_code) {
    return res.status(400).json({
      valid: false,
      error: 'Token e código são obrigatórios'
    });
  }

  if (token.length > 200 || invite_code.length > 20) {
    return res.status(400).json({ valid: false, error: 'Dados inválidos' });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    console.error('[validate-invite-code] SUPABASE_SERVICE_ROLE_KEY is not configured');
    return res.status(500).json({
      valid: false,
      error: 'Configuração do servidor incompleta'
    });
  }

  const supabase = createSupabaseClient();

  try {
    const inviteTokenHash = getInviteTokenHash(token);
    const ipHash = getClientIPHash(req);
    const rateLimitChecks = [
      { key: `invite:${inviteTokenHash}:validate-code`, max: 10, window: 60 },
      { key: `iphash:${ipHash}:validate-code`, max: 180, window: 60 }
    ];

    try {
      for (const limit of rateLimitChecks) {
        const rateLimitData = await checkRateLimitRedis(limit.key, limit.max, limit.window);

        if (rateLimitData && !rateLimitData.allowed) {
          logSecurityEvent('rate_limit', {
            req,
            endpoint: '/api/validate-invite-code',
            metadata: {
              retry_after: rateLimitData.retry_after || rateLimitData.retryAfter,
              rate_limit_key: limit.key
            }
          });

          const retryAfter = rateLimitData.retry_after || rateLimitData.retryAfter;
          return res.status(429).json({
            valid: false,
            error: 'Muitas tentativas. Tente novamente em alguns segundos.',
            retry_after: retryAfter
          });
        }
      }
    } catch (error) {
      console.error('[validate-invite-code] Redis VPS unavailable:', error.message);
      return res.status(503).json({
        valid: false,
        error: 'Sistema temporariamente indisponível'
      });
    }

    const { data: invite, error: fetchError } = await supabase
      .from('invite_token')
      .select('nickname, invite_code, invite_expires, invite_used, blocked_at, attempt_count')
      .eq('invite_token', token)
      .single();

    if (fetchError || !invite) {
      return res.status(404).json({
        valid: false,
        error: 'Convite não encontrado'
      });
    }

    if (invite.blocked_at) {
      const blockedTime = new Date(invite.blocked_at);
      const now = new Date();
      const hoursPassed = (now - blockedTime) / (1000 * 60 * 60);

      if (hoursPassed < 1) {
        const minutesLeft = Math.ceil((1 - hoursPassed) * 60);
        const secondsLeft = minutesLeft * 60;

        return res.status(403).json({
          valid: false,
          error: `Convite temporariamente bloqueado por múltiplas tentativas incorretas. Tente novamente em ${minutesLeft} minutos.`,
          retry_after: secondsLeft
        });
      }

      const { error: unblockError } = await supabase
        .from('invite_token')
        .update({
          attempt_count: 0,
          blocked_at: null
        })
        .eq('invite_token', token);

      if (unblockError) {
        console.error('[validate-invite-code] Error unblocking invite:', unblockError);
      }

      invite.attempt_count = 0;
      invite.blocked_at = null;
    }

    if (invite.invite_used) {
      return res.status(410).json({
        valid: false,
        error: 'Este convite já foi utilizado'
      });
    }

    const expiresAt = new Date(invite.invite_expires);
    const now = new Date();

    if (expiresAt < now) {
      return res.status(410).json({
        valid: false,
        error: 'Este convite expirou'
      });
    }

    if (invite.invite_code.toUpperCase() !== invite_code.toUpperCase()) {
      const newAttemptCount = invite.attempt_count + 1;
      const updateData = { attempt_count: newAttemptCount };

      if (newAttemptCount >= 5) {
        updateData.blocked_at = new Date().toISOString();

        logSecurityEvent('invite_blocked', {
          req,
          endpoint: '/api/validate-invite-code',
          metadata: {
            invite_token_hash: inviteTokenHash,
            attempt_count: newAttemptCount
          }
        });
      }

      await supabase
        .from('invite_token')
        .update(updateData)
        .eq('invite_token', token);

      return res.status(400).json({
        valid: false,
        error: 'Código de convite incorreto. Verifique o código recebido.',
        attempts_left: Math.max(0, 5 - newAttemptCount)
      });
    }

    return res.status(200).json({
      valid: true,
      nickname: invite.nickname
    });

  } catch (error) {
    console.error('[validate-invite-code] error:', error);
    return res.status(500).json({
      valid: false,
      error: 'Erro interno no servidor'
    });
  }
};
