
CREATE TABLE IF NOT EXISTS public.intermission_game_sessions (
  session_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  minigame_id TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 3),
  setor TEXT NOT NULL CHECK (setor IN ('CX', 'EX')),
  season_id TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  max_score INTEGER NOT NULL DEFAULT 0,
  percent INTEGER NOT NULL DEFAULT 0 CHECK (percent BETWEEN 0 AND 100),
  xp_earned INTEGER NOT NULL DEFAULT 0 CHECK (xp_earned >= 0),
  result JSONB NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL UNIQUE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT unique_intermission_user_challenge UNIQUE (user_id, challenge_id)
);

CREATE INDEX IF NOT EXISTS idx_intermission_game_sessions_user_level
ON public.intermission_game_sessions(user_id, season_id, level, setor);

REVOKE ALL ON TABLE public.intermission_game_sessions FROM PUBLIC, anon, authenticated;

ALTER TABLE public.intermission_game_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'intermission_game_sessions'
      AND policyname = 'intermission_game_sessions_select_own'
  ) THEN
    CREATE POLICY intermission_game_sessions_select_own
    ON public.intermission_game_sessions
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'intermission_game_sessions'
      AND policyname = 'intermission_game_sessions_service_role_all'
  ) THEN
    CREATE POLICY intermission_game_sessions_service_role_all
    ON public.intermission_game_sessions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.complete_intermission_game(
  p_user_id UUID,
  p_session_id TEXT,
  p_game_id TEXT,
  p_challenge_id TEXT,
  p_minigame_id TEXT,
  p_level INTEGER,
  p_setor TEXT,
  p_season_id TEXT,
  p_score INTEGER,
  p_max_score INTEGER,
  p_percent INTEGER,
  p_xp_earned INTEGER,
  p_result JSONB,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  existing_session public.intermission_game_sessions%ROWTYPE;
  progress_result JSONB;
  old_xp INTEGER;
  new_xp INTEGER;
  attempt_entry JSONB;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id cannot be null';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'User not found';
  END IF;

  SELECT *
  INTO existing_session
  FROM public.intermission_game_sessions
  WHERE session_id = p_session_id
     OR idempotency_key = p_idempotency_key
     OR (user_id = p_user_id AND challenge_id = p_challenge_id)
  LIMIT 1;

  IF FOUND THEN
    SELECT jsonb_build_object(
      'success', true,
      'idempotent', true,
      'xp', xp,
      'level', level,
      'completed_challenges', completed_challenges,
      'completed_minigames', completed_minigames,
      'updated_at', updated_at
    )
    INTO progress_result
    FROM public.user_progress
    WHERE user_id = p_user_id;

    RETURN COALESCE(progress_result, jsonb_build_object(
      'success', true,
      'idempotent', true,
      'xp', 0,
      'level', 1,
      'completed_challenges', ARRAY[]::TEXT[],
      'completed_minigames', ARRAY[]::TEXT[]
    ));
  END IF;

  INSERT INTO public.intermission_game_sessions (
    session_id,
    user_id,
    game_id,
    challenge_id,
    minigame_id,
    level,
    setor,
    season_id,
    score,
    max_score,
    percent,
    xp_earned,
    result,
    idempotency_key
  )
  VALUES (
    p_session_id,
    p_user_id,
    p_game_id,
    p_challenge_id,
    p_minigame_id,
    p_level,
    p_setor,
    p_season_id,
    GREATEST(0, p_score),
    GREATEST(0, p_max_score),
    LEAST(100, GREATEST(0, p_percent)),
    GREATEST(0, p_xp_earned),
    COALESCE(p_result, '{}'::jsonb),
    p_idempotency_key
  );

  attempt_entry := jsonb_build_object(
    'challenge_id', p_challenge_id,
    'minigame_id', p_minigame_id,
    'game_id', p_game_id,
    'timestamp', NOW(),
    'correct', true,
    'intermission_game', true,
    'score', GREATEST(0, p_score),
    'max_score', GREATEST(0, p_max_score),
    'percent', LEAST(100, GREATEST(0, p_percent)),
    'xp_earned', GREATEST(0, p_xp_earned)
  );

  SELECT xp INTO old_xp
  FROM public.user_progress
  WHERE user_id = p_user_id;

  INSERT INTO public.user_progress (
    user_id,
    xp,
    level,
    completed_challenges,
    completed_minigames,
    attempt_history
  )
  VALUES (
    p_user_id,
    GREATEST(0, p_xp_earned),
    FLOOR(GREATEST(0, p_xp_earned) / 500.0) + 1,
    ARRAY[p_challenge_id],
    ARRAY[p_minigame_id],
    jsonb_build_array(attempt_entry)
  )
  ON CONFLICT (user_id) DO UPDATE SET
    xp = user_progress.xp + GREATEST(0, p_xp_earned),
    level = FLOOR((user_progress.xp + GREATEST(0, p_xp_earned)) / 500.0) + 1,
    completed_challenges = ARRAY(
      SELECT DISTINCT unnest(user_progress.completed_challenges || ARRAY[p_challenge_id])
    ),
    completed_minigames = ARRAY(
      SELECT DISTINCT unnest(user_progress.completed_minigames || ARRAY[p_minigame_id])
    ),
    attempt_history = (
      SELECT jsonb_agg(elem ORDER BY (elem->>'timestamp') DESC)
      FROM (
        SELECT elem
        FROM jsonb_array_elements(user_progress.attempt_history || jsonb_build_array(attempt_entry)) elem
        LIMIT 100
      ) sub
    ),
    updated_at = NOW()
  RETURNING xp INTO new_xp;

  IF old_xp IS NULL THEN
    old_xp := 0;
  END IF;

  INSERT INTO public.progress_history (
    user_id,
    sync_type,
    xp_before,
    xp_after,
    xp_delta,
    new_challenges,
    new_minigames
  )
  VALUES (
    p_user_id,
    'delta',
    old_xp,
    new_xp,
    GREATEST(0, p_xp_earned),
    ARRAY[p_challenge_id],
    ARRAY[p_minigame_id]
  );

  SELECT jsonb_build_object(
    'success', true,
    'idempotent', false,
    'xp', xp,
    'level', level,
    'completed_challenges', completed_challenges,
    'completed_minigames', completed_minigames,
    'updated_at', updated_at
  )
  INTO progress_result
  FROM public.user_progress
  WHERE user_id = p_user_id;

  RETURN progress_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_intermission_game(
  UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, JSONB, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.complete_intermission_game(
  UUID, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, JSONB, TEXT
) TO service_role;
