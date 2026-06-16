

CREATE OR REPLACE FUNCTION acquire_distributed_lock(
    p_lock_name VARCHAR,
    p_ttl_seconds INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
    v_expires_at TIMESTAMP WITH TIME ZONE;
    v_now TIMESTAMP WITH TIME ZONE;
BEGIN
    v_now := NOW();
    v_expires_at := v_now + (p_ttl_seconds || ' seconds')::INTERVAL;
    
    INSERT INTO distributed_locks (lock_name, acquired_at, expires_at, owner)
    VALUES (p_lock_name, v_now, v_expires_at, 'bff-api')
    ON CONFLICT (lock_name) DO NOTHING;
    
    PERFORM 1 FROM distributed_locks
    WHERE lock_name = p_lock_name
    AND (expires_at > v_now OR owner = 'bff-api');
    
    IF FOUND THEN
        UPDATE distributed_locks
        SET expires_at = v_expires_at, acquired_at = v_now
        WHERE lock_name = p_lock_name AND owner = 'bff-api';
        RETURN TRUE;
    ELSE
        DELETE FROM distributed_locks
        WHERE lock_name = p_lock_name AND expires_at <= v_now;
        
        INSERT INTO distributed_locks (lock_name, acquired_at, expires_at, owner)
        VALUES (p_lock_name, v_now, v_expires_at, 'bff-api')
        ON CONFLICT (lock_name) DO NOTHING;
        
        RETURN FOUND;
    END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION release_distributed_lock(
    p_lock_name VARCHAR
)
RETURNS BOOLEAN AS $$
BEGIN
    DELETE FROM distributed_locks
    WHERE lock_name = p_lock_name AND owner = 'bff-api';
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;


CREATE OR REPLACE FUNCTION validate_credentials(
    p_nickname VARCHAR,
    p_password_hash TEXT
)
RETURNS TABLE(
    user_id UUID,
    nickname VARCHAR,
    xp INTEGER,
    level INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT u.id, u.nickname::VARCHAR, 
           COALESCE(up.xp, 0) as xp, 
           COALESCE(up.level, 1) as level
    FROM usuarios u
    LEFT JOIN user_progress up ON u.id = up.user_id
    WHERE u.nickname = p_nickname
    AND u.senha_hash = p_password_hash;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION create_user_with_invite(
    p_nickname VARCHAR,
    p_password_hash TEXT,
    p_invite_code VARCHAR
)
RETURNS UUID AS $$
DECLARE
    v_user_id UUID;
BEGIN
    INSERT INTO usuarios (nickname, senha_hash, invite_code)
    VALUES (p_nickname, p_password_hash, p_invite_code)
    RETURNING id INTO v_user_id;
    
    RETURN v_user_id;
EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'Nickname already exists';
    WHEN OTHERS THEN
        RAISE;
END;
$$ LANGUAGE plpgsql;

-- As funções abaixo não são recriadas aqui para evitar conflitos com versões mais recentes:

COMMENT ON FUNCTION acquire_distributed_lock IS 'Adquire um lock distribuído com TTL para idempotência de cron jobs.';
COMMENT ON FUNCTION release_distributed_lock IS 'Libera um lock distribuído.';
COMMENT ON FUNCTION validate_credentials IS 'Valida as credenciais do usuário e retorna os dados do usuário.';
COMMENT ON FUNCTION create_user_with_invite IS 'Cria um novo usuário com validação do código de convite.';

