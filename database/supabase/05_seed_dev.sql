
INSERT INTO public.seasons (name, state, start_date)
VALUES ('Conexões', 'ACTIVE', now())
ON CONFLICT DO NOTHING;

INSERT INTO public.platform_config (key, value, updated_by)
VALUES ('event_window', '{"enabled": false}'::jsonb, 'seed')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.usuarios (nickname, senha_hash, display_name)
VALUES ('dev_player', '<<PLACEHOLDER_HASH>>', 'Dev Player')
ON CONFLICT (nickname) DO NOTHING;
