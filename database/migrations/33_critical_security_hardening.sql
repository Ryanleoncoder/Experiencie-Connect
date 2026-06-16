

ALTER TABLE public.usuarios
ADD COLUMN IF NOT EXISTS display_name TEXT,
ADD COLUMN IF NOT EXISTS ranking_code TEXT,
ADD COLUMN IF NOT EXISTS hide_public_name BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.derive_public_display_name(p_nickname TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_raw TEXT := trim(COALESCE(p_nickname, ''));
  v_base TEXT;
BEGIN
  IF v_raw = '' THEN
    RETURN 'Agente EC';
  END IF;

  IF position('_' in v_raw) > 1 THEN
    v_base := split_part(v_raw, '_', 1);
  ELSIF v_raw ~* 'cx$' AND length(v_raw) > 2 THEN
    v_base := regexp_replace(v_raw, 'cx$', '', 'i');
  ELSIF v_raw ~ '\d{4}$' AND length(v_raw) > 4 THEN
    v_base := regexp_replace(v_raw, '\d{4}$', '');
  ELSE
    v_base := v_raw;
  END IF;

  v_base := trim(v_base);
  IF v_base = '' THEN
    RETURN 'Agente EC';
  END IF;

  RETURN v_base;
END;
$$;

WITH candidate_users AS (
  SELECT
    id,
    nickname,
    ROW_NUMBER() OVER (ORDER BY criado_em NULLS LAST, id) AS rn,
    public.derive_public_display_name(nickname::TEXT) AS base_display
  FROM public.usuarios
  WHERE display_name IS NULL OR trim(display_name) = ''
     OR ranking_code IS NULL OR trim(ranking_code) = ''
),
numbered_users AS (
  SELECT
    *,
    ROW_NUMBER() OVER (PARTITION BY LOWER(base_display) ORDER BY rn) AS display_ord
  FROM candidate_users
)
UPDATE public.usuarios u
SET
  ranking_code = COALESCE(NULLIF(trim(u.ranking_code), ''), 'user' || (1000 + numbered_users.rn)::text),
  display_name = COALESCE(
    NULLIF(trim(u.display_name), ''),
    numbered_users.base_display || CASE WHEN numbered_users.display_ord = 1 THEN '' ELSE numbered_users.display_ord::TEXT END
  )
FROM numbered_users
WHERE u.id = numbered_users.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_display_name_unique
ON public.usuarios (LOWER(display_name))
WHERE display_name IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_usuarios_ranking_code_unique
ON public.usuarios (LOWER(ranking_code))
WHERE ranking_code IS NOT NULL;

COMMENT ON COLUMN public.usuarios.display_name IS
'Rótulo público de exibição (não sensível) usado no ranking e na UI. O nickname interno permanece privado.';

COMMENT ON COLUMN public.usuarios.ranking_code IS
'Código público estável (não sensível) para identificar o usuário no ranking público sem expor UUID ou nickname.';

COMMENT ON COLUMN public.usuarios.hide_public_name IS
'Quando true, o ranking público e APIs voltadas à UI devem substituir display_name por "Agente secreto". Previsto para um painel de privacidade futuro.';

CREATE OR REPLACE FUNCTION public.set_default_public_ranking_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_candidate TEXT;
  v_number TEXT;
  v_base_display TEXT;
  v_display_suffix INTEGER := 1;
BEGIN
  IF NEW.ranking_code IS NULL OR trim(NEW.ranking_code) = '' THEN
    LOOP
      v_number := lpad(((floor(random() * 9000) + 1000)::int)::text, 4, '0');
      v_candidate := 'user' || v_number;
      EXIT WHEN NOT EXISTS (
        SELECT 1
        FROM public.usuarios
        WHERE LOWER(ranking_code) = LOWER(v_candidate)
      );
    END LOOP;

    NEW.ranking_code := v_candidate;
  END IF;

  IF NEW.display_name IS NULL OR trim(NEW.display_name) = '' THEN
    v_base_display := public.derive_public_display_name(NEW.nickname::TEXT);
    v_candidate := v_base_display;

    WHILE EXISTS (
      SELECT 1
      FROM public.usuarios
      WHERE LOWER(display_name) = LOWER(v_candidate)
    ) LOOP
      v_display_suffix := v_display_suffix + 1;
      v_candidate := v_base_display || v_display_suffix::TEXT;
    END LOOP;

    NEW.display_name := v_candidate;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_default_display_name ON public.usuarios;
DROP TRIGGER IF EXISTS trg_set_default_public_ranking_identity ON public.usuarios;
CREATE TRIGGER trg_set_default_public_ranking_identity
BEFORE INSERT ON public.usuarios
FOR EACH ROW
EXECUTE FUNCTION public.set_default_public_ranking_identity();


DROP FUNCTION IF EXISTS public.get_current_ranking();
DROP FUNCTION IF EXISTS public.get_current_ranking_public();

CREATE OR REPLACE FUNCTION public.get_current_ranking_public()
RETURNS TABLE(
  rank INTEGER,
  ranking_code TEXT,
  display_name TEXT,
  xp INTEGER,
  level INTEGER,
  avatar_file_name TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH ranked_users AS (
    SELECT
      COALESCE(NULLIF(trim(u.ranking_code), ''), 'user' || ROW_NUMBER() OVER (ORDER BY up.xp DESC, up.level DESC, up.updated_at ASC)::text)::TEXT AS public_code,
      CASE
        WHEN u.hide_public_name THEN 'Agente secreto'
        ELSE COALESCE(NULLIF(trim(u.display_name), ''), public.derive_public_display_name(u.nickname::TEXT))
      END::TEXT AS public_name,
      up.xp,
      up.level,
      u.avatar_file_name::TEXT AS avatar_file_name,
      ROW_NUMBER() OVER (ORDER BY up.xp DESC, up.level DESC, up.updated_at ASC) AS user_rank
    FROM public.user_progress up
    INNER JOIN public.usuarios u ON up.user_id = u.id
    ORDER BY up.xp DESC, up.level DESC, up.updated_at ASC
    LIMIT 500
  )
  SELECT
    ranked_users.user_rank::INTEGER AS rank,
    ranked_users.public_code AS ranking_code,
    ranked_users.public_name AS display_name,
    ranked_users.xp,
    ranked_users.level,
    ranked_users.avatar_file_name
  FROM ranked_users;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_current_ranking()
RETURNS TABLE(
  rank INTEGER,
  ranking_code TEXT,
  display_name TEXT,
  xp INTEGER,
  level INTEGER,
  avatar_file_name TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.get_current_ranking_public();
$$;

COMMENT ON FUNCTION public.get_current_ranking_public() IS
'Ranking público sanitizado. Expõe apenas ranking_code e display_name; não expõe user_id, UUID, nickname, e-mail nem tokens.';

COMMENT ON FUNCTION public.get_current_ranking() IS
'Wrapper legado do ranking sanitizado. Expõe apenas ranking_code e display_name; não expõe user_id, UUID, nickname, e-mail nem tokens.';

GRANT EXECUTE ON FUNCTION public.get_current_ranking_public() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_current_ranking() TO anon, authenticated, service_role;


ALTER TABLE public.security_logs
ADD COLUMN IF NOT EXISTS ip_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_security_logs_ip_hash
ON public.security_logs(ip_hash);

COMMENT ON COLUMN public.security_logs.ip IS
'Coluna de compatibilidade legada. A aplicação deve inserir NULL e usar ip_hash.';

COMMENT ON COLUMN public.security_logs.ip_hash IS
'Hash HMAC/SHA-256 do IP do cliente, gerado pelo backend com IP_HASH_SECRET.';


ALTER TABLE public.progress_history
DROP CONSTRAINT IF EXISTS progress_history_sync_type_check;

ALTER TABLE public.progress_history
ADD CONSTRAINT progress_history_sync_type_check
CHECK (sync_type IN ('delta', 'full', 'attempt'));


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
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id cannot be null';
  END IF;

  IF p_challenge_id IS NULL OR trim(p_challenge_id) = '' THEN
    RAISE EXCEPTION 'challenge_id cannot be null';
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
    AND challenge_id = p_challenge_id
    AND is_correct = true
  ORDER BY created_at ASC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
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
    AND challenge_id = p_challenge_id;

  IF v_attempt_number > 3 THEN
    RETURN jsonb_build_object(
      'error', 'Maximum attempts (3) already used',
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
    'challenge_id', p_challenge_id,
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
    FLOOR(v_xp_earned::numeric / 500) + 1,
    CASE WHEN p_is_correct THEN ARRAY[p_challenge_id] ELSE ARRAY[]::TEXT[] END,
    ARRAY[]::TEXT[],
    jsonb_build_array(v_attempt_entry)
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    xp = public.user_progress.xp + EXCLUDED.xp,
    level = FLOOR((public.user_progress.xp + EXCLUDED.xp)::numeric / 500) + 1,
    completed_challenges = CASE
      WHEN p_is_correct THEN (
        SELECT COALESCE(array_agg(DISTINCT completed_id), ARRAY[]::TEXT[])
        FROM unnest(public.user_progress.completed_challenges || ARRAY[p_challenge_id]) AS completed_id
      )
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
    CASE WHEN p_is_correct THEN ARRAY[p_challenge_id] ELSE ARRAY[]::TEXT[] END,
    ARRAY[]::TEXT[]
  );

  RETURN jsonb_build_object(
    'success', true,
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
'Records a challenge attempt and atomically updates user_progress/progress_history. Intended for backend/service role only.';

GRANT EXECUTE ON FUNCTION public.record_challenge_attempt(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.record_challenge_attempt(UUID, TEXT, INTEGER, TEXT, TEXT, TEXT, BOOLEAN, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;


REVOKE ALL ON TABLE public.challenge_status FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.level_progress FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.invite_token FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS "Allow anon to read invites for validation" ON public.invite_token;
DROP POLICY IF EXISTS "Anonymous users can read invites for validation" ON public.invite_token;

DO $$
BEGIN
  IF to_regprocedure('public.sync_progress_delta(uuid, integer, text[], text[], jsonb)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.sync_progress_delta(UUID, INTEGER, TEXT[], TEXT[], JSONB) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.sync_progress_delta(UUID, INTEGER, TEXT[], TEXT[], JSONB) TO service_role';
  END IF;

  IF to_regprocedure('public.sync_progress_full(uuid, integer, integer, text[], text[], jsonb)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.sync_progress_full(UUID, INTEGER, INTEGER, TEXT[], TEXT[], JSONB) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.sync_progress_full(UUID, INTEGER, INTEGER, TEXT[], TEXT[], JSONB) TO service_role';
  END IF;

  IF to_regprocedure('public.get_user_progress(uuid)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_user_progress(UUID) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_user_progress(UUID) TO service_role';
  END IF;

  IF to_regprocedure('public.get_user_flow_status(uuid, text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_user_flow_status(UUID, TEXT) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_user_flow_status(UUID, TEXT) TO service_role';
  END IF;

  IF to_regprocedure('public.get_attempts_remaining(uuid, text)') IS NOT NULL THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.get_attempts_remaining(UUID, TEXT) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_attempts_remaining(UUID, TEXT) TO service_role';
  END IF;
END $$;

-- Clientes do browser podem chamar apenas o ranking público sanitizado.
GRANT EXECUTE ON FUNCTION public.get_current_ranking_public() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_ranking() TO anon, authenticated;
