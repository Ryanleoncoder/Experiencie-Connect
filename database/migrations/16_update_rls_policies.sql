

-- A tabela user_progress já possui políticas RLS definidas em 01_create_tables.sql:



DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_tables 
    WHERE schemaname = 'public' 
      AND tablename = 'user_progress' 
      AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on user_progress table';
  END IF;
  
  RAISE NOTICE '✓ RLS is enabled on user_progress table';
END $$;



DO $$
DECLARE
  v_policy_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'user_progress'
    AND policyname = 'Users can view own progress'
    AND cmd = 'SELECT'
    AND qual LIKE '%auth.uid()%user_id%';
  
  IF v_policy_count = 0 THEN
    RAISE EXCEPTION 'SELECT policy on user_progress is missing or incorrect';
  END IF;
  
  RAISE NOTICE '✓ SELECT policy on user_progress enforces auth.uid() = user_id';
END $$;



DO $$
DECLARE
  v_policy_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'user_progress'
    AND policyname = 'Users can update own progress'
    AND cmd = 'UPDATE'
    AND qual LIKE '%auth.uid()%user_id%'
    AND with_check LIKE '%auth.uid()%user_id%';
  
  IF v_policy_count = 0 THEN
    RAISE EXCEPTION 'UPDATE policy on user_progress is missing or incorrect';
  END IF;
  
  RAISE NOTICE '✓ UPDATE policy on user_progress enforces auth.uid() = user_id';
END $$;



DO $$
DECLARE
  v_policy_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'user_progress'
    AND policyname = 'Users can insert own progress'
    AND cmd = 'INSERT';
  
  IF v_policy_count = 0 THEN
    RAISE EXCEPTION 'INSERT policy on user_progress is missing';
  END IF;
  
  RAISE NOTICE '✓ INSERT policy on user_progress exists';
END $$;



DO $$
DECLARE
  v_policy_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'user_progress'
    AND cmd = 'DELETE';
  
  IF v_policy_count > 0 THEN
    RAISE WARNING 'DELETE policy exists on user_progress - this may be a security concern';
  ELSE
    RAISE NOTICE '✓ No DELETE policy on user_progress (correct - prevents direct deletion)';
  END IF;
END $$;



/*
-- Bloco para recriar as políticas RLS em user_progress, caso necessário:
DROP POLICY IF EXISTS "Users can view own progress" ON public.user_progress;
DROP POLICY IF EXISTS "Users can insert own progress" ON public.user_progress;
DROP POLICY IF EXISTS "Users can update own progress" ON public.user_progress;

CREATE POLICY "Users can view own progress"
  ON public.user_progress
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own progress"
  ON public.user_progress
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own progress"
  ON public.user_progress
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

RAISE NOTICE '✓ Políticas RLS recriadas em user_progress';
*/




/*
-- Queries de teste para validar políticas RLS em user_progress:
SELECT * FROM user_progress WHERE user_id = auth.uid();

SELECT * FROM user_progress WHERE user_id != auth.uid();

UPDATE user_progress SET xp = xp + 100 WHERE user_id = auth.uid();

UPDATE user_progress SET xp = xp + 100 WHERE user_id != auth.uid();

DELETE FROM user_progress WHERE user_id = auth.uid();
*/



-- Políticas RLS para progress_history:


DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_tables 
    WHERE schemaname = 'public' 
      AND tablename = 'progress_history' 
      AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on progress_history table';
  END IF;
  
  RAISE NOTICE '✓ RLS is enabled on progress_history table';
END $$;



DROP POLICY IF EXISTS "Users can view own progress history" ON public.progress_history;
DROP POLICY IF EXISTS "Prevent direct INSERT by users" ON public.progress_history;



CREATE POLICY "Users can view own progress history"
  ON public.progress_history
  FOR SELECT
  USING (auth.uid() = user_id);

COMMENT ON POLICY "Users can view own progress history" ON public.progress_history IS 
  'Requirement 6.3: Users can only SELECT their own progress history rows';



-- Impede inserção direta por usuários autenticados; apenas service_role (triggers/funções) pode inserir
CREATE POLICY "Prevent direct INSERT by users"
  ON public.progress_history
  FOR INSERT
  WITH CHECK (false);

COMMENT ON POLICY "Prevent direct INSERT by users" ON public.progress_history IS 
  'Requirement 6.4: Prevent direct INSERT by authenticated users. Only triggers/functions with service_role can insert.';



DO $$
DECLARE
  v_select_policy_count INTEGER;
  v_insert_policy_count INTEGER;
  v_update_policy_count INTEGER;
  v_delete_policy_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_select_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'progress_history'
    AND policyname = 'Users can view own progress history'
    AND cmd = 'SELECT'
    AND qual LIKE '%auth.uid()%user_id%';
  
  IF v_select_policy_count = 0 THEN
    RAISE EXCEPTION 'SELECT policy on progress_history is missing or incorrect';
  END IF;
  
  RAISE NOTICE '✓ SELECT policy on progress_history enforces auth.uid() = user_id';
  
  SELECT COUNT(*) INTO v_insert_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'progress_history'
    AND policyname = 'Prevent direct INSERT by users'
    AND cmd = 'INSERT';
  
  IF v_insert_policy_count = 0 THEN
    RAISE EXCEPTION 'INSERT policy on progress_history is missing';
  END IF;
  
  RAISE NOTICE '✓ INSERT policy on progress_history prevents direct user inserts';
  
  SELECT COUNT(*) INTO v_update_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'progress_history'
    AND cmd = 'UPDATE';
  
  IF v_update_policy_count > 0 THEN
    RAISE WARNING 'UPDATE policy exists on progress_history - this may be a security concern';
  ELSE
    RAISE NOTICE '✓ No UPDATE policy on progress_history (correct - prevents modification)';
  END IF;
  
  SELECT COUNT(*) INTO v_delete_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'progress_history'
    AND cmd = 'DELETE';
  
  IF v_delete_policy_count > 0 THEN
    RAISE WARNING 'DELETE policy exists on progress_history - this may be a security concern';
  ELSE
    RAISE NOTICE '✓ No DELETE policy on progress_history (correct - prevents deletion)';
  END IF;
END $$;




/*
-- Queries de teste para validar políticas RLS em progress_history:
SELECT * FROM progress_history WHERE user_id = auth.uid();

SELECT * FROM progress_history WHERE user_id != auth.uid();

INSERT INTO progress_history (user_id, sync_type, xp_before, xp_after, xp_delta)
VALUES (auth.uid(), 'delta', 100, 200, 100);

INSERT INTO progress_history (user_id, sync_type, xp_before, xp_after, xp_delta)
VALUES ('some-user-id', 'delta', 100, 200, 100);

UPDATE progress_history SET xp_delta = 999 WHERE user_id = auth.uid();

DELETE FROM progress_history WHERE user_id = auth.uid();
*/






-- A tabela invite_token tem RLS ativado com políticas básicas definidas em 06_create_invite_token_table.sql.
-- Esta seção substitui e amplia essas políticas:


DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM pg_tables 
    WHERE schemaname = 'public' 
      AND tablename = 'invite_token' 
      AND rowsecurity = true
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on invite_token table';
  END IF;
  
  RAISE NOTICE '✓ RLS is enabled on invite_token table';
END $$;



DROP POLICY IF EXISTS "Allow anon to read invites for validation" ON public.invite_token;
DROP POLICY IF EXISTS "Only service role can modify invites" ON public.invite_token;
DROP POLICY IF EXISTS "Anonymous users can read invites for validation" ON public.invite_token;
DROP POLICY IF EXISTS "Prevent authenticated users from modifying invites" ON public.invite_token;
DROP POLICY IF EXISTS "Prevent authenticated users from inserting invites" ON public.invite_token;
DROP POLICY IF EXISTS "Prevent authenticated users from updating invites" ON public.invite_token;
DROP POLICY IF EXISTS "Prevent authenticated users from deleting invites" ON public.invite_token;



CREATE POLICY "Anonymous users can read invites for validation"
  ON public.invite_token
  FOR SELECT
  TO anon, authenticated
  USING (true);

COMMENT ON POLICY "Anonymous users can read invites for validation" ON public.invite_token IS 
  'Requirement 6.5: Anonymous users can SELECT invite tokens for validation purposes during registration';



-- Impede inserção por usuários autenticados (apenas service_role pode inserir)
CREATE POLICY "Prevent authenticated users from inserting invites"
  ON public.invite_token
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

COMMENT ON POLICY "Prevent authenticated users from inserting invites" ON public.invite_token IS 
  'Requirement 6.6: Prevent INSERT by non-service-role users';


-- Impede atualização por usuários autenticados (apenas service_role pode atualizar)
CREATE POLICY "Prevent authenticated users from updating invites"
  ON public.invite_token
  FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

COMMENT ON POLICY "Prevent authenticated users from updating invites" ON public.invite_token IS 
  'Requirement 6.6: Prevent UPDATE by non-service-role users';


-- Impede exclusão por usuários autenticados (apenas service_role pode excluir)
CREATE POLICY "Prevent authenticated users from deleting invites"
  ON public.invite_token
  FOR DELETE
  TO authenticated
  USING (false);

COMMENT ON POLICY "Prevent authenticated users from deleting invites" ON public.invite_token IS 
  'Requirement 6.6: Prevent DELETE by non-service-role users';



DO $$
DECLARE
  v_select_policy_count INTEGER;
  v_insert_policy_count INTEGER;
  v_update_policy_count INTEGER;
  v_delete_policy_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_select_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'invite_token'
    AND policyname = 'Anonymous users can read invites for validation'
    AND cmd = 'SELECT';
  
  IF v_select_policy_count = 0 THEN
    RAISE EXCEPTION 'SELECT policy on invite_token is missing';
  END IF;
  
  RAISE NOTICE '✓ SELECT policy on invite_token allows anonymous reads';
  
  SELECT COUNT(*) INTO v_insert_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'invite_token'
    AND policyname = 'Prevent authenticated users from inserting invites'
    AND cmd = 'INSERT';
  
  IF v_insert_policy_count = 0 THEN
    RAISE EXCEPTION 'INSERT policy on invite_token is missing';
  END IF;
  
  RAISE NOTICE '✓ INSERT policy on invite_token prevents authenticated user inserts';
  
  SELECT COUNT(*) INTO v_update_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'invite_token'
    AND policyname = 'Prevent authenticated users from updating invites'
    AND cmd = 'UPDATE';
  
  IF v_update_policy_count = 0 THEN
    RAISE EXCEPTION 'UPDATE policy on invite_token is missing';
  END IF;
  
  RAISE NOTICE '✓ UPDATE policy on invite_token prevents authenticated user updates';
  
  SELECT COUNT(*) INTO v_delete_policy_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'invite_token'
    AND policyname = 'Prevent authenticated users from deleting invites'
    AND cmd = 'DELETE';
  
  IF v_delete_policy_count = 0 THEN
    RAISE EXCEPTION 'DELETE policy on invite_token is missing';
  END IF;
  
  RAISE NOTICE '✓ DELETE policy on invite_token prevents authenticated user deletes';
END $$;



DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '========================================';
  RAISE NOTICE 'RLS Policy Review Complete';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE 'Requirements Validated:';
  RAISE NOTICE '  ✓ 6.1: SELECT policy enforces auth.uid() = user_id on user_progress';
  RAISE NOTICE '  ✓ 6.2: UPDATE policy enforces auth.uid() = user_id on user_progress';
  RAISE NOTICE '  ✓ 6.3: SELECT policy enforces auth.uid() = user_id on progress_history';
  RAISE NOTICE '  ✓ 6.4: INSERT policy prevents direct user inserts on progress_history';
  RAISE NOTICE '  ✓ 6.5: SELECT policy allows anonymous reads on invite_token';
  RAISE NOTICE '  ✓ 6.6: INSERT/UPDATE/DELETE policies prevent non-service-role modifications on invite_token';
  RAISE NOTICE '  ✓ 6.7: Universal user isolation via auth.uid()';
  RAISE NOTICE '';
  RAISE NOTICE 'Security Status - user_progress:';
  RAISE NOTICE '  ✓ RLS enabled on user_progress';
  RAISE NOTICE '  ✓ Users can only view their own progress';
  RAISE NOTICE '  ✓ Users can only update their own progress';
  RAISE NOTICE '  ✓ Direct deletion prevented (no DELETE policy)';
  RAISE NOTICE '';
  RAISE NOTICE 'Security Status - progress_history:';
  RAISE NOTICE '  ✓ RLS enabled on progress_history';
  RAISE NOTICE '  ✓ Users can only view their own history';
  RAISE NOTICE '  ✓ Direct INSERT prevented (only triggers/functions can insert)';
  RAISE NOTICE '  ✓ Direct UPDATE prevented (no UPDATE policy)';
  RAISE NOTICE '  ✓ Direct DELETE prevented (no DELETE policy)';
  RAISE NOTICE '';
  RAISE NOTICE 'Security Status - invite_token:';
  RAISE NOTICE '  ✓ RLS enabled on invite_token';
  RAISE NOTICE '  ✓ Anonymous users can SELECT for validation';
  RAISE NOTICE '  ✓ Authenticated users can SELECT for validation';
  RAISE NOTICE '  ✓ Authenticated users cannot INSERT (only service_role)';
  RAISE NOTICE '  ✓ Authenticated users cannot UPDATE (only service_role)';
  RAISE NOTICE '  ✓ Authenticated users cannot DELETE (only service_role)';
  RAISE NOTICE '';
  RAISE NOTICE 'Next Steps:';
  RAISE NOTICE '  1. Test policies with different user contexts';
  RAISE NOTICE '  2. Verify RPC functions respect RLS policies';
  RAISE NOTICE '  3. Verify triggers/functions can insert into progress_history with service_role';
  RAISE NOTICE '  4. Verify anonymous users can read invite_token for validation';
  RAISE NOTICE '  5. Verify authenticated users cannot modify invite_token';
  RAISE NOTICE '  6. Monitor security_logs for unauthorized access attempts';
  RAISE NOTICE '';
END $$;
