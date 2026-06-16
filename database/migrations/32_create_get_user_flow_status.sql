
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

GRANT EXECUTE ON FUNCTION public.get_user_flow_status(UUID, TEXT) TO authenticated, anon;

COMMENT ON FUNCTION public.get_user_flow_status(UUID, TEXT)
IS 'Retorna o status consolidado de desafios e intermission para um usuário e temporada.';
