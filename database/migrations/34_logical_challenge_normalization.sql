

CREATE OR REPLACE FUNCTION public.normalize_challenge_id(p_challenge_id TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_challenge_id IS NULL THEN NULL
    WHEN trim(p_challenge_id) = '' THEN NULL
    WHEN trim(p_challenge_id) LIKE 'ig-%' THEN trim(p_challenge_id)
    ELSE regexp_replace(trim(p_challenge_id), '-v[0-9]+$', '')
  END;
$$;

COMMENT ON FUNCTION public.normalize_challenge_id(TEXT)
IS 'Retorna o id lógico do desafio. Sufixos de variante como -v1/-v2 são removidos; ids de intermission são preservados.';

CREATE OR REPLACE FUNCTION public.normalize_challenge_id_array(p_challenge_ids TEXT[])
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT normalized_id
      FROM (
        SELECT DISTINCT ON (normalized_id)
          normalized_id,
          ord
        FROM unnest(COALESCE(p_challenge_ids, ARRAY[]::TEXT[])) WITH ORDINALITY AS ids(raw_id, ord)
        CROSS JOIN LATERAL (
          SELECT public.normalize_challenge_id(raw_id) AS normalized_id
        ) normalized
        WHERE normalized_id IS NOT NULL
        ORDER BY normalized_id, ord
      ) deduped
      ORDER BY ord
    ),
    ARRAY[]::TEXT[]
  );
$$;

COMMENT ON FUNCTION public.normalize_challenge_id_array(TEXT[])
IS 'Normaliza e deduplica um array de ids de desafio preservando a ordem de primeira aparição.';


ALTER TABLE public.challenge_attempts
ADD COLUMN IF NOT EXISTS raw_challenge_id TEXT;

COMMENT ON COLUMN public.challenge_attempts.challenge_id IS
'Id lógico do desafio usado para leitura de progresso/status. Linhas antigas podem ainda conter ids de variante até serem sobrepostas.';

COMMENT ON COLUMN public.challenge_attempts.raw_challenge_id IS
'Id bruto original do desafio recebido pelo app/backend, preservado para histórico e diagnóstico.';

UPDATE public.challenge_attempts
SET raw_challenge_id = challenge_id
WHERE raw_challenge_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_challenge_attempts_user_logical
ON public.challenge_attempts (
  user_id,
  public.normalize_challenge_id(COALESCE(raw_challenge_id, challenge_id))
);


UPDATE public.user_progress
SET completed_challenges = public.normalize_challenge_id_array(completed_challenges)
WHERE completed_challenges IS NOT NULL;

UPDATE public.progress_history
SET new_challenges = public.normalize_challenge_id_array(new_challenges)
WHERE new_challenges IS NOT NULL;

UPDATE public.user_progress up
SET attempt_history = normalized.attempt_history
FROM (
  SELECT
    user_id,
    COALESCE(
      jsonb_agg(
        CASE
          WHEN jsonb_typeof(entry) = 'object' AND entry ? 'challenge_id' THEN
            jsonb_set(
              CASE
                WHEN entry ? 'raw_challenge_id' THEN entry
                ELSE entry || jsonb_build_object('raw_challenge_id', entry->>'challenge_id')
              END,
              '{challenge_id}',
              to_jsonb(public.normalize_challenge_id(entry->>'challenge_id')),
              true
            )
          ELSE entry
        END
        ORDER BY ord
      ),
      '[]'::jsonb
    ) AS attempt_history
  FROM public.user_progress
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(public.user_progress.attempt_history, '[]'::jsonb)) WITH ORDINALITY AS entries(entry, ord)
  GROUP BY user_id
) AS normalized
WHERE up.user_id = normalized.user_id;


CREATE OR REPLACE VIEW public.challenge_status AS
SELECT
  user_id,
  public.normalize_challenge_id(COALESCE(raw_challenge_id, challenge_id)) AS challenge_id,
  level,
  setor,
  season_id,
  COUNT(*) AS attempts_used,
  MAX(is_correct::INTEGER)::BOOLEAN AS is_completed,
  SUM(xp_earned) AS total_xp,
  CASE
    WHEN MAX(is_correct::INTEGER) = 1 THEN 'completed'
    WHEN COUNT(*) >= 3 AND MAX(is_correct::INTEGER) = 0 THEN 'failed'
    ELSE 'in_progress'
  END AS status,
  MAX(created_at) AS last_attempt_at
FROM public.challenge_attempts
GROUP BY
  user_id,
  public.normalize_challenge_id(COALESCE(raw_challenge_id, challenge_id)),
  level,
  setor,
  season_id;

COMMENT ON VIEW public.challenge_status IS
'Status lógico agregado de desafios por usuário. Ids de variante são mesclados em um único id lógico.';


CREATE OR REPLACE FUNCTION public.get_attempts_remaining(
  p_user_id UUID,
  p_challenge_id TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_logical_challenge_id TEXT := public.normalize_challenge_id(p_challenge_id);
  v_attempts_used INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_attempts_used
  FROM public.challenge_attempts
  WHERE user_id = p_user_id
    AND public.normalize_challenge_id(COALESCE(raw_challenge_id, challenge_id)) = v_logical_challenge_id;

  RETURN GREATEST(0, 3 - COALESCE(v_attempts_used, 0));
END;
$$;

COMMENT ON FUNCTION public.get_attempts_remaining(UUID, TEXT)
IS 'Retorna as tentativas lógicas restantes (0-3) para um desafio, mesclando ids de variante em um único desafio.';

GRANT EXECUTE ON FUNCTION public.get_attempts_remaining(UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.get_attempts_remaining(UUID, TEXT) FROM PUBLIC, anon, authenticated;


CREATE OR REPLACE FUNCTION public.get_user_flow_status(
  p_user_id UUID,
  p_season_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id cannot be null';
  END IF;

  IF p_season_id IS NULL OR trim(p_season_id) = '' THEN
    RAISE EXCEPTION 'season_id cannot be null';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  SELECT jsonb_build_object(
    'challenge_statuses',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'challenge_id', status_row.challenge_id,
            'status', status_row.status,
            'attempts_used', status_row.attempts_used,
            'level', status_row.level
          )
          ORDER BY status_row.level, status_row.challenge_id
        )
        FROM (
          SELECT challenge_id, status, attempts_used, level
          FROM public.challenge_status
          WHERE user_id = p_user_id
            AND season_id = p_season_id
        ) AS status_row
      ),
      '[]'::jsonb
    ),
    'intermission_statuses',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'challenge_id', session_row.challenge_id,
            'percent', session_row.percent,
            'completed_at', session_row.completed_at,
            'success', session_row.percent >= 60,
            'processed', true,
            'level', session_row.level
          )
          ORDER BY session_row.level, session_row.challenge_id
        )
        FROM (
          SELECT DISTINCT ON (challenge_id)
            challenge_id,
            percent,
            completed_at,
            level
          FROM public.intermission_game_sessions
          WHERE user_id = p_user_id
            AND season_id = p_season_id
          ORDER BY challenge_id, percent DESC, completed_at DESC
        ) AS session_row
      ),
      '[]'::jsonb
    )
  )
  INTO result;

  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.get_user_flow_status(UUID, TEXT)
IS 'Retorna o status lógico consolidado de desafios e intermission para um usuário e temporada.';

GRANT EXECUTE ON FUNCTION public.get_user_flow_status(UUID, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.get_user_flow_status(UUID, TEXT) FROM PUBLIC, anon, authenticated;


DROP FUNCTION IF EXISTS public.record_challenge_attempt(
  UUID,
  TEXT,
  INTEGER,
  TEXT,
  TEXT,
  TEXT,
  BOOLEAN,
  INTEGER,
  INTEGER,
  TEXT
);

CREATE OR REPLACE FUNCTION public.record_challenge_attempt(
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
SET search_path = public
AS $$
DECLARE
  v_existing RECORD;
  v_attempt_number INTEGER;
  v_attempt_multiplier NUMERIC;
  v_level_multiplier NUMERIC;
  v_xp_earned INTEGER;
  v_attempts_remaining INTEGER;
  v_status TEXT;
  v_xp_before INTEGER := 0;
  v_xp_after INTEGER := 0;
  v_attempt_entry JSONB;
  v_logical_challenge_id TEXT := public.normalize_challenge_id(p_challenge_id);
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id cannot be null';
  END IF;

  IF p_challenge_id IS NULL OR trim(p_challenge_id) = '' THEN
    RAISE EXCEPTION 'challenge_id cannot be null';
  END IF;

  IF v_logical_challenge_id IS NULL OR trim(v_logical_challenge_id) = '' THEN
    RAISE EXCEPTION 'logical challenge_id cannot be null';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT *
    INTO v_existing
    FROM public.challenge_attempts
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      v_attempts_remaining := GREATEST(0, 3 - v_existing.attempt_number);
      v_status := CASE
        WHEN v_existing.is_correct THEN 'completed'
        WHEN v_existing.attempt_number >= 3 THEN 'failed'
        ELSE 'in_progress'
      END;

      RETURN jsonb_build_object(
        'success', true,
        'challenge_id', public.normalize_challenge_id(COALESCE(v_existing.raw_challenge_id, v_existing.challenge_id)),
        'raw_challenge_id', COALESCE(v_existing.raw_challenge_id, v_existing.challenge_id),
        'attempt_number', v_existing.attempt_number,
        'is_correct', v_existing.is_correct,
        'xp_earned', v_existing.xp_earned,
        'xp_multiplier', calculate_xp_multiplier(v_existing.attempt_number),
        'level_multiplier', CASE v_existing.level WHEN 1 THEN 1.0 WHEN 2 THEN 1.5 WHEN 3 THEN 2.0 ELSE 1.0 END,
        'attempts_remaining', v_attempts_remaining,
        'status', v_status,
        'idempotent', true
      );
    END IF;
  END IF;

  SELECT *
  INTO v_existing
  FROM public.challenge_attempts
  WHERE user_id = p_user_id
    AND public.normalize_challenge_id(COALESCE(raw_challenge_id, challenge_id)) = v_logical_challenge_id
    AND is_correct = true
  ORDER BY created_at ASC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'challenge_id', v_logical_challenge_id,
      'raw_challenge_id', p_challenge_id,
      'attempt_number', v_existing.attempt_number,
      'is_correct', true,
      'xp_earned', 0,
      'xp_multiplier', 0,
      'level_multiplier', CASE v_existing.level WHEN 1 THEN 1.0 WHEN 2 THEN 1.5 WHEN 3 THEN 2.0 ELSE 1.0 END,
      'attempts_remaining', 0,
      'status', 'completed',
      'already_completed', true
    );
  END IF;

  SELECT COUNT(*) + 1
  INTO v_attempt_number
  FROM public.challenge_attempts
  WHERE user_id = p_user_id
    AND public.normalize_challenge_id(COALESCE(raw_challenge_id, challenge_id)) = v_logical_challenge_id;

  IF v_attempt_number > 3 THEN
    RETURN jsonb_build_object(
      'error', 'Maximum attempts (3) already used',
      'challenge_id', v_logical_challenge_id,
      'raw_challenge_id', p_challenge_id,
      'attempts_remaining', 0,
      'status', 'failed'
    );
  END IF;

  v_attempt_multiplier := calculate_xp_multiplier(v_attempt_number);
  v_level_multiplier := CASE p_level
    WHEN 1 THEN 1.0
    WHEN 2 THEN 1.5
    WHEN 3 THEN 2.0
    ELSE 1.0
  END;

  v_xp_earned := CASE
    WHEN p_is_correct THEN FLOOR(COALESCE(p_base_xp, 0) * v_level_multiplier * v_attempt_multiplier)
    ELSE 0
  END;

  INSERT INTO public.challenge_attempts (
    user_id,
    challenge_id,
    raw_challenge_id,
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
    v_logical_challenge_id,
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
  v_status := CASE
    WHEN p_is_correct THEN 'completed'
    WHEN v_attempts_remaining = 0 THEN 'failed'
    ELSE 'in_progress'
  END;

  SELECT COALESCE(xp, 0)
  INTO v_xp_before
  FROM public.user_progress
  WHERE user_id = p_user_id
  FOR UPDATE;

  IF v_xp_before IS NULL THEN
    v_xp_before := 0;
  END IF;

  v_attempt_entry := jsonb_build_object(
    'challenge_id', v_logical_challenge_id,
    'raw_challenge_id', p_challenge_id,
    'timestamp', NOW(),
    'correct', p_is_correct,
    'time_used', p_time_taken_ms,
    'score', v_xp_earned
  );

  INSERT INTO public.user_progress (
    user_id,
    xp,
    level,
    completed_challenges,
    completed_minigames,
    attempt_history
  ) VALUES (
    p_user_id,
    v_xp_earned,
    FLOOR(v_xp_earned::NUMERIC / 500) + 1,
    CASE WHEN p_is_correct THEN ARRAY[v_logical_challenge_id] ELSE ARRAY[]::TEXT[] END,
    ARRAY[]::TEXT[],
    jsonb_build_array(v_attempt_entry)
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    xp = public.user_progress.xp + EXCLUDED.xp,
    level = FLOOR((public.user_progress.xp + EXCLUDED.xp)::NUMERIC / 500) + 1,
    completed_challenges = CASE
      WHEN p_is_correct THEN public.normalize_challenge_id_array(public.user_progress.completed_challenges || ARRAY[v_logical_challenge_id])
      ELSE public.user_progress.completed_challenges
    END,
    attempt_history = public.user_progress.attempt_history || jsonb_build_array(v_attempt_entry),
    updated_at = NOW()
  RETURNING xp INTO v_xp_after;

  INSERT INTO public.progress_history (
    user_id,
    sync_type,
    xp_before,
    xp_after,
    xp_delta,
    new_challenges,
    new_minigames
  ) VALUES (
    p_user_id,
    'attempt',
    v_xp_before,
    v_xp_after,
    v_xp_earned,
    CASE WHEN p_is_correct THEN ARRAY[v_logical_challenge_id] ELSE ARRAY[]::TEXT[] END,
    ARRAY[]::TEXT[]
  );

  RETURN jsonb_build_object(
    'success', true,
    'challenge_id', v_logical_challenge_id,
    'raw_challenge_id', p_challenge_id,
    'attempt_number', v_attempt_number,
    'is_correct', p_is_correct,
    'xp_earned', v_xp_earned,
    'xp_multiplier', v_attempt_multiplier,
    'level_multiplier', v_level_multiplier,
    'attempts_remaining', v_attempts_remaining,
    'status', v_status
  );
END;
$$;

COMMENT ON FUNCTION public.record_challenge_attempt(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, TEXT) IS
'Records a challenge attempt using the logical challenge id for progress/status and preserves the raw challenge id for history.';

GRANT EXECUTE ON FUNCTION public.record_challenge_attempt(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.record_challenge_attempt(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
