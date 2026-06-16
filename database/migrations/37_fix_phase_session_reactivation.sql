-- Migration 37 - phase_sessions: reset trigger guard + deterministic id reactivation.
-- Fixes:
-- 1. A normal wrong answer at zero progress must not cancel the active phase.
-- 2. A cancelled/completed deterministic phase_session_id can be reactivated safely.

-- ============================================================
-- RPC: upsert_phase_session
-- Replaces only the unique_violation recovery behavior from migration 36.
-- ============================================================
CREATE OR REPLACE FUNCTION public.upsert_phase_session(
  p_user_id          uuid,
  p_season_id        text,
  p_level            int,
  p_phase_session_id text,
  p_phase_seed       text,
  p_manifest_json    jsonb,
  p_expires_at       timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_season text := COALESCE(p_season_id, 'default');
  result jsonb;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id cannot be null';
  END IF;

  -- 1. Ja existe active? retorna ela (idempotente).
  SELECT to_jsonb(ps) INTO result
  FROM public.phase_sessions ps
  WHERE ps.user_id = p_user_id AND ps.season_id = v_season
    AND ps.level = p_level AND ps.status = 'active'
  ORDER BY ps.created_at DESC
  LIMIT 1;

  IF result IS NOT NULL THEN
    RETURN result;
  END IF;

  -- 2. Tenta inserir. Em corrida (outro request criou primeiro), cai no catch.
  BEGIN
    INSERT INTO public.phase_sessions (
      user_id, season_id, level, phase_session_id, phase_seed, manifest_json, status, expires_at
    )
    VALUES (
      p_user_id, v_season, p_level, p_phase_session_id, p_phase_seed, p_manifest_json, 'active', p_expires_at
    )
    RETURNING to_jsonb(phase_sessions) INTO result;

    RETURN result;
  EXCEPTION WHEN unique_violation THEN
    -- 3a. Corrida: outro request criou a active. Retorna ela.
    SELECT to_jsonb(ps) INTO result
    FROM public.phase_sessions ps
    WHERE ps.user_id = p_user_id AND ps.season_id = v_season
      AND ps.level = p_level AND ps.status = 'active'
    ORDER BY ps.created_at DESC
    LIMIT 1;

    IF result IS NOT NULL THEN
      RETURN result;
    END IF;

    -- 3b. Conflito veio do unique(phase_session_id) de uma row inativa
    -- com o mesmo id deterministico: reativa a row.
    UPDATE public.phase_sessions
    SET status        = 'active',
        manifest_json = p_manifest_json,
        phase_seed    = p_phase_seed,
        expires_at    = p_expires_at,
        completed_at  = NULL,
        updated_at    = now()
    WHERE phase_session_id = p_phase_session_id
    RETURNING to_jsonb(phase_sessions) INTO result;

    RETURN result;
  END;
END;
$$;

-- ============================================================
-- TRIGGER: cancel phases only on a real progress reset transition.
-- Wrong answers at already-zero progress update attempt_history only and must not cancel.
-- ============================================================
DROP TRIGGER IF EXISTS trg_cancel_phases_on_progress_reset ON public.user_progress;
CREATE TRIGGER trg_cancel_phases_on_progress_reset
AFTER UPDATE ON public.user_progress
FOR EACH ROW
WHEN (
  NEW.xp = 0
  AND NEW.completed_challenges = '{}'::text[]
  AND NEW.completed_minigames = '{}'::text[]
  AND (
    OLD.xp > 0
    OR OLD.completed_challenges <> '{}'::text[]
    OR OLD.completed_minigames <> '{}'::text[]
  )
)
EXECUTE FUNCTION public.cancel_phases_on_progress_reset();

-- Keep the RPC service-role only, matching migration 36.
REVOKE EXECUTE ON FUNCTION public.upsert_phase_session(uuid, text, int, text, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.upsert_phase_session(uuid, text, int, text, text, jsonb, timestamptz) TO service_role;
