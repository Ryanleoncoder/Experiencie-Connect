
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  requests JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_updated_at ON rate_limits(updated_at);

COMMENT ON TABLE rate_limits IS 'Armazena dados de limitação de taxa usando algoritmo de janela deslizante. Compartilhado entre todas as instâncias serverless.';
COMMENT ON COLUMN rate_limits.key IS 'Chave de rate limit (ex.: "user:123" ou "ip:192.168.1.1")';
COMMENT ON COLUMN rate_limits.requests IS 'Array JSONB de timestamps de requisições dentro da janela atual';
COMMENT ON COLUMN rate_limits.updated_at IS 'Timestamp da última atualização, usado para limpeza';


CREATE OR REPLACE FUNCTION check_rate_limit(
  p_key TEXT,
  p_max_requests INTEGER,
  p_window_seconds INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_window_start TIMESTAMPTZ := v_now - (p_window_seconds || ' seconds')::INTERVAL;
  v_requests JSONB;
  v_filtered JSONB;
  v_count INTEGER;
  v_oldest_timestamp TIMESTAMPTZ;
  v_retry_after INTEGER;
BEGIN
  SELECT requests INTO v_requests
  FROM rate_limits
  WHERE key = p_key;
  
  IF v_requests IS NULL THEN
    v_requests := '[]'::jsonb;
  END IF;
  
  SELECT jsonb_agg(elem)
  INTO v_filtered
  FROM jsonb_array_elements(v_requests) elem
  WHERE (elem::text::timestamptz) > v_window_start;
  
  IF v_filtered IS NULL THEN
    v_filtered := '[]'::jsonb;
  END IF;
  
  v_count := jsonb_array_length(v_filtered);
  
  IF v_count >= p_max_requests THEN
    v_oldest_timestamp := (v_filtered->0)::text::timestamptz;
    v_retry_after := EXTRACT(EPOCH FROM (
      v_oldest_timestamp + (p_window_seconds || ' seconds')::INTERVAL - v_now
    ))::integer;
    
    RETURN jsonb_build_object(
      'allowed', false,
      'retry_after', GREATEST(v_retry_after, 1) -- Mínimo de 1 segundo
    );
  END IF;
  
  v_filtered := v_filtered || to_jsonb(v_now);
  
  INSERT INTO rate_limits (key, requests, updated_at)
  VALUES (p_key, v_filtered, v_now)
  ON CONFLICT (key) DO UPDATE
  SET requests = v_filtered, updated_at = v_now;
  
  RETURN jsonb_build_object('allowed', true);
END;
$$;

COMMENT ON FUNCTION check_rate_limit IS 'Verifica o rate limit usando algoritmo de janela deslizante. Operação atômica, compartilhada entre todas as instâncias serverless.';


CREATE OR REPLACE FUNCTION cleanup_rate_limits()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  DELETE FROM rate_limits
  WHERE updated_at < NOW() - INTERVAL '1 hour';
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  RAISE NOTICE 'Cleaned up % rate limit entries older than 1 hour', v_deleted_count;
  
  RETURN v_deleted_count;
END;
$$;

COMMENT ON FUNCTION cleanup_rate_limits IS 'Remove registros de rate limit com mais de 1 hora. Deve ser chamada a cada hora via pg_cron ou cron externo.';


GRANT EXECUTE ON FUNCTION check_rate_limit TO authenticated, anon;

-- Apenas service_role pode chamar a função de limpeza
GRANT EXECUTE ON FUNCTION cleanup_rate_limits TO service_role;
