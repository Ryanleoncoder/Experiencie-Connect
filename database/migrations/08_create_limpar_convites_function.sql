

CREATE OR REPLACE FUNCTION public.limpar_convites_expirados()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted_count INTEGER;
BEGIN
  -- Remove apenas convites onde:
  -- Convites utilizados são preservados para fins de auditoria
  DELETE FROM public.invite_token
  WHERE invite_expires < NOW()
    AND invite_used = false;
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  RAISE NOTICE 'Cleanup completed: % expired invite(s) deleted', v_deleted_count;
  
  RETURN v_deleted_count;
END;
$$;

COMMENT ON FUNCTION public.limpar_convites_expirados() IS 'Remove convites expirados e não utilizados da tabela invite_token. Preserva convites já usados para fins de auditoria. Retorna a contagem de registros excluídos.';



GRANT EXECUTE ON FUNCTION public.limpar_convites_expirados() TO service_role;



CREATE EXTENSION IF NOT EXISTS pg_cron;


SELECT cron.unschedule('limpar-convites-expirados')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'limpar-convites-expirados'
);

SELECT cron.schedule(
  'limpar-convites-expirados',  -- Nome do job
  '0 3 * * *',                   -- Executa diariamente às 03:00 UTC
  'SELECT public.limpar_convites_expirados();'  -- Comando SQL a executar
);



DO $$
DECLARE
  v_job_exists BOOLEAN;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'limpar_convites_expirados'
    AND pg_catalog.pg_get_function_identity_arguments(oid) = ''
  ) THEN
    RAISE NOTICE '✓ Function limpar_convites_expirados() created successfully';
  END IF;
  
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    RAISE NOTICE '✓ pg_cron extension enabled';
  END IF;
  
  SELECT EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'limpar-convites-expirados'
  ) INTO v_job_exists;
  
  IF v_job_exists THEN
    RAISE NOTICE '✓ Cron job "limpar-convites-expirados" scheduled successfully';
    RAISE NOTICE '  Schedule: Daily at 3:00 AM UTC';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE '✓ limpar_convites_expirados() cleanup function setup complete!';
  RAISE NOTICE '';
  RAISE NOTICE 'Usage:';
  RAISE NOTICE '  Manual execution: SELECT limpar_convites_expirados();';
  RAISE NOTICE '  Automatic: Runs daily at 3:00 AM UTC via pg_cron';
  RAISE NOTICE '';
  RAISE NOTICE 'Returns:';
  RAISE NOTICE '  Integer count of deleted expired invites';
  RAISE NOTICE '';
  RAISE NOTICE 'Behavior:';
  RAISE NOTICE '  - Deletes invites where invite_expires < NOW() AND invite_used = false';
  RAISE NOTICE '  - Preserves used invites (invite_used = true) for audit purposes';
  RAISE NOTICE '  - Only removes unused expired invites to keep database clean';
END $$;
