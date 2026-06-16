-- Propósito: Atualizar a função RPC record_challenge_attempt para suportar idempotência corretamente


DROP FUNCTION IF EXISTS public.record_challenge_attempt(
  p_user_id UUID,
  p_challenge_id TEXT,
  p_level INTEGER,
  p_setor TEXT,
  p_season_id TEXT,
  p_user_answer TEXT,
  p_is_correct BOOLEAN,
  p_base_xp INTEGER,
  p_time_taken_ms INTEGER
);

CREATE OR REPLACE FUNCTION record_challenge_attempt(
  p_user_id UUID,
  p_challenge_id TEXT,
  p_level INTEGER,
  p_setor TEXT,
  p_season_id TEXT,
  p_user_answer TEXT,
  p_is_correct BOOLEAN,
  p_base_xp INTEGER,
  p_time_taken_ms INTEGER DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_attempt_number INTEGER;
  v_xp_multiplier NUMERIC;
  v_xp_earned INTEGER;
  v_attempts_remaining INTEGER;
  v_status TEXT;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    PERFORM 1 FROM challenge_attempts 
    WHERE idempotency_key = p_idempotency_key;
    
    IF FOUND THEN
      RAISE EXCEPTION 'Duplicate idempotency key: %', p_idempotency_key
        USING ERRCODE = '23505'; -- violação de unicidade
    END IF;
  END IF;
  
  SELECT COUNT(*) + 1
  INTO v_attempt_number
  FROM challenge_attempts
  WHERE user_id = p_user_id
    AND challenge_id = p_challenge_id;
  
  IF v_attempt_number > 3 THEN
    RETURN jsonb_build_object(
      'error', 'Maximum attempts (3) already used',
      'attempts_remaining', 0,
      'status', 'failed'
    );
  END IF;
  
  v_xp_multiplier := calculate_xp_multiplier(v_attempt_number);
  
  v_xp_earned := CASE 
    WHEN p_is_correct THEN FLOOR(p_base_xp * v_xp_multiplier)
    ELSE 0
  END;
  
  INSERT INTO challenge_attempts (
    user_id,
    challenge_id,
    level,
    setor,
    season_id,
    attempt_number,
    user_answer,
    is_correct,
    xp_earned,
    time_taken_ms,
    idempotency_key  -- CRÍTICO: incluir a chave de idempotência no INSERT
  ) VALUES (
    p_user_id,
    p_challenge_id,
    p_level,
    p_setor,
    p_season_id,
    v_attempt_number,
    p_user_answer,
    p_is_correct,
    v_xp_earned,
    p_time_taken_ms,
    p_idempotency_key  -- Pode ser NULL para compatibilidade com registros antigos
  );
  
  v_attempts_remaining := 3 - v_attempt_number;
  
  IF p_is_correct THEN
    v_status := 'completed';
  ELSIF v_attempts_remaining = 0 THEN
    v_status := 'failed';
  ELSE
    v_status := 'in_progress';
  END IF;
  
  RETURN jsonb_build_object(
    'success', true,
    'attempt_number', v_attempt_number,
    'is_correct', p_is_correct,
    'xp_earned', v_xp_earned,
    'xp_multiplier', v_xp_multiplier,
    'attempts_remaining', v_attempts_remaining,
    'status', v_status
  );
END;
$$;


COMMENT ON FUNCTION record_challenge_attempt IS 
'Records a challenge attempt and returns result with XP and attempts remaining. 
Supports idempotency via p_idempotency_key parameter to prevent duplicate attempts 
during infrastructure errors (500, 503, timeouts). Raises unique_violation (23505) 
if duplicate key is detected. Backward compatible - NULL key is allowed.';


GRANT EXECUTE ON FUNCTION record_challenge_attempt TO authenticated, anon;





-- Chamada com chave NULL funciona normalmente (retrocompatível)
