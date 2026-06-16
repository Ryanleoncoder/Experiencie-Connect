-- Registra eventos de segurança para auditoria e resposta a incidentes

CREATE TABLE IF NOT EXISTS security_logs (
  id BIGSERIAL PRIMARY KEY,
  tipo TEXT NOT NULL,
  user_id UUID,
  ip TEXT,
  user_agent TEXT,
  endpoint TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE security_logs
ADD CONSTRAINT check_security_log_tipo
CHECK (tipo IN (
  'rate_limit',
  'invalid_token',
  'too_fast',
  'honeypot_triggered',
  'login_failed',
  'invite_blocked'
));

CREATE INDEX IF NOT EXISTS idx_security_logs_tipo ON security_logs(tipo);
CREATE INDEX IF NOT EXISTS idx_security_logs_user_id ON security_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_security_logs_created_at ON security_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_logs_ip ON security_logs(ip);

COMMENT ON TABLE security_logs IS 'Log de eventos de segurança para auditoria e resposta a incidentes. Inserção assíncrona (fire-and-forget).';
COMMENT ON COLUMN security_logs.tipo IS 'Tipo do evento: rate_limit, invalid_token, too_fast, honeypot_triggered, login_failed, invite_blocked';
COMMENT ON COLUMN security_logs.user_id IS 'ID do usuário autenticado (NULL para anônimos)';
COMMENT ON COLUMN security_logs.ip IS 'Endereço IP do cliente';
COMMENT ON COLUMN security_logs.user_agent IS 'Cabeçalho User-Agent do cliente';
COMMENT ON COLUMN security_logs.endpoint IS 'Endpoint da API que disparou o evento';
COMMENT ON COLUMN security_logs.metadata IS 'Dados adicionais específicos do evento (JSON)';

-- Políticas RLS: acesso restrito ao administrador

ALTER TABLE security_logs ENABLE ROW LEVEL SECURITY;

-- Apenas service_role pode ler logs de segurança
CREATE POLICY security_logs_service_role_read
ON security_logs
FOR SELECT
TO service_role
USING (true);

CREATE POLICY security_logs_authenticated_deny
ON security_logs
FOR SELECT
TO authenticated
USING (false);

CREATE POLICY security_logs_anon_deny
ON security_logs
FOR SELECT
TO anon
USING (false);

-- Apenas service_role pode inserir (logging assíncrono a partir do serverless)
CREATE POLICY security_logs_service_role_insert
ON security_logs
FOR INSERT
TO service_role
WITH CHECK (true);


CREATE OR REPLACE FUNCTION cleanup_security_logs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INTEGER := 0;
  v_total_count INTEGER;
  v_excess_count INTEGER;
BEGIN
  DELETE FROM security_logs
  WHERE created_at < NOW() - INTERVAL '30 days';
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  SELECT COUNT(*) INTO v_total_count FROM security_logs;
  
  -- Se houver mais de 10.000 entradas, manter apenas as 10.000 mais recentes
  IF v_total_count > 10000 THEN
    v_excess_count := v_total_count - 10000;
    
    DELETE FROM security_logs
    WHERE id IN (
      SELECT id FROM security_logs
      ORDER BY created_at ASC
      LIMIT v_excess_count
    );
    
    GET DIAGNOSTICS v_excess_count = ROW_COUNT;
    v_deleted_count := v_deleted_count + v_excess_count;
  END IF;
  
  RAISE NOTICE 'Cleaned up % security log entries', v_deleted_count;
  
  RETURN v_deleted_count;
END;
$$;

COMMENT ON FUNCTION cleanup_security_logs IS 'Remove logs de segurança com mais de 30 dias ou mantém no máximo 10.000 entradas. Deve ser chamada diariamente via pg_cron ou cron externo.';


-- Apenas service_role pode chamar a função de limpeza
GRANT EXECUTE ON FUNCTION cleanup_security_logs TO service_role;
