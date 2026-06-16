-- Migration 38 - phase generation seed.
-- Each real progress reset gets a fresh generation so deterministic phase IDs,
-- intermission manifests, and opaque game sessions do not repeat stale seeds.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.user_progress
ADD COLUMN IF NOT EXISTS phase_generation text;

UPDATE public.user_progress
SET phase_generation = gen_random_uuid()::text
WHERE phase_generation IS NULL OR phase_generation = '';

ALTER TABLE public.user_progress
ALTER COLUMN phase_generation SET DEFAULT gen_random_uuid()::text;

ALTER TABLE public.user_progress
ALTER COLUMN phase_generation SET NOT NULL;

COMMENT ON COLUMN public.user_progress.phase_generation IS
'Opaque generation seed used by the VPS to derive phase and intermission IDs after progress resets.';

CREATE OR REPLACE FUNCTION public.bump_phase_generation_on_progress_reset()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.phase_generation = gen_random_uuid()::text;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bump_phase_generation_on_progress_reset ON public.user_progress;
CREATE TRIGGER trg_bump_phase_generation_on_progress_reset
BEFORE UPDATE ON public.user_progress
FOR EACH ROW
WHEN (
  NEW.xp = 0
  AND NEW.completed_challenges = '{}'::text[]
  AND NEW.completed_minigames = '{}'::text[]
  AND (
    OLD.xp > 0
    OR OLD.completed_challenges <> '{}'::text[]
    OR OLD.completed_minigames <> '{}'::text[]
    OR OLD.phase_generation IS NULL
    OR OLD.phase_generation = ''
  )
)
EXECUTE FUNCTION public.bump_phase_generation_on_progress_reset();

COMMIT;
