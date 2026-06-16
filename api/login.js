
const { createClient } = require('@supabase/supabase-js');
const { validateCORS } = require('./_middleware/cors');
const { logSecurityEvent, logLoginFailed, getClientIP } = require('./_middleware/security-logger');
const { 
  checkLoginAttempts: checkLoginAttemptsRedis, 
  incrementLoginAttempts: incrementLoginAttemptsRedis,
  clearLoginAttempts: clearLoginAttemptsRedis
} = require('./_middleware/redis-login-attempts');
const { createSessionToken } = require('./_utils/session-token');

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
      success: false,
      error: 'Method not allowed' 
    });
  }

  const supabase = createSupabaseClient();

  const { nickname, password, website } = req.body || {};

  if (website && website.trim().length > 0) {
    logSecurityEvent('honeypot_triggered', {
      req,
      endpoint: '/api/login',
      metadata: {
        field_name: 'website',
        field_value_length: website.length
      }
    });

    return res.status(400).json({
      success: false,
      error: 'Credenciais inválidas'
    });
  }

  if (!nickname || !password) {
    return res.status(400).json({
      success: false,
      error: 'Nickname e senha são obrigatórios'
    });
  }

  if (nickname.length > 50) {
    return res.status(400).json({ success: false, error: 'Credenciais inválidas' });
  }

  if (password.length < 6 || password.length > 128) {
    return res.status(400).json({ success: false, error: 'Credenciais inválidas' });
  }

  try {
    let checkData = null;

    try {
      checkData = await checkLoginAttemptsRedis(nickname);
    } catch (error) {
      console.error('[login] Redis VPS unavailable:', error.message);
      return res.status(503).json({
        success: false,
        error: 'Sistema temporariamente indisponível. Tente novamente em alguns instantes.'
      });
    }

    if (checkData && checkData.blocked) {
      return res.status(429).json({
        success: false,
        error: 'Muitas tentativas. Tente novamente em 10 minutos',
        retry_after: checkData.retry_after || checkData.retryAfter
      });
    }

    const { data: users, error: fetchError } = await supabase
      .from('usuarios')
      .select('id, nickname, senha_hash, display_name, ranking_code, avatar_file_name')
      .eq('nickname', nickname)
      .limit(1);

    if (fetchError || !users || users.length === 0) {
      try {
        await incrementLoginAttemptsRedis(nickname);
      } catch (error) {
        console.error('[login] Failed to increment login attempts (Redis VPS unavailable):', error.message);
        return res.status(503).json({
          success: false,
          error: 'Sistema temporariamente indisponível. Tente novamente em alguns instantes.'
        });
      }

      logLoginFailed(req, nickname);

      return res.status(401).json({
        success: false,
        error: 'Credenciais inválidas'
      });
    }

    const user = users[0];

    const { data: verifyData, error: verifyError } = await supabase.rpc('verify_password', {
      p_nickname: nickname,
      p_senha: password
    });

    if (verifyError || !verifyData) {
      console.error('[login] verify_password error:', verifyError);

      try {
        await incrementLoginAttemptsRedis(nickname);
      } catch (error) {
        console.error('[login] Failed to increment login attempts (Redis VPS unavailable):', error.message);
        return res.status(503).json({
          success: false,
          error: 'Sistema temporariamente indisponível. Tente novamente em alguns instantes.'
        });
      }

      logLoginFailed(req, nickname);

      return res.status(401).json({
        success: false,
        error: 'Credenciais inválidas'
      });
    }

    try {
      await clearLoginAttemptsRedis(nickname);
    } catch (error) {
      console.error('[login] Failed to clear login attempts (Redis VPS unavailable):', error.message);
      console.warn('[login] Login successful but could not clear attempts counter');
    }

    let sessionToken = null;
    try {
      sessionToken = createSessionToken({
        id: user.id,
        nickname: user.nickname
      });
    } catch (tokenError) {
      console.warn('[login] Session token unavailable; intermission games will be disabled until configured:', tokenError.message);
    }

    return res.status(200).json({
      success: true,
      user: {
        id: user.id,
        nickname: user.nickname,
        display_name: user.display_name || null,
        ranking_code: user.ranking_code || null,
        avatar_file_name: user.avatar_file_name || null
      },
      sessionToken
    });

  } catch (error) {
    console.error('[login] Unexpected error:', error);
    return res.status(500).json({ 
      success: false,
      error: 'Erro interno no servidor' 
    });
  }
};
