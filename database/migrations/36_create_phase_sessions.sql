-- Migration 36 — phase_sessions: ordem autoritativa da phase persistida no Supabase.
-- A VPS gera a ordem 1x e persiste aqui; Redis vira apenas cache (reidrata daqui no miss).
-- Fonte de verdade da ordem dos desafios por usuario/nivel/temporada.

-- ============================================================
-- TABELA
-- ============================================================
CREATE TABLE IF NOT EXISTS public.phase_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  season_id         text NOT NULL DEFAULT 'default',
  level             int  NOT NULL CHECK (level IN (1, 2, 3)),
  phase_session_id  text NOT NULL UNIQUE,
  phase_seed        text NOT NULL,
  manifest_json     jsonb NOT NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired', 'cancelled')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz,           -- default NULL: phase nao auto-expira (ciclo por status + trigger)
  completed_at      timestamptz,

  CONSTRAINT phase_sessions_manifest_not_empty
    CHECK (manifest_json <> '{}'::jsonb AND jsonb_array_length(manifest_json->'nodes') > 0)
);

-- ============================================================
-- INDICES
-- ============================================================
-- Garante no maximo 1 phase ACTIVE por (user, season, level). Index parcial:
-- por isso o upsert usa SELECT->INSERT->catch (nao ON CONFLICT).
CREATE UNIQUE INDEX IF NOT EXISTS uq_phase_sessions_active
  ON public.phase_sessions (user_id, level, season_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_phase_sessions_user_level_status
  ON public.phase_sessions (user_id, level, status);

-- ============================================================
-- RLS (apenas service-role; sem anon/authenticated) — espelha migration 28
-- ============================================================
REVOKE ALL ON TABLE public.phase_sessions FROM PUBLIC, anon, authenticated;

ALTER TABLE public.phase_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'phase_sessions'
      AND policyname = 'phase_sessions_service_role_all'
  ) THEN
    CREATE POLICY phase_sessions_service_role_all
    ON public.phase_sessions
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
  END IF;
END $$;

-- ============================================================
-- RPC: get_active_phase_session — retorna a phase active (ou NULL)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_active_phase_session(
  p_user_id   uuid,
  p_season_id text,
  p_level     int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT to_jsonb(ps) INTO result
  FROM public.phase_sessions ps
  WHERE ps.user_id = p_user_id
    AND ps.season_id = COALESCE(p_season_id, 'default')
    AND ps.level = p_level
    AND ps.status = 'active'
  ORDER BY ps.created_at DESC
  LIMIT 1;

  RETURN result; -- NULL se nao houver active
END;
$$;

-- ============================================================
-- RPC: upsert_phase_session — idempotente e race-safe (SELECT -> INSERT -> catch)
-- Nao usa ON CONFLICT por causa do indice unico PARCIAL (where status='active').
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
    -- 3. Outro request ja inseriu a active (ou o phase_session_id ja existe). Re-seleciona e retorna.
    SELECT to_jsonb(ps) INTO result
    FROM public.phase_sessions ps
    WHERE ps.user_id = p_user_id AND ps.season_id = v_season
      AND ps.level = p_level AND ps.status = 'active'
    ORDER BY ps.created_at DESC
    LIMIT 1;

    IF result IS NULL THEN
      -- conflito veio do unique(phase_session_id) de uma row nao-active: devolve por id.
      SELECT to_jsonb(ps) INTO result
      FROM public.phase_sessions ps
      WHERE ps.phase_session_id = p_phase_session_id
      LIMIT 1;
    END IF;

    RETURN result;
  END;
END;
$$;

-- ============================================================
-- RPC: complete_phase_session — marca completed (SO a active). Chamar ao fim do NIVEL inteiro.
-- ============================================================
CREATE OR REPLACE FUNCTION public.complete_phase_session(
  p_user_id   uuid,
  p_season_id text,
  p_level     int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.phase_sessions
  SET status = 'completed', completed_at = now(), updated_at = now()
  WHERE user_id = p_user_id
    AND season_id = COALESCE(p_season_id, 'default')
    AND level = p_level
    AND status = 'active';   -- filtro 'active' evita tocar phase antiga/completed

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('success', true, 'completed', v_count);
END;
$$;

-- ============================================================
-- RPC: admin_reset_user_phase — marca active como cancelled (NAO deleta). p_level NULL = todos os niveis.
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_reset_user_phase(
  p_user_id   uuid,
  p_season_id text DEFAULT NULL,
  p_level     int  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_ids text[];
BEGIN
  WITH cancelled AS (
    UPDATE public.phase_sessions
    SET status = 'cancelled', updated_at = now()
    WHERE user_id = p_user_id
      AND status = 'active'
      AND (p_season_id IS NULL OR season_id = p_season_id)
      AND (p_level IS NULL OR level = p_level)
    RETURNING phase_session_id
  )
  SELECT array_agg(phase_session_id) INTO v_ids FROM cancelled;

  RETURN jsonb_build_object(
    'success', true,
    'cancelled_phase_session_ids', COALESCE(v_ids, ARRAY[]::text[])
  );
END;
$$;

-- ============================================================
-- TRIGGER: reset de progresso (xp=0 + arrays vazios) cancela phases active do usuario.
-- WHEN filtra barato; corpo SO roda no reset real (jogo normal tem xp>0). Custo ~0.
-- ============================================================
CREATE OR REPLACE FUNCTION public.cancel_phases_on_progress_reset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.phase_sessions
  SET status = 'cancelled', updated_at = now()
  WHERE user_id = NEW.user_id AND status = 'active';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cancel_phases_on_progress_reset ON public.user_progress;
CREATE TRIGGER trg_cancel_phases_on_progress_reset
AFTER UPDATE ON public.user_progress
FOR EACH ROW
WHEN (
  NEW.xp = 0
  AND NEW.completed_challenges = '{}'::text[]
  AND NEW.completed_minigames = '{}'::text[]
)
EXECUTE FUNCTION public.cancel_phases_on_progress_reset();

-- ============================================================
-- GRANTS (apenas service_role)
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.get_active_phase_session(uuid, text, int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.get_active_phase_session(uuid, text, int) TO service_role;

REVOKE EXECUTE ON FUNCTION public.upsert_phase_session(uuid, text, int, text, text, jsonb, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.upsert_phase_session(uuid, text, int, text, text, jsonb, timestamptz) TO service_role;

REVOKE EXECUTE ON FUNCTION public.complete_phase_session(uuid, text, int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.complete_phase_session(uuid, text, int) TO service_role;

REVOKE EXECUTE ON FUNCTION public.admin_reset_user_phase(uuid, text, int) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_reset_user_phase(uuid, text, int) TO service_role;
