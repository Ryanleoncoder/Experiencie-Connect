function apiDebugLog(...args) {
  if (process.env.CXGAME_DEBUG_API === 'true') {
    console.debug(...args);
  }
}

const fs = require('fs');
const path = require('path');

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

const FALLBACK_AVATARS = [
  'm3345.webp',
  'm4245.webp',
  'm4523.webp',
  'm5353.webp',
  'm5354.webp',
  'm5367.webp',
  'm5444.webp',
  'm6345.webp',
  'm6735.webp',
  'h3535.webp',
  'h4234.webp',
  'h4244.webp',
  'h45234.webp',
  'h5234.webp',
  'h52344.webp',
  'h5345.webp',
  'h53534.webp',
  'h5354.webp',
  'h5355.webp',
  'h5635.webp',
  'h7545.webp',
  'h8724.webp'
];

const AVATAR_FILE_PATTERN = /^[a-zA-Z0-9]+\.(webp|png)$/;

function getAvatarDirectory() {
  const candidates = [
    path.join(process.cwd(), 'frontend', 'assets', 'image', 'avatar')
  ];

  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function listAvailableAvatars() {
  const avatarDir = getAvatarDirectory();

  if (!avatarDir) {
    return FALLBACK_AVATARS;
  }

  return fs.readdirSync(avatarDir)
    .filter(fileName => AVATAR_FILE_PATTERN.test(fileName))
    .sort();
}

function isAvailableAvatar(fileName) {
  return listAvailableAvatars().includes(fileName);
}

module.exports = async (req, res) => {
  if (!validateCORS(req, res)) {
    return;
  }

  if (req.method === 'GET') {
    try {
      const avatars = listAvailableAvatars();

      return res.status(200).json({
        success: true,
        avatars: avatars,
        count: avatars.length
      });

    } catch (error) {
      console.error('[accept-invite] Error listing avatars:', error);
      return res.status(500).json({
        success: false,
        error: 'Falha ao listar avatares'
      });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
  }

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    console.error('[accept-invite] SUPABASE_SERVICE_ROLE_KEY is not configured');
    return res.status(500).json({
      success: false,
      error: 'Configuração do servidor incompleta. Contate o administrador.'
    });
  }

  const supabase = createSupabaseClient();

  const { token, invite_code, password, website } = req.body || {};
  const avatarFileName = String(req.body?.avatar_file_name || '').trim();

  if (website && website.trim().length > 0) {
    logSecurityEvent('honeypot_triggered', {
      req,
      endpoint: '/api/accept-invite',
      metadata: {
        field_name: 'website',
        field_value_length: website.length
      }
    });

    return res.status(400).json({
      success: false,
      error: 'Erro ao processar solicitação. Tente novamente.'
    });
  }

  if (!token || !invite_code || !password) {
    return res.status(400).json({
      success: false,
      error: 'Todos os campos são obrigatórios'
    });
  }

  if (token.length > 200 || invite_code.length > 20) {
    return res.status(400).json({ success: false, error: 'Dados inválidos' });
  }

  if (password.length < 6 || password.length > 128) {
    return res.status(400).json({
      success: false,
      error: 'A senha deve ter entre 6 e 128 caracteres'
    });
  }

  if (password.toUpperCase() === invite_code.toUpperCase()) {
    return res.status(400).json({
      success: false,
      error: 'A senha não pode ser igual ao código de convite'
    });
  }

  if (!avatarFileName) {
    return res.status(400).json({
      success: false,
      error: 'A seleção de avatar é obrigatória'
    });
  }

  if (!AVATAR_FILE_PATTERN.test(avatarFileName)) {
    return res.status(400).json({
      success: false,
      error: 'Nome de arquivo de avatar inválido'
    });
  }

  if (avatarFileName.length > 100) {
    return res.status(400).json({
      success: false,
      error: 'Nome de arquivo de avatar muito longo'
    });
  }

  if (!isAvailableAvatar(avatarFileName)) {
    return res.status(400).json({
      success: false,
      error: 'Avatar selecionado nao esta disponivel'
    });
  }

  const inviteTokenHash = getInviteTokenHash(token);
  const ipHash = getClientIPHash(req);
  const rateLimitChecks = [
    { key: `invite:${inviteTokenHash}:accept`, max: 5, window: 300 },
    { key: `iphash:${ipHash}:accept`, max: 120, window: 60 }
  ];

  try {
    for (const limit of rateLimitChecks) {
      const rateLimitData = await checkRateLimitRedis(limit.key, limit.max, limit.window);

      if (rateLimitData && !rateLimitData.allowed) {
        logSecurityEvent('rate_limit', {
          req,
          endpoint: '/api/accept-invite',
          metadata: {
            retry_after: rateLimitData.retry_after || rateLimitData.retryAfter,
            rate_limit_key: limit.key
          }
        });

        const retryAfter = rateLimitData.retry_after || rateLimitData.retryAfter;
        return res.status(429).json({
          success: false,
          error: 'Muitas tentativas. Tente novamente em alguns segundos.',
          retry_after: retryAfter
        });
      }
    }
  } catch (error) {
    console.error('[accept-invite] Redis VPS unavailable:', error.message);
    return res.status(503).json({
      success: false,
      error: 'Sistema temporariamente indisponivel. Tente novamente em alguns instantes.'
    });
  }

  try {
    const { data: invite, error: fetchError } = await supabase
      .from('invite_token')
      .select('nickname, invite_code, invite_expires, invite_used, blocked_at, attempt_count')
      .eq('invite_token', token)
      .single();

    if (fetchError || !invite) {
      return res.status(404).json({
        success: false,
        error: 'Convite não encontrado'
      });
    }

    if (invite.blocked_at) {
      const blockedTime = new Date(invite.blocked_at);
      const now = new Date();
      const hoursPassed = (now - blockedTime) / (1000 * 60 * 60);

      if (hoursPassed < 1) {
        const minutesLeft = Math.ceil((1 - hoursPassed) * 60);

        return res.status(403).json({
          success: false,
          error: `Convite temporariamente bloqueado por múltiplas tentativas incorretas. Tente novamente em ${minutesLeft} minutos.`
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
        console.error('Error unblocking invite:', unblockError);
      }

      invite.attempt_count = 0;
      invite.blocked_at = null;
    }

    if (invite.invite_used) {
      return res.status(410).json({
        success: false,
        error: 'Este convite já foi utilizado. Faça login na plataforma para acessar sua conta.'
      });
    }

    const expiresAt = new Date(invite.invite_expires);
    const now = new Date();

    if (expiresAt < now) {
      return res.status(410).json({
        success: false,
        error: 'Este convite expirou. Solicite um novo convite ao administrador.'
      });
    }

    if (invite.invite_code.toUpperCase() !== invite_code.toUpperCase()) {
      const newAttemptCount = invite.attempt_count + 1;
      const updateData = { attempt_count: newAttemptCount };

      if (newAttemptCount >= 5) {
        updateData.blocked_at = new Date().toISOString();

        logSecurityEvent('invite_blocked', {
          req,
          endpoint: '/api/accept-invite',
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
        success: false,
        error: 'Código de convite incorreto. Verifique o código recebido.',
        attempts_left: Math.max(0, 5 - newAttemptCount)
      });
    }

    if (!invite.invite_code || invite.invite_code.trim().length === 0) {
      console.error('Invalid invite_code: empty or null');
      return res.status(500).json({
        success: false,
        error: 'Código de convite inválido. Contate o administrador.'
      });
    }

    if (invite.invite_code.length > 50) {
      console.error('Invalid invite_code: too long');
      return res.status(500).json({
        success: false,
        error: 'Código de convite inválido. Contate o administrador.'
      });
    }

    apiDebugLog('[accept-invite] Calling criar_usuario RPC with nickname:', invite.nickname);
    const { data: userData, error: createError } = await supabase
      .rpc('criar_usuario', {
        p_nickname: invite.nickname,
        p_senha: password,
        p_avatar_file_name: avatarFileName
      });

    apiDebugLog('[accept-invite] criar_usuario response:', { userData, createError });

    if (createError) {
      console.error('criar_usuario error:', createError);
      console.error('criar_usuario error details:', JSON.stringify(createError, null, 2));

      if (createError.message &&
          (createError.message.includes('já existe') ||
           createError.message.includes('duplicate') ||
           createError.message.includes('already exists'))) {
        return res.status(409).json({
          success: false,
          error: 'Este usuário já está cadastrado.'
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Erro ao criar conta. Tente novamente.'
    });
    }

    const { error: updateInviteError } = await supabase
      .from('invite_token')
      .update({
        invite_used: true,
        attempt_count: 0
      })
      .eq('invite_token', token);

    if (updateInviteError) {
      console.error('Error marking invite as used:', updateInviteError);
    }

    return res.status(200).json({
      success: true,
      nickname: invite.nickname
    });

  } catch (error) {
    console.error('accept-invite error:', error);
    return res.status(500).json({
      success: false,
      error: 'Erro interno no servidor'
    });
  }
};
