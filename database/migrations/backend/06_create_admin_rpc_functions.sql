

CREATE OR REPLACE FUNCTION get_top_users_by_xp(
    p_limit INTEGER DEFAULT 100
)
RETURNS TABLE(
    user_id UUID,
    nickname VARCHAR,
    xp INTEGER,
    level INTEGER,
    rank INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.id as user_id,
        u.nickname::VARCHAR,
        COALESCE(up.xp, 0) as xp,
        COALESCE(up.level, 1) as level,
        ROW_NUMBER() OVER (ORDER BY COALESCE(up.xp, 0) DESC, u.criado_em ASC)::INTEGER as rank
    FROM usuarios u
    LEFT JOIN user_progress up ON u.id = up.user_id
    WHERE u.banned = FALSE
    ORDER BY xp DESC, u.criado_em ASC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION get_season_statistics(
    p_season_id UUID
)
RETURNS JSON AS $$
DECLARE
    v_stats JSON;
BEGIN
    SELECT json_build_object(
        'season_id', p_season_id,
        'total_users', (SELECT COUNT(DISTINCT user_id) FROM challenge_attempts WHERE season_id::uuid = p_season_id),
        'total_attempts', (SELECT COUNT(*) FROM challenge_attempts WHERE season_id::uuid = p_season_id),
        'total_correct', (SELECT COUNT(*) FROM challenge_attempts WHERE season_id::uuid = p_season_id AND is_correct = TRUE),
        'total_xp_earned', (SELECT COALESCE(SUM(xp_earned), 0) FROM challenge_attempts WHERE season_id::uuid = p_season_id),
        'avg_attempts_per_challenge', (
            SELECT COALESCE(AVG(attempt_count), 0)
            FROM (
                SELECT challenge_id, COUNT(*) as attempt_count
                FROM challenge_attempts
                WHERE season_id::uuid = p_season_id
                GROUP BY challenge_id
            ) sub
        ),
        'success_rate', (
            SELECT CASE 
                WHEN COUNT(*) = 0 THEN 0
                ELSE ROUND((COUNT(*) FILTER (WHERE is_correct = TRUE)::NUMERIC / COUNT(*)::NUMERIC) * 100, 2)
            END
            FROM challenge_attempts
            WHERE season_id::uuid = p_season_id
        )
    ) INTO v_stats;
    
    RETURN v_stats;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION ban_user_admin(
    p_user_id UUID,
    p_reason TEXT,
    p_banned_by VARCHAR DEFAULT 'admin'
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE usuarios
    SET 
        banned = TRUE,
        banned_at = NOW(),
        ban_reason = p_reason,
        updated_at = NOW()
    WHERE id = p_user_id;
    
    -- Registra operação no log de auditoria
    INSERT INTO admin_audit_logs (operation, "user", details)
    VALUES (
        'ban_user',
        p_banned_by,
        json_build_object(
            'user_id', p_user_id,
            'reason', p_reason
        )
    );
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION unban_user_admin(
    p_user_id UUID,
    p_unbanned_by VARCHAR DEFAULT 'admin'
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE usuarios
    SET 
        banned = FALSE,
        banned_at = NULL,
        ban_reason = NULL,
        updated_at = NOW()
    WHERE id = p_user_id;
    
    -- Registra operação no log de auditoria
    INSERT INTO admin_audit_logs (operation, "user", details)
    VALUES (
        'unban_user',
        p_unbanned_by,
        json_build_object('user_id', p_user_id)
    );
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION reset_user_progress_admin(
    p_user_id UUID,
    p_reset_by VARCHAR DEFAULT 'admin'
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE user_progress
    SET 
        xp = 0,
        level = 1,
        completed_challenges = ARRAY[]::TEXT[],
        completed_minigames = ARRAY[]::TEXT[],
        attempt_history = '[]'::JSONB,
        updated_at = NOW()
    WHERE user_id = p_user_id;
    
    DELETE FROM attempts WHERE user_id = p_user_id;
    DELETE FROM challenge_attempts WHERE user_id = p_user_id;
    
    -- Registra operação no log de auditoria
    INSERT INTO admin_audit_logs (operation, "user", details)
    VALUES (
        'reset_progress',
        p_reset_by,
        json_build_object('user_id', p_user_id)
    );
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;


COMMENT ON FUNCTION get_top_users_by_xp IS 'Retorna os usuários com maior XP para geração do ranking.';
COMMENT ON FUNCTION get_season_statistics IS 'Retorna estatísticas de uma temporada específica.';
COMMENT ON FUNCTION ban_user_admin IS 'Bane um usuário e registra a operação no log de auditoria.';
COMMENT ON FUNCTION unban_user_admin IS 'Desbane um usuário e registra a operação no log de auditoria.';
COMMENT ON FUNCTION reset_user_progress_admin IS 'Reinicia o progresso de um usuário e registra a operação no log de auditoria.';
