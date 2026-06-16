
UPDATE platform_config
SET value = jsonb_set(
    value,
    '{is_open}',
    'false'::jsonb,
    true
)
WHERE key = 'event_window'
AND NOT (value ? 'is_open');

DO $$
DECLARE
    v_config JSONB;
BEGIN
    SELECT value INTO v_config
    FROM platform_config
    WHERE key = 'event_window';
    
    IF v_config ? 'is_open' THEN
        RAISE NOTICE 'SUCCESS: is_open field added to event_window config';
        RAISE NOTICE 'Current config: %', v_config;
    ELSE
        RAISE EXCEPTION 'FAILED: is_open field not found in event_window config';
    END IF;
END $$;

COMMENT ON TABLE platform_config IS 'Configurações centralizadas da plataforma. O campo event_window.is_open é atualizado pelo agendador do VPS às 07:00 (true) e 19:00 (false) no horário de Brasília.';
