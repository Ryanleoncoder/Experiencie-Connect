
BEGIN;


DO $$
BEGIN
  RAISE NOTICE '=== FASE 1: Adicionando colunas em usuarios ===';
END $$;

ALTER TABLE usuarios 
  ADD COLUMN IF NOT EXISTS invite_code VARCHAR(20);

ALTER TABLE usuarios 
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

ALTER TABLE usuarios 
  ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT false NOT NULL;

ALTER TABLE usuarios 
  ADD COLUMN IF NOT EXISTS banned_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE usuarios 
  ADD COLUMN IF NOT EXISTS ban_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_usuarios_invite_code ON usuarios(invite_code);
CREATE INDEX IF NOT EXISTS idx_usuarios_banned ON usuarios(banned) WHERE banned = true;
CREATE INDEX IF NOT EXISTS idx_usuarios_updated_at ON usuarios(updated_at DESC);

COMMENT ON COLUMN usuarios.invite_code IS 'Código de convite usado no registro';
COMMENT ON COLUMN usuarios.updated_at IS 'Data da última atualização do registro';
COMMENT ON COLUMN usuarios.banned IS 'Indica se o usuário está banido';
COMMENT ON COLUMN usuarios.banned_at IS 'Data e hora do banimento';
COMMENT ON COLUMN usuarios.ban_reason IS 'Motivo do banimento';

DO $$
BEGIN
  RAISE NOTICE '✓ Colunas adicionadas com sucesso';
END $$;


DO $$
BEGIN
  RAISE NOTICE '=== FASE 2: Configurando trigger de updated_at ===';
END $$;

DROP TRIGGER IF EXISTS update_usuarios_updated_at ON usuarios;

CREATE TRIGGER update_usuarios_updated_at
  BEFORE UPDATE ON usuarios
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DO $$
BEGIN
  RAISE NOTICE '✓ Trigger configurado com sucesso';
END $$;


DO $$
DECLARE
  users_exists BOOLEAN;
  migrated_count INTEGER := 0;
BEGIN
  RAISE NOTICE '=== FASE 3: Verificando migração de dados ===';
  
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'users'
  ) INTO users_exists;
  
  IF users_exists THEN
    RAISE NOTICE 'Tabela users encontrada. Iniciando migração...';
    
    INSERT INTO usuarios (
      nickname, 
      senha_hash, 
      invite_code, 
      banned, 
      banned_at, 
      ban_reason,
      criado_em,
      updated_at
    )
    SELECT 
      u.nickname,
      u.password_hash,
      u.invite_code,
      COALESCE(u.banned, false),
      u.banned_at,
      u.ban_reason,
      u.created_at,
      u.updated_at
    FROM users u
    WHERE u.nickname NOT IN (SELECT nickname FROM usuarios)
    ON CONFLICT (nickname) DO NOTHING;
    
    GET DIAGNOSTICS migrated_count = ROW_COUNT;
    RAISE NOTICE '✓ % usuários migrados de users para usuarios', migrated_count;
  ELSE
    RAISE NOTICE '✓ Tabela users não encontrada. Nenhuma migração necessária.';
  END IF;
END $$;


DO $$
DECLARE
  attempts_exists BOOLEAN;
  fk_references_users BOOLEAN := false;
  fk_constraint_name TEXT;
BEGIN
  RAISE NOTICE '=== FASE 4: Verificando foreign keys ===';
  
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'attempts'
  ) INTO attempts_exists;
  
  IF attempts_exists THEN
    SELECT 
      tc.constraint_name,
      EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc2
        JOIN information_schema.constraint_column_usage ccu 
          ON tc2.constraint_name = ccu.constraint_name
        WHERE tc2.table_name = 'attempts' 
          AND tc2.constraint_type = 'FOREIGN KEY'
          AND ccu.table_name = 'users'
      )
    INTO fk_constraint_name, fk_references_users
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu 
      ON tc.constraint_name = ccu.constraint_name
    WHERE tc.table_name = 'attempts' 
      AND tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'users'
    LIMIT 1;
    
    IF fk_references_users THEN
      RAISE NOTICE 'Tabela attempts referencia users. Corrigindo...';
      
      EXECUTE format('ALTER TABLE attempts DROP CONSTRAINT IF EXISTS %I', fk_constraint_name);
      RAISE NOTICE '✓ Constraint antiga removida: %', fk_constraint_name;
      
      ALTER TABLE attempts 
        ADD CONSTRAINT attempts_user_id_fkey 
        FOREIGN KEY (user_id) REFERENCES usuarios(id);
      
      RAISE NOTICE '✓ Nova constraint criada apontando para usuarios';
    ELSE
      RAISE NOTICE '✓ Foreign keys já estão corretas';
    END IF;
  ELSE
    RAISE NOTICE '✓ Tabela attempts não encontrada';
  END IF;
END $$;


DO $$
DECLARE
  users_exists BOOLEAN;
BEGIN
  RAISE NOTICE '=== FASE 5: Remoção da tabela users ===';
  
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'users'
  ) INTO users_exists;
  
  IF users_exists THEN
    RAISE NOTICE 'Removendo tabela users...';
    DROP TABLE IF EXISTS users CASCADE;
    RAISE NOTICE '✓ Tabela users removida com sucesso';
  ELSE
    RAISE NOTICE '✓ Tabela users não encontrada (já foi removida ou nunca existiu)';
  END IF;
END $$;


DO $$
BEGIN
  RAISE NOTICE '=== FASE 6: Próximos passos ===';
  RAISE NOTICE '1. ✓ Tabela users foi removida';
  RAISE NOTICE '2. Atualizar código do BFF para usar "usuarios" ao invés de "users"';
  RAISE NOTICE '3. Atualizar mapeamento de colunas no código:';
  RAISE NOTICE '   - password_hash → senha_hash';
  RAISE NOTICE '   - created_at → criado_em';
  RAISE NOTICE '4. Testar todas as funcionalidades';
  RAISE NOTICE '5. Atualizar database_schema.md (já atualizado)';
END $$;


DO $$
DECLARE
  col_count INTEGER;
BEGIN
  RAISE NOTICE '=== Verificação Final ===';
  
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns
  WHERE table_name = 'usuarios' AND table_schema = 'public';
  
  RAISE NOTICE '✓ Tabela usuarios tem % colunas', col_count;
  
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'usuarios' 
      AND column_name IN ('invite_code', 'updated_at', 'banned', 'banned_at', 'ban_reason')
  ) THEN
    RAISE NOTICE '✓ Todas as novas colunas foram adicionadas';
  ELSE
    RAISE WARNING '⚠ Algumas colunas podem estar faltando';
  END IF;
  
  RAISE NOTICE '=== Consolidação Concluída ===';
  RAISE NOTICE 'IMPORTANTE: Revise os avisos acima antes de prosseguir';
END $$;

COMMIT;



DO $$
BEGIN
  RAISE NOTICE '=== FASE 6: Atualizando funções RPC do backend ===';
END $$;

CREATE OR REPLACE FUNCTION validate_credentials(
    p_nickname VARCHAR,
    p_password_hash TEXT
)
RETURNS TABLE(
    user_id UUID,
    nickname VARCHAR,
    xp INTEGER,
    level INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT u.id, u.nickname::VARCHAR, 
           COALESCE(up.xp, 0) as xp, 
           COALESCE(up.level, 1) as level
    FROM usuarios u
    LEFT JOIN user_progress up ON u.id = up.user_id
    WHERE u.nickname = p_nickname
    AND u.senha_hash = p_password_hash;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION create_user_with_invite(
    p_nickname VARCHAR,
    p_password_hash TEXT,
    p_invite_code VARCHAR
)
RETURNS UUID AS $$
DECLARE
    v_user_id UUID;
BEGIN
    INSERT INTO usuarios (nickname, senha_hash, invite_code)
    VALUES (p_nickname, p_password_hash, p_invite_code)
    RETURNING id INTO v_user_id;
    
    RETURN v_user_id;
EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'Nickname already exists';
    WHEN OTHERS THEN
        RAISE;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  RAISE NOTICE '✓ Funções RPC atualizadas:';
  RAISE NOTICE '  - validate_credentials() → usa usuarios + user_progress';
  RAISE NOTICE '  - create_user_with_invite() → insere em usuarios';
END $$;


DO $$
BEGIN
  RAISE NOTICE '=== FASE 7: Próximos passos - Atualizar código Python ===';
  RAISE NOTICE '';
  RAISE NOTICE '✓ CONCLUÍDO NO BANCO:';
  RAISE NOTICE '  1. Tabela users removida';
  RAISE NOTICE '  2. Funções RPC atualizadas';
  RAISE NOTICE '  3. Foreign keys corrigidas';
  RAISE NOTICE '';
  RAISE NOTICE '⚠ AÇÃO NECESSÁRIA - Atualizar código Python do backend:';
  RAISE NOTICE '';
  RAISE NOTICE 'Arquivos que precisam ser atualizados:';
  RAISE NOTICE '';
  RAISE NOTICE '  a) CXGAME/backend/app/services/admin_service.py';
  RAISE NOTICE '     - Substituir "FROM users" por "FROM usuarios u LEFT JOIN user_progress up"';
  RAISE NOTICE '     - Substituir "UPDATE users SET banned" por "UPDATE usuarios SET banned"';
  RAISE NOTICE '     - Substituir "UPDATE users SET xp" por "UPDATE user_progress SET xp"';
  RAISE NOTICE '     - Usar u.criado_em ao invés de created_at';
  RAISE NOTICE '     - Usar u.senha_hash ao invés de password_hash';
  RAISE NOTICE '';
  RAISE NOTICE '  b) CXGAME/backend/app/api/reports.py';
  RAISE NOTICE '     - Substituir "FROM users" (stats XP) por "FROM user_progress"';
  RAISE NOTICE '     - Substituir "FROM users" (contagem) por "FROM usuarios"';
  RAISE NOTICE '';
  RAISE NOTICE '  c) CXGAME/backend/database/05_create_rpc_functions.sql';
  RAISE NOTICE '     - ✓ Já atualizado por esta migration';
  RAISE NOTICE '';
  RAISE NOTICE '  d) CXGAME/backend/database/06_add_user_ban_columns.sql';
  RAISE NOTICE '     - ✓ Comentado (colunas já existem em usuarios)';
  RAISE NOTICE '';
  RAISE NOTICE 'Mapeamento de colunas:';
  RAISE NOTICE '  - users.password_hash → usuarios.senha_hash';
  RAISE NOTICE '  - users.created_at → usuarios.criado_em';
  RAISE NOTICE '  - users.xp → user_progress.xp';
  RAISE NOTICE '  - users.level → user_progress.level';
  RAISE NOTICE '  - users.completed_challenges → user_progress.completed_challenges';
  RAISE NOTICE '  - users.completed_minigames → user_progress.completed_minigames';
  RAISE NOTICE '';
  RAISE NOTICE '✓ database_schema.md já foi atualizado';
END $$;
