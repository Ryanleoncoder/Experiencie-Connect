-- A API BFF utiliza a estrutura existente do banco; esta view adapta os campos ao schema esperado pelo BFF:


CREATE OR REPLACE VIEW users AS
SELECT 
    u.id,
    u.nickname,
    u.senha_hash AS password_hash,
    NULL::VARCHAR(20) AS invite_code,  -- Não armazenado em usuarios; pode ser adicionado posteriormente se necessário
    COALESCE(p.xp, 0) AS xp,
    COALESCE(p.level, 1) AS level,
    COALESCE(p.completed_challenges, '{}') AS completed_challenges,
    COALESCE(p.completed_minigames, '{}') AS completed_minigames,
    u.criado_em AS created_at,
    COALESCE(p.updated_at, u.criado_em) AS updated_at
FROM public.usuarios u
LEFT JOIN public.user_progress p ON u.id = p.user_id;

COMMENT ON VIEW users IS 'View que adapta usuarios + user_progress ao schema esperado pela API BFF.';



DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = 'users') THEN
    RAISE NOTICE '✓ View users created successfully (adapts usuarios + user_progress)';
  END IF;
  
  RAISE NOTICE '✓ BFF API database adapter setup complete!';
  RAISE NOTICE 'ℹ Using existing tables: usuarios, user_progress';
END $$;
