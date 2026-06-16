// SECURITY: Always validate JWT before processing authenticated requests.
// Never trust user_id from request body without JWT validation.

const { createClient } = require('@supabase/supabase-js');
const { logSecurityEvent } = require('./security-logger');
const { getSupabasePublicKey } = require('../_utils/supabase-public-key');

async function validateJWT(req, endpoint = null) {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    
    if (!authHeader) {
      if (endpoint) {
        logSecurityEvent('invalid_token', {
          req,
          endpoint,
          metadata: {
            method: req.method,
            url: req.url,
            auth_header_present: false
          }
        });
      }
      
      return {
        valid: false,
        error: 'Não autorizado: Token ausente'
      };
    }
    
    const token = authHeader.replace(/^Bearer\s+/i, '');
    
    if (!token) {
      if (endpoint) {
        logSecurityEvent('invalid_token', {
          req,
          endpoint,
          metadata: {
            method: req.method,
            url: req.url,
            auth_header_present: true,
            reason: 'invalid_format'
          }
        });
      }
      
      return {
        valid: false,
        error: 'Não autorizado: Token inválido'
      };
    }
    
    const supabase = createClient(
      process.env.SUPABASE_URL,
      getSupabasePublicKey()
    );
    
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      if (endpoint) {
        logSecurityEvent('invalid_token', {
          req,
          endpoint,
          metadata: {
            method: req.method,
            url: req.url,
            auth_header_present: true,
            reason: error ? 'validation_failed' : 'user_not_found',
            error_message: error?.message
          }
        });
      }
      
      return {
        valid: false,
        error: 'Não autorizado: Token inválido ou expirado'
      };
    }
    
    return {
      valid: true,
      user: {
        id: user.id,
        email: user.email,
        user_metadata: user.user_metadata
      }
    };
    
  } catch (error) {
    console.error('[JWT Validator] Error validating token:', error);
    
    if (endpoint) {
      logSecurityEvent('invalid_token', {
        req,
        endpoint,
        metadata: {
          method: req.method,
          url: req.url,
          auth_header_present: !!req.headers.authorization,
          reason: 'exception',
          error_message: error.message
        }
      });
    }
    
    return {
      valid: false,
      error: 'Não autorizado: Erro ao validar token'
    };
  }
}

async function requireAuth(req, res, endpoint = null) {
  const result = await validateJWT(req, endpoint);
  
  if (!result.valid) {
    res.status(403).json({ error: result.error || 'Não autorizado' });
    return { valid: false };
  }
  
  return { valid: true, user: result.user };
}

module.exports = { validateJWT, requireAuth };
