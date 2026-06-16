
SELECT 
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  pg_get_functiondef(p.oid) AS full_definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE p.proname = 'record_challenge_attempt'
  AND n.nspname = 'public';
