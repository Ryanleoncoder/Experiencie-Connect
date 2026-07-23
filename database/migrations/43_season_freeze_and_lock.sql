-- Congelamento de temporada: estado LOCKING no gate + guard transacional das escritas de XP.

-- Enum operacional da temporada: garante os 4 estados (idempotente; o schema base so tinha ACTIVE/CLOSED).
ALTER TYPE public.season_state ADD VALUE IF NOT EXISTS 'LOCKING';
ALTER TYPE public.season_state ADD VALUE IF NOT EXISTS 'ARCHIVED';

-- O gate le platform_config.season_state.status; o seed nao tinha esse campo.
INSERT INTO public.platform_config (key, value, updated_by)
VALUES ('season_state', '{"status":"ACTIVE","current_season_id":null,"enforce_season_check":true}'::jsonb, 'system')
ON CONFLICT (key) DO NOTHING;

UPDATE public.platform_config
SET value = value || jsonb_build_object('status', COALESCE(value->>'status', 'ACTIVE'))
WHERE key = 'season_state';

-- Chave central do advisory lock de congelamento. O gate e um switch global (um status para
-- a plataforma), entao o lock e global e resolvido no servidor: nunca por um season_id do cliente.
-- Compartilhado nas escritas de XP; exclusivo na transicao para LOCKING (begin_season_finalization).
CREATE OR REPLACE FUNCTION public.platform_freeze_lock_shared() RETURNS void
LANGUAGE sql AS $$
  SELECT pg_advisory_xact_lock_shared(hashtext('experience-connect-season'), hashtext('write-freeze'));
$$;

CREATE OR REPLACE FUNCTION public.platform_freeze_lock_exclusive() RETURNS void
LANGUAGE sql AS $$
  SELECT pg_advisory_xact_lock(hashtext('experience-connect-season'), hashtext('write-freeze'));
$$;

-- Os 3 caminhos de XP (desafio, intermission, resgate) gravam user_progress. Um trigger BEFORE
-- nessa tabela congela todos de uma vez, dentro da transacao de escrita: pega o lock compartilhado
-- (fazendo a transicao exclusiva esperar as mutacoes em andamento) e recusa se o status ja congelou.
CREATE OR REPLACE FUNCTION public.enforce_season_write_freeze() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
BEGIN
  IF current_setting('app.bypass_season_freeze', true) = 'on' THEN
    RETURN NEW;
  END IF;

  PERFORM public.platform_freeze_lock_shared();

  SELECT value->>'status' INTO v_status
  FROM public.platform_config
  WHERE key = 'season_state';

  IF v_status IN ('LOCKING', 'CLOSED') THEN
    RAISE EXCEPTION 'season_frozen'
      USING HINT = 'Temporada em finalizacao/encerrada; escrita de XP bloqueada.',
            ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_season_write_freeze ON public.user_progress;
CREATE TRIGGER trg_enforce_season_write_freeze
  BEFORE INSERT OR UPDATE ON public.user_progress
  FOR EACH ROW EXECUTE FUNCTION public.enforce_season_write_freeze();
