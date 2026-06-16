function apiDebugLog(...args) {
  if (process.env.CXGAME_DEBUG_API === 'true') {
    console.debug(...args);
  }
}

// Logging is fire-and-forget: non-blocking, never throws.

const { createClient } = require('@supabase/supabase-js');
const {
  getClientIP,
  getClientIPHash,
  getInviteTokenHash,
  getSessionTokenHash
} = require('../_utils/privacy');

let supabaseAdmin = null;

function getSupabaseAdmin() {
  if (!supabaseAdmin) {
    supabaseAdmin = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return supabaseAdmin;
}

function getUserAgent(req) {
  return req.headers['user-agent'] || 'unknown';
}

function sanitizeMetadata(metadata = {}) {
  const sanitized = { ...metadata };

  if (sanitized.invite_token) {
    sanitized.invite_token_hash = getInviteTokenHash(sanitized.invite_token);
    delete sanitized.invite_token;
  }

  if (sanitized.token) {
    sanitized.token_hash = getSessionTokenHash(sanitized.token);
    delete sanitized.token;
  }

  return sanitized;
}

function logSecurityEvent(tipo, details = {}) {
  const logPromise = (async () => {
    try {
      const supabase = getSupabaseAdmin();
      
      const ip_hash = details.ip_hash || (details.req ? getClientIPHash(details.req) : null);
      const user_agent = details.user_agent || (details.req ? getUserAgent(details.req) : null);
      
      const logEntry = {
        tipo,
        user_id: details.user_id || null,
        ip: null,
        ip_hash,
        user_agent,
        endpoint: details.endpoint || null,
        metadata: sanitizeMetadata(details.metadata || {})
      };
      
      const { error } = await supabase
        .from('security_logs')
        .insert(logEntry);
      
      if (error) {
        console.error('[SecurityLogger] Failed to insert log:', error.message);
        console.error('[SecurityLogger] Log entry:', logEntry);
      } else {
        apiDebugLog(`[SecurityLogger] ✓ Logged event: ${tipo}`);
      }
    } catch (error) {
      console.error('[SecurityLogger] Unexpected error:', error);
    }
  })();

  logPromise.catch(err => {
    console.error('[SecurityLogger] Promise rejection:', err);
  });
}

function logRateLimit(req, endpoint, user_id = null) {
  logSecurityEvent('rate_limit', {
    req,
    endpoint,
    user_id,
    metadata: {
      method: req.method,
      url: req.url
    }
  });
}

function logInvalidToken(req, endpoint) {
  logSecurityEvent('invalid_token', {
    req,
    endpoint,
    metadata: {
      method: req.method,
      url: req.url,
      auth_header_present: !!req.headers.authorization
    }
  });
}

function logTooFast(req, endpoint, user_id, response_time_ms) {
  logSecurityEvent('too_fast', {
    req,
    endpoint,
    user_id,
    metadata: {
      response_time_ms,
      threshold_ms: 2000
    }
  });
}

function logHoneypot(req, endpoint, field_name) {
  logSecurityEvent('honeypot_triggered', {
    req,
    endpoint,
    metadata: {
      field_name,
      field_value_length: req.body?.[field_name]?.length || 0
    }
  });
}

function logLoginFailed(req, identifier) {
  logSecurityEvent('login_failed', {
    req,
    endpoint: '/api/login',
    metadata: {
      identifier
    }
  });
}

function logInviteBlocked(req, invite_token) {
  logSecurityEvent('invite_blocked', {
    req,
    endpoint: '/api/accept-invite',
    metadata: {
      invite_token_hash: getInviteTokenHash(invite_token)
    }
  });
}

module.exports = {
  logSecurityEvent,
  logRateLimit,
  logInvalidToken,
  logTooFast,
  logHoneypot,
  logLoginFailed,
  logInviteBlocked,
  getClientIP,
  getUserAgent
};
