

CREATE OR REPLACE FUNCTION public.get_user_progress()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSONB;
  current_user_id UUID;
BEGIN
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;
  
  SELECT jsonb_build_object(
    'user_id', user_id,
    'xp', xp,
    'level', level,
    'completed_challenges', completed_challenges,
    'completed_minigames', completed_minigames,
    'attempt_history', attempt_history,
    'updated_at', updated_at
  )
  INTO result
  FROM public.user_progress
  WHERE user_id = current_user_id;
  
  IF result IS NULL THEN
    result := jsonb_build_object(
      'user_id', current_user_id,
      'xp', 0,
      'level', 1,
      'completed_challenges', '[]'::jsonb,
      'completed_minigames', '[]'::jsonb,
      'attempt_history', '[]'::jsonb,
      'updated_at', NOW()
    );
  END IF;
  
  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.get_user_progress() IS 'Retorna o progresso atual do usuário autenticado ou estado inicial se não existir';

GRANT EXECUTE ON FUNCTION public.get_user_progress() TO authenticated;



CREATE OR REPLACE FUNCTION public.sync_progress_delta(
  p_xp_delta INTEGER,
  p_new_challenges TEXT[] DEFAULT '{}',
  p_new_minigames TEXT[] DEFAULT '{}',
  p_new_attempts JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID;
  old_xp INTEGER;
  new_xp INTEGER;
  new_level INTEGER;
  result JSONB;
BEGIN
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;
  
  IF p_xp_delta IS NULL THEN
    RAISE EXCEPTION 'xp_delta cannot be null';
  END IF;
  
  INSERT INTO public.user_progress (
    user_id, 
    xp, 
    level, 
    completed_challenges, 
    completed_minigames, 
    attempt_history
  )
  VALUES (
    current_user_id,
    p_xp_delta,
    FLOOR(p_xp_delta / 500.0) + 1,
    p_new_challenges,
    p_new_minigames,
    p_new_attempts
  )
  ON CONFLICT (user_id) DO UPDATE SET
    xp = user_progress.xp + p_xp_delta,
    
    level = FLOOR((user_progress.xp + p_xp_delta) / 500.0) + 1,
    
    completed_challenges = ARRAY(
      SELECT DISTINCT unnest(user_progress.completed_challenges || p_new_challenges)
    ),
    
    completed_minigames = ARRAY(
      SELECT DISTINCT unnest(user_progress.completed_minigames || p_new_minigames)
    ),
    
    attempt_history = (
      SELECT jsonb_agg(elem ORDER BY (elem->>'timestamp') DESC)
      FROM (
        SELECT elem
        FROM jsonb_array_elements(user_progress.attempt_history || p_new_attempts) elem
        LIMIT 100
      ) sub
    ),
    
    updated_at = NOW()
  RETURNING 
    xp - p_xp_delta AS old_xp_value, 
    xp AS new_xp_value 
  INTO old_xp, new_xp;
  
  IF old_xp IS NULL THEN
    old_xp := 0;
    new_xp := p_xp_delta;
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
    current_user_id, 
    'delta', 
    old_xp, 
    new_xp, 
    p_xp_delta,
    p_new_challenges, 
    p_new_minigames
  );
  
  SELECT jsonb_build_object(
    'success', true,
    'xp', xp,
    'level', level,
    'completed_challenges', completed_challenges,
    'completed_minigames', completed_minigames,
    'updated_at', updated_at
  )
  INTO result
  FROM public.user_progress
  WHERE user_id = current_user_id;
  
  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.sync_progress_delta(INTEGER, TEXT[], TEXT[], JSONB) IS 'Aplica mudanças incrementais (delta) ao progresso do usuário';

GRANT EXECUTE ON FUNCTION public.sync_progress_delta(INTEGER, TEXT[], TEXT[], JSONB) TO authenticated;



CREATE OR REPLACE FUNCTION public.sync_progress_full(
  p_xp INTEGER,
  p_level INTEGER,
  p_completed_challenges TEXT[],
  p_completed_minigames TEXT[],
  p_attempt_history JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID;
  old_xp INTEGER;
  result JSONB;
BEGIN
  current_user_id := auth.uid();
  
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'User not authenticated';
  END IF;
  
  IF p_xp IS NULL OR p_level IS NULL THEN
    RAISE EXCEPTION 'xp and level cannot be null';
  END IF;
  
  IF p_xp < 0 THEN
    RAISE EXCEPTION 'xp cannot be negative';
  END IF;
  
  IF p_level < 1 THEN
    RAISE EXCEPTION 'level must be >= 1';
  END IF;
  
  SELECT xp INTO old_xp
  FROM public.user_progress
  WHERE user_id = current_user_id;
  
  IF old_xp IS NULL THEN
    old_xp := 0;
  END IF;
  
  INSERT INTO public.user_progress (
    user_id, 
    xp, 
    level, 
    completed_challenges, 
    completed_minigames, 
    attempt_history
  )
  VALUES (
    current_user_id, 
    p_xp, 
    p_level, 
    p_completed_challenges,
    p_completed_minigames, 
    p_attempt_history
  )
  ON CONFLICT (user_id) DO UPDATE SET
    xp = p_xp,
    level = p_level,
    completed_challenges = p_completed_challenges,
    completed_minigames = p_completed_minigames,
    attempt_history = p_attempt_history,
    updated_at = NOW();
  
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
    current_user_id, 
    'full', 
    old_xp, 
    p_xp, 
    p_xp - old_xp,
    p_completed_challenges, 
    p_completed_minigames
  );
  
  SELECT jsonb_build_object(
    'success', true,
    'xp', xp,
    'level', level,
    'completed_challenges', completed_challenges,
    'completed_minigames', completed_minigames,
    'updated_at', updated_at
  )
  INTO result
  FROM public.user_progress
  WHERE user_id = current_user_id;
  
  RETURN result;
END;
$$;

COMMENT ON FUNCTION public.sync_progress_full(INTEGER, INTEGER, TEXT[], TEXT[], JSONB) IS 'Sincroniza o estado completo do progresso do usuário (usado periodicamente ou após conflitos)';

GRANT EXECUTE ON FUNCTION public.sync_progress_full(INTEGER, INTEGER, TEXT[], TEXT[], JSONB) TO authenticated;



DO $$
BEGIN
  RAISE NOTICE '✓ Função get_user_progress() criada';
  RAISE NOTICE '✓ Função sync_progress_delta() criada';
  RAISE NOTICE '✓ Função sync_progress_full() criada';
  RAISE NOTICE '✓ RPC Functions setup completo!';
END $$;
