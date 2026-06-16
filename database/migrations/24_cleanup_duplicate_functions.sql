
DO $$ 
DECLARE
  func_record RECORD;
BEGIN
  FOR func_record IN 
    SELECT 
      p.oid,
      p.proname,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE p.proname = 'record_challenge_attempt'
      AND n.nspname = 'public'
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS %I.%I(%s) CASCADE',
      'public',
      func_record.proname,
      func_record.args
    );
    
    RAISE NOTICE 'Dropped function: %(%)', func_record.proname, func_record.args;
  END LOOP;
  
  RAISE NOTICE 'All versions of record_challenge_attempt have been dropped';
END $$;
