

CREATE TABLE IF NOT EXISTS platform_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(100) NOT NULL UNIQUE,
    value JSONB NOT NULL DEFAULT '{}'::JSONB,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_by VARCHAR(100) NOT NULL DEFAULT 'system',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_config_key ON platform_config(key);

COMMENT ON TABLE platform_config IS 'Configurações centralizadas da plataforma para controle de acesso.';
COMMENT ON COLUMN platform_config.key IS 'Chave de configuração (identificador único)';
COMMENT ON COLUMN platform_config.value IS 'Valor da configuração armazenado como JSONB';
COMMENT ON COLUMN platform_config.updated_at IS 'Timestamp da última atualização';
COMMENT ON COLUMN platform_config.updated_by IS 'Usuário que realizou a última atualização';


INSERT INTO platform_config (key, value, updated_by)
VALUES (
    'platform_enabled',
    '{"enabled": true}'::JSONB,
    'system'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO platform_config (key, value, updated_by)
VALUES (
    'event_window',
    '{
        "is_open": false,
        "enabled": true,
        "open_time": "07:00",
        "close_time": "19:00",
        "timezone": "America/Sao_Paulo"
    }'::JSONB,
    'system'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO platform_config (key, value, updated_by)
VALUES (
    'maintenance_mode',
    '{
        "enabled": false,
        "message": null,
        "estimated_return": null
    }'::JSONB,
    'system'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO platform_config (key, value, updated_by)
VALUES (
    'season_state',
    '{
        "current_season_id": null,
        "enforce_season_check": true
    }'::JSONB,
    'system'
)
ON CONFLICT (key) DO NOTHING;


CREATE OR REPLACE FUNCTION get_platform_config(p_key VARCHAR)
RETURNS JSONB AS $$
DECLARE
    v_value JSONB;
BEGIN
    SELECT value INTO v_value
    FROM platform_config
    WHERE key = p_key;
    
    RETURN v_value;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_platform_config(
    p_key VARCHAR,
    p_value JSONB,
    p_updated_by VARCHAR DEFAULT 'admin'
)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE platform_config
    SET 
        value = p_value,
        updated_at = NOW(),
        updated_by = p_updated_by
    WHERE key = p_key;
    
    IF NOT FOUND THEN
        INSERT INTO platform_config (key, value, updated_by)
        VALUES (p_key, p_value, p_updated_by);
    END IF;
    
    -- Registra operação no log de auditoria
    INSERT INTO admin_audit_logs (operation, "user", details)
    VALUES (
        'update_platform_config',
        p_updated_by,
        json_build_object(
            'key', p_key,
            'value', p_value
        )
    );
    
    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_platform_config IS 'Retorna o valor de configuração da plataforma pela chave.';
COMMENT ON FUNCTION update_platform_config IS 'Atualiza a configuração da plataforma e registra no log de auditoria.';
