

DO $$
DECLARE
  users_exists BOOLEAN;
  progress_migrated INTEGER := 0;
BEGIN
  RAISE NOTICE '=== FASE 3.5: Migrando dados de progresso ===';
  
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'users'
  ) INTO users_exists;
  
  IF users_exists THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'users' 
        AND column_name IN ('xp', 'level', 'completed_challenges', 'completed_minigames')
    ) THEN
      RAISE NOTICE 'Migrando dados de progresso de users para user_progress...';
      
      INSERT INTO user_progress (
        user_id,
        xp,
        level,
        completed_challenges,
        completed_minigames,
        attempt_history,
        created_at,
        updated_at
      )
      SELECT 
        u_dest.id,
        COALESCE(u_src.xp, 0),
        COALESCE(u_src.level, 1),
        CASE 
          WHEN u_src.completed_challenges IS NOT NULL 
          THEN ARRAY(SELECT jsonb_array_elements_text(u_src.completed_challenges))
          ELSE ARRAY[]::text[]
        END,
        CASE 
          WHEN u_src.completed_minigames IS NOT NULL 
          THEN ARRAY(SELECT jsonb_array_elements_text(u_src.completed_minigames))
          ELSE ARRAY[]::text[]
        END,
        '[]'::jsonb,
        u_src.created_at,
        u_src.updated_at
      FROM users u_src
      INNER JOIN usuarios u_dest ON u_src.nickname = u_dest.nickname
      WHERE NOT EXISTS (
        SELECT 1 FROM user_progress up WHERE up.user_id = u_dest.id
      )
      ON CONFLICT (user_id) DO NOTHING;
      
      GET DIAGNOSTICS progress_migrated = ROW_COUNT;
      RAISE NOTICE '✓ % registros de progresso migrados para user_progress', progress_migrated;
    ELSE
      RAISE NOTICE '✓ Tabela users não tem colunas de progresso';
    END IF;
  ELSE
    RAISE NOTICE '✓ Tabela users não encontrada';
  END IF;
END $$;


DO $$
DECLARE
  users_exists BOOLEAN;
BEGIN
  RAISE NOTICE '=== FASE 3.6: Removendo triggers obsoletos ===';
  
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'users'
  ) INTO users_exists;
  
  IF users_exists THEN
    DROP TRIGGER IF EXISTS update_users_updated_at ON users;
    RAISE NOTICE '✓ Trigger update_users_updated_at removido';
  ELSE
    RAISE NOTICE '✓ Tabela users não existe, trigger já foi removido';
  END IF;
  
  
END $$;
