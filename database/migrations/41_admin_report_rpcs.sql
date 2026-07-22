

CREATE OR REPLACE FUNCTION public.admin_user_retention(p_days int DEFAULT 30)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER AS $$
  SELECT jsonb_build_object(
    'period_days', p_days,
    'total_users', (SELECT count(*) FROM public.usuarios),
    'active_users', (SELECT count(DISTINCT user_id) FROM public.challenge_attempts
                     WHERE created_at > now() - (p_days || ' days')::interval),
    'retention_rate', round(
      (SELECT count(DISTINCT user_id)::numeric FROM public.challenge_attempts
       WHERE created_at > now() - (p_days || ' days')::interval)
      / NULLIF((SELECT count(*) FROM public.usuarios), 0) * 100, 2)
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_daily_activity(p_days int DEFAULT 7)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER AS $$
  SELECT coalesce(jsonb_agg(r ORDER BY r->>'date' DESC), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object('date', d::text, 'attempts', cnt, 'unique_users', uu) AS r
    FROM (
      SELECT date(created_at) d, count(*) cnt, count(DISTINCT user_id) uu
      FROM public.challenge_attempts
      WHERE created_at > now() - (p_days || ' days')::interval
      GROUP BY date(created_at)
    ) s
  ) t;
$$;

CREATE OR REPLACE FUNCTION public.admin_xp_distribution()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER AS $$
  SELECT jsonb_build_object(
    'min_xp', min(xp), 'max_xp', max(xp), 'avg_xp', round(avg(xp))::int,
    'percentiles', jsonb_build_object(
      'p25', percentile_cont(0.25) WITHIN GROUP (ORDER BY xp)::int,
      'p50', percentile_cont(0.50) WITHIN GROUP (ORDER BY xp)::int,
      'p75', percentile_cont(0.75) WITHIN GROUP (ORDER BY xp)::int,
      'p90', percentile_cont(0.90) WITHIN GROUP (ORDER BY xp)::int,
      'p95', percentile_cont(0.95) WITHIN GROUP (ORDER BY xp)::int,
      'p99', percentile_cont(0.99) WITHIN GROUP (ORDER BY xp)::int
    ))
  FROM public.user_progress;
$$;

CREATE OR REPLACE FUNCTION public.admin_challenge_difficulty()
RETURNS jsonb LANGUAGE sql SECURITY INVOKER AS $$
  SELECT coalesce(jsonb_agg(r ORDER BY (r->>'success_rate')::numeric ASC), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'challenge_id', challenge_id, 'total_attempts', tot,
      'correct_attempts', cor, 'success_rate', round(cor::numeric / tot * 100, 2)
    ) AS r
    FROM (
      SELECT challenge_id, count(*) tot, sum(CASE WHEN is_correct THEN 1 ELSE 0 END) cor
      FROM public.challenge_attempts
      GROUP BY challenge_id
      HAVING count(*) >= 10
    ) s
  ) t;
$$;

REVOKE EXECUTE ON FUNCTION
  public.admin_user_retention(int), public.admin_daily_activity(int),
  public.admin_xp_distribution(), public.admin_challenge_difficulty() FROM public;
GRANT EXECUTE ON FUNCTION
  public.admin_user_retention(int), public.admin_daily_activity(int),
  public.admin_xp_distribution(), public.admin_challenge_difficulty() TO service_role;
