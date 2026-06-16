
CREATE OR REPLACE FUNCTION public.get_user_progress(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
  v_avatar_file_name TEXT;
  v_nickname TEXT;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'user_id cannot be null';
  END IF;
  
  SELECT avatar_file_name, nickname
  INTO v_avatar_file_name, v_nickname
  FROM public.usuarios
  WHERE id = p_user_id;
  
  IF v_nickname IS NULL THEN
    RAISE EXCEPTION 'User not found';
  END IF;
  
  SELECT jsonb_build_object(
    'user_id', user_id,
    'xp', xp,
    'level', level,
    'completed_challenges', completed_challenges,
    'completed_minigames', completed_minigames,
    'attempt_history', attempt_history,
    'avatar_file_name', v_avatar_file_name,
    'nickname', v_nickname,
    'updated_at', updated_at
  )
  INTO result
  FROM public.user_progress
  WHERE user_id = p_user_id;
  
  IF result IS NULL THEN
    result := jsonb_build_object(
      'user_id', p_user_id,
      'xp', 0,
      'level', 1,
      'completed_challenges', '[]'::jsonb,
      'completed_minigames', '[]'::jsonb,
      'attempt_history', '[]'::jsonb,
      'avatar_file_name', v_avatar_file_name,
      'nickname', v_nickname,
      'updated_at', NOW()
    );
  END IF;
  
  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_user_progress(UUID) TO authenticated, anon;

DO $$
BEGIN
  RAISE NOTICE '✓ Migration 31: get_user_progress atualizada para incluir avatar_file_name';
  RAISE NOTICE '✓ Agora a função retorna: user_id, xp, level, completed_challenges, completed_minigames, attempt_history, avatar_file_name, nickname, updated_at';
END $$;
