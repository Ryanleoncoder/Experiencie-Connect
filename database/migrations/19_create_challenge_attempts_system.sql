-- Propósito: Rastrear tentativas individuais por desafio com multiplicadores de XP


CREATE TABLE IF NOT EXISTS challenge_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL,
  level INTEGER NOT NULL,
  setor TEXT NOT NULL CHECK (setor IN ('CX', 'EX')),
  season_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  user_answer TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL,
  xp_earned INTEGER NOT NULL DEFAULT 0,
  time_taken_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT unique_user_challenge_attempt UNIQUE (user_id, challenge_id, attempt_number)
);

COMMENT ON TABLE challenge_attempts IS 'Rastreia tentativas individuais em desafios com multiplicadores de XP (100%, 70%, 40%). Exclusivo para desafios, não minigames.';
COMMENT ON COLUMN challenge_attempts.attempt_number IS 'Número da tentativa (1, 2 ou 3). 1ª tentativa = 100% XP, 2ª = 70%, 3ª = 40%';
COMMENT ON COLUMN challenge_attempts.xp_earned IS 'XP efetivamente ganho após aplicação do multiplicador';
COMMENT ON COLUMN challenge_attempts.time_taken_ms IS 'Tempo gasto para responder em milissegundos (para análise)';


CREATE INDEX IF NOT EXISTS idx_challenge_attempts_user_challenge 
ON challenge_attempts(user_id, challenge_id);

CREATE INDEX IF NOT EXISTS idx_challenge_attempts_user_level 
ON challenge_attempts(user_id, season_id, level, setor);

CREATE INDEX IF NOT EXISTS idx_challenge_attempts_season 
ON challenge_attempts(season_id, created_at);


CREATE OR REPLACE VIEW challenge_status AS
SELECT 
  user_id,
  challenge_id,
  level,
  setor,
  season_id,
  COUNT(*) AS attempts_used,
  MAX(is_correct::int)::boolean AS is_completed,
  SUM(xp_earned) AS total_xp,
  CASE 
    WHEN MAX(is_correct::int) = 1 THEN 'completed'
    WHEN COUNT(*) >= 3 AND MAX(is_correct::int) = 0 THEN 'failed'
    ELSE 'in_progress'
  END AS status,
  MAX(created_at) AS last_attempt_at
FROM challenge_attempts
GROUP BY user_id, challenge_id, level, setor, season_id;

COMMENT ON VIEW challenge_status IS 'Status agregado de desafios por usuário: completed, failed ou in_progress.';


CREATE OR REPLACE VIEW level_progress AS
SELECT 
  user_id,
  season_id,
  level,
  setor,
  COUNT(*) AS total_challenges,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
  SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress_count,
  SUM(total_xp) AS total_xp_earned,
  ROUND(
    (SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)::numeric / COUNT(*)::numeric) * 100,
    2
  ) AS completion_rate
FROM challenge_status
GROUP BY user_id, season_id, level, setor;

COMMENT ON VIEW level_progress IS 'Progresso agregado por nível: taxa de conclusão, XP acumulado e contagem de desafios.';

-- Políticas RLS: usuários acessam apenas suas próprias tentativas

ALTER TABLE challenge_attempts ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'challenge_attempts' 
    AND policyname = 'challenge_attempts_insert_own'
  ) THEN
    CREATE POLICY challenge_attempts_insert_own 
    ON challenge_attempts
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'challenge_attempts' 
    AND policyname = 'challenge_attempts_select_own'
  ) THEN
    CREATE POLICY challenge_attempts_select_own 
    ON challenge_attempts
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'challenge_attempts' 
    AND policyname = 'challenge_attempts_no_update'
  ) THEN
    CREATE POLICY challenge_attempts_no_update 
    ON challenge_attempts
    FOR UPDATE
    TO authenticated
    USING (false);
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'challenge_attempts' 
    AND policyname = 'challenge_attempts_no_delete'
  ) THEN
    CREATE POLICY challenge_attempts_no_delete 
    ON challenge_attempts
    FOR DELETE
    TO authenticated
    USING (false);
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'challenge_attempts' 
    AND policyname = 'challenge_attempts_service_role_all'
  ) THEN
    CREATE POLICY challenge_attempts_service_role_all 
    ON challenge_attempts
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
  END IF;
END $$;


CREATE OR REPLACE FUNCTION get_attempts_remaining(
  p_user_id UUID,
  p_challenge_id TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_attempts_used INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_attempts_used
  FROM challenge_attempts
  WHERE user_id = p_user_id
    AND challenge_id = p_challenge_id;
  
  RETURN GREATEST(0, 3 - v_attempts_used);
END;
$$;

COMMENT ON FUNCTION get_attempts_remaining IS 'Retorna o número de tentativas restantes (0-3) para um desafio.';

GRANT EXECUTE ON FUNCTION get_attempts_remaining TO authenticated, anon;


CREATE OR REPLACE FUNCTION calculate_xp_multiplier(
  p_attempt_number INTEGER
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE p_attempt_number
    WHEN 1 THEN 1.0   -- 100%
    WHEN 2 THEN 0.7   -- 70%
    WHEN 3 THEN 0.4   -- 40%
    ELSE 0.0
  END;
END;
$$;

COMMENT ON FUNCTION calculate_xp_multiplier IS 'Retorna o multiplicador de XP: 1ª tentativa=100%, 2ª=70%, 3ª=40%.';

GRANT EXECUTE ON FUNCTION calculate_xp_multiplier TO authenticated, anon;


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
    idempotency_key
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
    p_idempotency_key
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

COMMENT ON FUNCTION record_challenge_attempt IS 'Registra uma tentativa de desafio e retorna o resultado com XP e tentativas restantes. Suporta idempotência para evitar duplicações em erros de infraestrutura.';

GRANT EXECUTE ON FUNCTION record_challenge_attempt TO authenticated, anon;






