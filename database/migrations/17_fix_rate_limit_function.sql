-- Esta migração corrige a função check_rate_limit para retornar também o contador atual de requisições

DROP FUNCTION IF EXISTS check_rate_limit(TEXT, INTEGER, INTEGER);

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
      'current_requests', v_count + 1,
      'retry_after', GREATEST(v_retry_after, 1) -- Mínimo de 1 segundo
    );
  END IF;
  
  v_filtered := v_filtered || to_jsonb(v_now);
  
  INSERT INTO rate_limits (key, requests, updated_at)
  VALUES (p_key, v_filtered, v_now)
  ON CONFLICT (key) DO UPDATE
  SET requests = v_filtered, updated_at = v_now;
  
  RETURN jsonb_build_object(
    'allowed', true,
    'current_requests', v_count + 1
  );
END;
$$;

COMMENT ON FUNCTION check_rate_limit IS 'Verifica o rate limit usando janela deslizante. Retorna status de permissão, contador atual de requisições e retry_after quando bloqueado.';

GRANT EXECUTE ON FUNCTION check_rate_limit TO authenticated, anon;
