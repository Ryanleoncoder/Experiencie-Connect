-- Propósito: Monitorar a saúde do sistema de idempotência e detectar anomalias

-- MÉTRICA 1: Requisições idempotentes por hora

CREATE OR REPLACE VIEW monitoring_idempotent_requests_hourly AS
SELECT 
  DATE_TRUNC('hour', created_at) AS hour,
  COUNT(*) FILTER (WHERE idempotency_key IS NOT NULL) AS total_requests_with_key,
  COUNT(DISTINCT idempotency_key) FILTER (WHERE idempotency_key IS NOT NULL) AS unique_requests,
  COUNT(*) FILTER (WHERE idempotency_key IS NOT NULL) - 
    COUNT(DISTINCT idempotency_key) FILTER (WHERE idempotency_key IS NOT NULL) AS idempotent_retries,
  ROUND(
    (COUNT(*) FILTER (WHERE idempotency_key IS NOT NULL) - 
     COUNT(DISTINCT idempotency_key) FILTER (WHERE idempotency_key IS NOT NULL))::numeric / 
    NULLIF(COUNT(*) FILTER (WHERE idempotency_key IS NOT NULL), 0) * 100, 
    2
  ) AS retry_percentage
FROM challenge_attempts
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE_TRUNC('hour', created_at)
ORDER BY hour DESC;

COMMENT ON VIEW monitoring_idempotent_requests_hourly IS
'Rastreia requisições de retry idempotentes por hora. Taxas elevadas indicam problemas de infraestrutura.';



CREATE OR REPLACE VIEW monitoring_potential_infrastructure_errors AS
SELECT 
  user_id,
  challenge_id,
  ARRAY_AGG(attempt_number ORDER BY attempt_number) AS attempt_sequence,
  COUNT(*) AS total_attempts,
  MAX(created_at) AS last_attempt_at,
  CASE 
    WHEN ARRAY_AGG(attempt_number ORDER BY attempt_number) = ARRAY[1] THEN 'normal'
    WHEN ARRAY_AGG(attempt_number ORDER BY attempt_number) = ARRAY[1,2] THEN 'normal'
    WHEN ARRAY_AGG(attempt_number ORDER BY attempt_number) = ARRAY[1,2,3] THEN 'normal'
    ELSE 'suspicious_gap'
  END AS status
FROM challenge_attempts
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY user_id, challenge_id
HAVING ARRAY_AGG(attempt_number ORDER BY attempt_number) NOT IN (
  ARRAY[1], ARRAY[1,2], ARRAY[1,2,3]
);

COMMENT ON VIEW monitoring_potential_infrastructure_errors IS
'Identifica lacunas suspeitas nas sequências de tentativas que podem indicar erros de infraestrutura.';


CREATE OR REPLACE VIEW monitoring_slow_attempts AS
SELECT 
  DATE_TRUNC('hour', created_at) AS hour,
  COUNT(*) AS total_attempts,
  COUNT(*) FILTER (WHERE time_taken_ms > 8000) AS attempts_over_8s,
  COUNT(*) FILTER (WHERE time_taken_ms > 10000) AS attempts_over_10s,
  ROUND(AVG(time_taken_ms)::numeric / 1000, 2) AS avg_time_seconds,
  ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY time_taken_ms)::numeric / 1000, 2) AS p95_time_seconds,
  ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY time_taken_ms)::numeric / 1000, 2) AS p99_time_seconds
FROM challenge_attempts
WHERE created_at >= NOW() - INTERVAL '7 days'
  AND time_taken_ms IS NOT NULL
GROUP BY DATE_TRUNC('hour', created_at)
ORDER BY hour DESC;

COMMENT ON VIEW monitoring_slow_attempts IS
'Rastreia tempos de resposta das tentativas. Valores altos indicam possíveis problemas de timeout.';


-- Consulta para violações de chave duplicada:


CREATE OR REPLACE VIEW monitoring_avg_attempts_per_challenge AS
SELECT 
  DATE_TRUNC('day', created_at) AS day,
  COUNT(DISTINCT CONCAT(user_id, ':', challenge_id)) AS unique_challenges_attempted,
  COUNT(*) AS total_attempts,
  ROUND(COUNT(*)::numeric / NULLIF(COUNT(DISTINCT CONCAT(user_id, ':', challenge_id)), 0), 2) AS avg_attempts_per_challenge,
  COUNT(*) FILTER (WHERE is_correct = true) AS successful_attempts,
  COUNT(*) FILTER (WHERE is_correct = false) AS failed_attempts,
  ROUND(
    COUNT(*) FILTER (WHERE is_correct = true)::numeric / 
    NULLIF(COUNT(*), 0) * 100, 
    2
  ) AS success_rate_percentage
FROM challenge_attempts
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', created_at)
ORDER BY day DESC;

COMMENT ON VIEW monitoring_avg_attempts_per_challenge IS
'Rastreia a média de tentativas por desafio. Deve permanecer estável após a correção de idempotência.';


CREATE OR REPLACE VIEW monitoring_idempotency_key_health AS
SELECT 
  COUNT(*) AS total_attempts_with_key,
  COUNT(*) FILTER (
    WHERE idempotency_key ~ '^[a-f0-9-]+:[^:]+:\d+$'
  ) AS valid_format_keys,
  COUNT(*) FILTER (
    WHERE idempotency_key !~ '^[a-f0-9-]+:[^:]+:\d+$'
  ) AS invalid_format_keys,
  COUNT(DISTINCT idempotency_key) AS unique_keys,
  COUNT(*) - COUNT(DISTINCT idempotency_key) AS duplicate_key_count,
  MIN(created_at) AS first_key_used,
  MAX(created_at) AS last_key_used
FROM challenge_attempts
WHERE idempotency_key IS NOT NULL
  AND created_at >= NOW() - INTERVAL '7 days';

COMMENT ON VIEW monitoring_idempotency_key_health IS
'Valida o formato das chaves de idempotência e detecta anomalias. Formatos inválidos indicam problemas no cliente.';


CREATE OR REPLACE VIEW monitoring_dashboard_realtime AS
SELECT 
  (SELECT COUNT(*) FROM challenge_attempts 
   WHERE created_at >= DATE_TRUNC('hour', NOW())) AS attempts_current_hour,
  
  (SELECT COUNT(DISTINCT idempotency_key) FROM challenge_attempts 
   WHERE created_at >= DATE_TRUNC('hour', NOW()) 
   AND idempotency_key IS NOT NULL) AS unique_requests_current_hour,
  
  (SELECT COUNT(*) - COUNT(DISTINCT idempotency_key) FROM challenge_attempts 
   WHERE created_at >= DATE_TRUNC('hour', NOW()) 
   AND idempotency_key IS NOT NULL) AS retries_current_hour,
  
  (SELECT COUNT(*) FROM challenge_attempts 
   WHERE created_at >= NOW() - INTERVAL '24 hours') AS attempts_last_24h,
  
  (SELECT ROUND(AVG(attempt_count), 2) FROM (
    SELECT COUNT(*) AS attempt_count 
    FROM challenge_attempts 
    WHERE created_at >= NOW() - INTERVAL '24 hours'
    GROUP BY user_id, challenge_id
  ) AS subq) AS avg_attempts_per_challenge_24h,
  
  (SELECT COUNT(*) FROM monitoring_potential_infrastructure_errors) AS suspicious_gaps_24h,
  
  (SELECT COUNT(*) FROM challenge_attempts 
   WHERE created_at >= NOW() - INTERVAL '24 hours'
   AND time_taken_ms > 8000) AS slow_attempts_24h,
  
  (SELECT COUNT(*) FROM challenge_attempts 
   WHERE idempotency_key IS NOT NULL 
   AND idempotency_key !~ '^[a-f0-9-]+:[^:]+:\d+$'
   AND created_at >= NOW() - INTERVAL '24 hours') AS invalid_keys_24h,
  
  NOW() AS last_updated;

COMMENT ON VIEW monitoring_dashboard_realtime IS
'Métricas em tempo real do dashboard para monitoramento do sistema de idempotência.';









