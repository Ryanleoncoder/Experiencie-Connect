-- Propósito: Verificar status atual e alterações recentes da janela de evento


SELECT 
  key,
  value->>'is_open' AS is_open,
  value->>'open_time' AS open_time,
  value->>'close_time' AS close_time,
  value->>'timezone' AS timezone,
  value->>'enabled' AS enabled,
  updated_at,
  updated_by,
  created_at
FROM platform_config
WHERE key = 'event_window';



SELECT 
  CASE 
    WHEN COUNT(*) > 0 THEN '✅ Config exists'
    ELSE '❌ Config NOT found'
  END AS status,
  COUNT(*) AS count
FROM platform_config
WHERE key = 'event_window';


SELECT 
  key,
  value AS full_config,
  updated_at,
  updated_by
FROM platform_config
WHERE key = 'event_window';


SELECT 
  key,
  value,
  updated_at,
  updated_by,
  created_at
FROM platform_config
ORDER BY updated_at DESC;


SELECT 
  (value->>'is_open')::boolean AS is_open,
  (value->>'enabled')::boolean AS enabled,
  value->>'open_time' AS open_time,
  value->>'close_time' AS close_time,
  value->>'timezone' AS timezone
FROM platform_config
WHERE key = 'event_window';


-- QUERY 6: Verificar atualizações recentes (requer tabela admin_audit_logs)

-- FROM admin_audit_logs


SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name = 'platform_config'
ORDER BY ordinal_position;

SELECT 
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE tablename = 'platform_config';


-- Para abrir a janela manualmente:

-- Para fechar a janela manualmente:


-- Se a config não existir, criar:
