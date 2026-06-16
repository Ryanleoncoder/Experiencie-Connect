-- Propósito: Consultas rápidas para monitoramento diário


SELECT * FROM monitoring_dashboard_realtime;



SELECT 
  hour,
  total_requests_with_key,
  unique_requests,
  idempotent_retries,
  retry_percentage
FROM monitoring_idempotent_requests_hourly 
WHERE hour >= NOW() - INTERVAL '24 hours'
ORDER BY hour DESC;


-- Verificação rápida do desempenho na hora atual

SELECT 
  'Current Hour' AS period,
  COUNT(*) AS total_attempts,
  COUNT(DISTINCT idempotency_key) FILTER (WHERE idempotency_key IS NOT NULL) AS unique_requests,
  COUNT(*) FILTER (WHERE idempotency_key IS NOT NULL) - 
    COUNT(DISTINCT idempotency_key) FILTER (WHERE idempotency_key IS NOT NULL) AS retries,
  ROUND(
    (COUNT(*) FILTER (WHERE idempotency_key IS NOT NULL) - 
     COUNT(DISTINCT idempotency_key) FILTER (WHERE idempotency_key IS NOT NULL))::numeric / 
    NULLIF(COUNT(*) FILTER (WHERE idempotency_key IS NOT NULL), 0) * 100, 
    2
  ) AS retry_percentage,
  COUNT(*) FILTER (WHERE time_taken_ms > 8000) AS slow_attempts,
  ROUND(AVG(time_taken_ms)::numeric / 1000, 2) AS avg_time_seconds
FROM challenge_attempts
WHERE created_at >= DATE_TRUNC('hour', NOW());



WITH alert_checks AS (
  (SELECT 
    'High Retry Rate' AS alert_name,
    CASE 
      WHEN retry_percentage > 10 THEN '🔴 ALERT'
      WHEN retry_percentage > 5 THEN '🟡 WARNING'
      ELSE '🟢 OK'
    END AS status,
    retry_percentage::text || '%' AS value,
    '< 5%' AS threshold
  FROM monitoring_idempotent_requests_hourly 
  WHERE hour >= DATE_TRUNC('hour', NOW()) - INTERVAL '1 hour'
  ORDER BY hour DESC
  LIMIT 1)
  
  UNION ALL
  
  (SELECT 
    'Suspicious Gaps' AS alert_name,
    CASE 
      WHEN COUNT(*) > 10 THEN '🔴 ALERT'
      WHEN COUNT(*) > 5 THEN '🟡 WARNING'
      ELSE '🟢 OK'
    END AS status,
    COUNT(*)::text AS value,
    '< 10' AS threshold
  FROM monitoring_potential_infrastructure_errors)
  
  UNION ALL
  
  (SELECT 
    'Slow Attempts' AS alert_name,
    CASE 
      WHEN attempts_over_8s::numeric / NULLIF(total_attempts, 0) > 0.05 THEN '🔴 ALERT'
      WHEN attempts_over_8s::numeric / NULLIF(total_attempts, 0) > 0.02 THEN '🟡 WARNING'
      ELSE '🟢 OK'
    END AS status,
    ROUND(attempts_over_8s::numeric / NULLIF(total_attempts, 0) * 100, 2)::text || '%' AS value,
    '< 5%' AS threshold
  FROM monitoring_slow_attempts 
  WHERE hour >= DATE_TRUNC('hour', NOW()) - INTERVAL '1 hour'
  ORDER BY hour DESC
  LIMIT 1)
  
  UNION ALL
  
  (SELECT 
    'Invalid Key Format' AS alert_name,
    CASE 
      WHEN invalid_format_keys > 0 THEN '🔴 ALERT'
      ELSE '🟢 OK'
    END AS status,
    invalid_format_keys::text AS value,
    '0' AS threshold
  FROM monitoring_idempotency_key_health)
  
  UNION ALL
  
  (SELECT 
    'Avg Attempts' AS alert_name,
    CASE 
      WHEN avg_attempts_per_challenge > 2.5 THEN '🔴 ALERT'
      WHEN avg_attempts_per_challenge > 2.2 THEN '🟡 WARNING'
      ELSE '🟢 OK'
    END AS status,
    ROUND(avg_attempts_per_challenge, 2)::text AS value,
    '< 2.5' AS threshold
  FROM monitoring_avg_attempts_per_challenge 
  WHERE day >= CURRENT_DATE - INTERVAL '1 day'
  ORDER BY day DESC
  LIMIT 1)
)
SELECT * FROM alert_checks;


-- QUERY 5: Métricas de desempenho (últimas 24 horas)

SELECT 
  hour,
  total_attempts,
  avg_time_seconds,
  p95_time_seconds,
  p99_time_seconds,
  attempts_over_8s,
  ROUND(attempts_over_8s::numeric / NULLIF(total_attempts, 0) * 100, 2) AS slow_percentage
FROM monitoring_slow_attempts 
WHERE hour >= NOW() - INTERVAL '24 hours'
ORDER BY hour DESC;



SELECT 
  day,
  unique_challenges_attempted,
  total_attempts,
  avg_attempts_per_challenge,
  successful_attempts,
  failed_attempts,
  success_rate_percentage
FROM monitoring_avg_attempts_per_challenge 
WHERE day >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY day DESC;



SELECT 
  total_attempts_with_key,
  valid_format_keys,
  invalid_format_keys,
  unique_keys,
  duplicate_key_count,
  ROUND(valid_format_keys::numeric / NULLIF(total_attempts_with_key, 0) * 100, 2) AS valid_percentage,
  first_key_used,
  last_key_used
FROM monitoring_idempotency_key_health;



SELECT 
  user_id,
  COUNT(*) AS total_attempts,
  COUNT(DISTINCT idempotency_key) AS unique_requests,
  COUNT(*) - COUNT(DISTINCT idempotency_key) AS retries,
  ROUND((COUNT(*) - COUNT(DISTINCT idempotency_key))::numeric / NULLIF(COUNT(*), 0) * 100, 2) AS retry_percentage,
  MAX(created_at) AS last_attempt
FROM challenge_attempts
WHERE created_at >= NOW() - INTERVAL '24 hours'
  AND idempotency_key IS NOT NULL
GROUP BY user_id
HAVING COUNT(*) - COUNT(DISTINCT idempotency_key) > 0
ORDER BY retries DESC
LIMIT 10;



SELECT 
  user_id,
  challenge_id,
  attempt_sequence,
  total_attempts,
  last_attempt_at,
  status
FROM monitoring_potential_infrastructure_errors
ORDER BY last_attempt_at DESC
LIMIT 20;



SELECT 
  DATE_TRUNC('hour', created_at) AS hour,
  COUNT(*) AS total_attempts,
  COUNT(DISTINCT user_id) AS unique_users,
  COUNT(DISTINCT challenge_id) AS unique_challenges,
  ROUND(AVG(time_taken_ms)::numeric / 1000, 2) AS avg_time_seconds
FROM challenge_attempts
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY DATE_TRUNC('hour', created_at)
ORDER BY hour DESC
LIMIT 168; -- 7 dias * 24 horas



WITH deployment_date AS (
  SELECT '2024-01-01'::date AS date -- ALTERE para a data real do deploy
),
before_fix AS (
  SELECT 
    'Before Fix' AS period,
    COUNT(*) AS total_attempts,
    ROUND(AVG(attempt_count), 2) AS avg_attempts_per_challenge,
    COUNT(DISTINCT user_id) AS unique_users
  FROM (
    SELECT user_id, challenge_id, COUNT(*) AS attempt_count
    FROM challenge_attempts, deployment_date
    WHERE created_at < deployment_date.date
    GROUP BY user_id, challenge_id
  ) AS subq
),
after_fix AS (
  SELECT 
    'After Fix' AS period,
    COUNT(*) AS total_attempts,
    ROUND(AVG(attempt_count), 2) AS avg_attempts_per_challenge,
    COUNT(DISTINCT user_id) AS unique_users
  FROM (
    SELECT user_id, challenge_id, COUNT(*) AS attempt_count
    FROM challenge_attempts, deployment_date
    WHERE created_at >= deployment_date.date
    GROUP BY user_id, challenge_id
  ) AS subq
)
SELECT * FROM before_fix
UNION ALL
SELECT * FROM after_fix;



SELECT 
  NOW() AS current_time,
  
  (SELECT COUNT(*) FROM challenge_attempts 
   WHERE created_at >= DATE_TRUNC('hour', NOW())) AS attempts_this_hour,
  
  (SELECT ROUND(
    (COUNT(*) - COUNT(DISTINCT idempotency_key))::numeric / 
    NULLIF(COUNT(*), 0) * 100, 2
  ) FROM challenge_attempts 
   WHERE created_at >= DATE_TRUNC('hour', NOW())
   AND idempotency_key IS NOT NULL) AS retry_rate_this_hour,
  
  (SELECT COUNT(*) FROM challenge_attempts 
   WHERE created_at >= DATE_TRUNC('hour', NOW())
   AND time_taken_ms > 8000) AS slow_attempts_this_hour,
  
  (SELECT COUNT(*) FROM challenge_attempts 
   WHERE created_at >= NOW() - INTERVAL '24 hours') AS attempts_24h,
  
  (SELECT ROUND(AVG(attempt_count), 2) FROM (
    SELECT COUNT(*) AS attempt_count 
    FROM challenge_attempts 
    WHERE created_at >= NOW() - INTERVAL '24 hours'
    GROUP BY user_id, challenge_id
  ) AS subq) AS avg_attempts_24h,
  
  (SELECT COUNT(*) FROM monitoring_potential_infrastructure_errors) AS suspicious_gaps,
  
  (SELECT invalid_format_keys FROM monitoring_idempotency_key_health) AS invalid_keys,
  
  CASE 
    WHEN (SELECT retry_percentage FROM monitoring_idempotent_requests_hourly 
          WHERE hour >= DATE_TRUNC('hour', NOW()) - INTERVAL '1 hour'
          ORDER BY hour DESC LIMIT 1) > 10 THEN '🔴 UNHEALTHY'
    WHEN (SELECT retry_percentage FROM monitoring_idempotent_requests_hourly 
          WHERE hour >= DATE_TRUNC('hour', NOW()) - INTERVAL '1 hour'
          ORDER BY hour DESC LIMIT 1) > 5 THEN '🟡 DEGRADED'
    ELSE '🟢 HEALTHY'
  END AS system_status;


