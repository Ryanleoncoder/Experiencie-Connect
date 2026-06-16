
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.backup_phase_reset_20260614_phasegen_user_progress AS
SELECT * FROM public.user_progress;

CREATE TABLE IF NOT EXISTS public.backup_phase_reset_20260614_phasegen_challenge_attempts AS
SELECT * FROM public.challenge_attempts;

CREATE TABLE IF NOT EXISTS public.backup_phase_reset_20260614_phasegen_intermission_game_sessions AS
SELECT * FROM public.intermission_game_sessions;

CREATE TABLE IF NOT EXISTS public.backup_phase_reset_20260614_phasegen_progress_history AS
SELECT * FROM public.progress_history;

CREATE TABLE IF NOT EXISTS public.backup_phase_reset_20260614_phasegen_phase_sessions AS
SELECT * FROM public.phase_sessions;

DELETE FROM public.challenge_attempts;
DELETE FROM public.intermission_game_sessions;
DELETE FROM public.progress_history;
DELETE FROM public.phase_sessions;

DO $$
BEGIN
  IF to_regclass('public.attempts') IS NOT NULL THEN
    DELETE FROM public.attempts;
  END IF;
END $$;

INSERT INTO public.user_progress (
  user_id,
  xp,
  level,
  completed_challenges,
  completed_minigames,
  attempt_history,
  phase_generation
)
SELECT
  id,
  0,
  1,
  '{}'::text[],
  '{}'::text[],
  '[]'::jsonb,
  gen_random_uuid()::text
FROM public.usuarios
ON CONFLICT (user_id) DO UPDATE
SET
  xp = 0,
  level = 1,
  completed_challenges = '{}'::text[],
  completed_minigames = '{}'::text[],
  attempt_history = '[]'::jsonb,
  phase_generation = gen_random_uuid()::text,
  updated_at = now();

COMMIT;

