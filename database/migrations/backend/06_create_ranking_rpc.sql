
DROP FUNCTION IF EXISTS get_current_ranking();

CREATE OR REPLACE FUNCTION get_current_ranking()
RETURNS TABLE(
    rank INTEGER,
    user_id UUID,
    nickname TEXT,
    xp INTEGER,
    level INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    WITH ranked_users AS (
        SELECT 
            up.user_id,
            u.nickname::TEXT as nickname,
            up.xp,
            up.level,
            ROW_NUMBER() OVER (ORDER BY up.xp DESC, up.level DESC) as user_rank
        FROM user_progress up
        INNER JOIN usuarios u ON up.user_id = u.id
        ORDER BY up.xp DESC, up.level DESC
        LIMIT 500
    )
    SELECT 
        user_rank::INTEGER as rank,
        ranked_users.user_id,
        ranked_users.nickname,
        ranked_users.xp,
        ranked_users.level
    FROM ranked_users;
END;
$$;

COMMENT ON FUNCTION get_current_ranking() IS
'Retorna os 500 usuários com maior XP e nível. Usado como fallback do banco quando o arquivo estático de ranking não está disponível.';

GRANT EXECUTE ON FUNCTION get_current_ranking() TO authenticated;
GRANT EXECUTE ON FUNCTION get_current_ranking() TO anon;

