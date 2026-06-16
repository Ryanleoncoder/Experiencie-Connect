
CREATE TABLE IF NOT EXISTS login_attempts (
  identifier TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  blocked_until TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_updated_at ON login_attempts(updated_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_blocked_until ON login_attempts(blocked_until);

COMMENT ON TABLE login_attempts IS 'Rastreia tentativas de login fracassadas para prevenir ataques de força bruta. Compartilhado entre todas as instâncias serverless.';
COMMENT ON COLUMN login_attempts.identifier IS 'Identificador do usuário (nickname ou user_id)';
COMMENT ON COLUMN login_attempts.attempts IS 'Número de tentativas de login fracassadas na janela atual';
COMMENT ON COLUMN login_attempts.first_attempt IS 'Timestamp da primeira tentativa falha na janela atual';
COMMENT ON COLUMN login_attempts.blocked_until IS 'Timestamp até o qual o usuário está bloqueado (NULL se não bloqueado)';
COMMENT ON COLUMN login_attempts.updated_at IS 'Timestamp da última atualização, usado para limpeza';


CREATE OR REPLACE FUNCTION check_login_attempts(p_identifier TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_entry RECORD;
  v_retry_after INTEGER;
BEGIN
  SELECT * INTO v_entry
  FROM login_attempts
  WHERE identifier = p_identifier;
  
  IF v_entry IS NULL THEN
    RETURN jsonb_build_object(
      'blocked', false,
      'attempts', 0
    );
  END IF;
  
  IF v_entry.blocked_until IS NOT NULL AND v_entry.blocked_until > v_now THEN
    v_retry_after := EXTRACT(EPOCH FROM (v_entry.blocked_until - v_now))::integer;
    
    RETURN jsonb_build_object(
      'blocked', true,
      'attempts', v_entry.attempts,
      'retry_after', GREATEST(v_retry_after, 1) -- Mínimo de 1 segundo
    );
  END IF;
  
  RETURN jsonb_build_object(
    'blocked', false,
    'attempts', v_entry.attempts
  );
END;
$$;

COMMENT ON FUNCTION check_login_attempts IS 'Verifica se o usuário está bloqueado por tentativas de login fracassadas. Deve ser chamada antes de processar o login.';


CREATE OR REPLACE FUNCTION increment_login_attempts(p_identifier TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_entry RECORD;
  v_blocked BOOLEAN := false;
  v_retry_after INTEGER := 0;
  v_new_attempts INTEGER;
  v_new_blocked_until TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_entry
  FROM login_attempts
  WHERE identifier = p_identifier;
  
  IF v_entry.blocked_until IS NOT NULL AND v_entry.blocked_until > v_now THEN
    v_retry_after := EXTRACT(EPOCH FROM (v_entry.blocked_until - v_now))::integer;
    
    RETURN jsonb_build_object(
      'blocked', true,
      'attempts', v_entry.attempts,
      'retry_after', GREATEST(v_retry_after, 1)
    );
  END IF;
  
  IF v_entry.first_attempt IS NULL OR 
     v_now - v_entry.first_attempt > INTERVAL '10 minutes' THEN
    INSERT INTO login_attempts (identifier, attempts, first_attempt, blocked_until, updated_at)
    VALUES (p_identifier, 1, v_now, NULL, v_now)
    ON CONFLICT (identifier) DO UPDATE
    SET attempts = 1, 
        first_attempt = v_now, 
        blocked_until = NULL, 
        updated_at = v_now;
    
    RETURN jsonb_build_object(
      'blocked', false,
      'attempts', 1
    );
  END IF;
  
  v_new_attempts := COALESCE(v_entry.attempts, 0) + 1;
  
  IF v_new_attempts >= 5 THEN
    v_new_blocked_until := v_now + INTERVAL '10 minutes';
    v_blocked := true;
    v_retry_after := 600; -- 10 minutos em segundos
  ELSE
    v_new_blocked_until := NULL;
  END IF;
  
  INSERT INTO login_attempts (identifier, attempts, first_attempt, blocked_until, updated_at)
  VALUES (p_identifier, v_new_attempts, COALESCE(v_entry.first_attempt, v_now), v_new_blocked_until, v_now)
  ON CONFLICT (identifier) DO UPDATE
  SET attempts = v_new_attempts,
      blocked_until = v_new_blocked_until,
      updated_at = v_now;
  
  IF v_blocked THEN
    RETURN jsonb_build_object(
      'blocked', true,
      'attempts', v_new_attempts,
      'retry_after', v_retry_after
    );
  ELSE
    RETURN jsonb_build_object(
      'blocked', false,
      'attempts', v_new_attempts
    );
  END IF;
END;
$$;

COMMENT ON FUNCTION increment_login_attempts IS 'Incrementa tentativas de login fracassadas. Bloqueia o usuário após 5 tentativas em 10 minutos.';


CREATE OR REPLACE FUNCTION clear_login_attempts(p_identifier TEXT)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  DELETE FROM login_attempts WHERE identifier = p_identifier;
$$;

COMMENT ON FUNCTION clear_login_attempts IS 'Limpa as tentativas de login após autenticação bem-sucedida.';


CREATE OR REPLACE FUNCTION cleanup_login_attempts()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  DELETE FROM login_attempts
  WHERE updated_at < NOW() - INTERVAL '1 hour';
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  RAISE NOTICE 'Cleaned up % login attempt entries older than 1 hour', v_deleted_count;
  
  RETURN v_deleted_count;
END;
$$;

COMMENT ON FUNCTION cleanup_login_attempts IS 'Remove registros de tentativas de login com mais de 1 hora. Deve ser chamada a cada hora via pg_cron ou cron externo.';


GRANT EXECUTE ON FUNCTION check_login_attempts TO authenticated, anon;
GRANT EXECUTE ON FUNCTION increment_login_attempts TO authenticated, anon;
GRANT EXECUTE ON FUNCTION clear_login_attempts TO authenticated, anon;

-- Apenas service_role pode chamar a função de limpeza
GRANT EXECUTE ON FUNCTION cleanup_login_attempts TO service_role;
