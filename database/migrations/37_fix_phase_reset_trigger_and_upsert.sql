-- Migration 37 — corrige 2 achados da review (Codex) na PR #39.
-- P1: o trigger de reset cancelava a phase num ERRO de resposta normal (xp=0 + arrays vazios).
-- P2: phase_session_id UNIQUE impedia recriar phase active depois de uma row cancelled/completed
--     com o mesmo id deterministico -> ficava sem row active (so Redis ate expirar).
-- Idempotente: CREATE OR REPLACE + DROP/CREATE TRIGGER. Rodar no SQL Editor do Supabase.

-- ============================================================
-- P1 — TRIGGER so dispara em RESET REAL (transicao: OLD tinha progresso, NEW zerado).
-- Antes: qualquer UPDATE com xp=0 + arrays vazios disparava (inclui 1o erro de resposta,
-- que mantem xp=0 e arrays vazios). Agora exige que OLD tivesse progresso.
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

-- ============================================================
-- P2 — upsert_phase_session: no unique_violation, se o conflito for de uma row INATIVA
-- (cancelled/completed) com o mesmo phase_session_id deterministico, REATIVA essa row
-- (volta a active, manifest/seed/expires atualizados) em vez de devolver a row inativa.
-- Seguro: so chega aqui depois de confirmar que NAO ha active (passo 1 e 3a deram null),
-- entao o indice unico parcial (where status='active') nao e violado.
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

  -- 2. Tenta inserir. Em corrida/colisao de id, cai no catch.
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

    -- 3b. Conflito veio do unique(phase_session_id) de uma row INATIVA
    -- (cancelled/completed) com o mesmo id deterministico: REATIVA a row.
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

REVOKE EXECUTE ON FUNCTION public.upsert_phase_session(uuid, text, int, text, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.upsert_phase_session(uuid, text, int, text, text, jsonb, timestamptz) TO service_role;
