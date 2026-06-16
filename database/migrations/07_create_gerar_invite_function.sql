

CREATE OR REPLACE FUNCTION public.gerar_invite(p_nickname TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite_token TEXT;
  v_invite_code TEXT;
  v_invite_url TEXT;
  v_invite_expires TIMESTAMPTZ;
  v_existing_invite RECORD;
  v_code_exists BOOLEAN;
BEGIN
  IF p_nickname IS NULL OR trim(p_nickname) = '' THEN
    RAISE EXCEPTION 'Nickname cannot be empty';
  END IF;
  
  SELECT * INTO v_existing_invite
  FROM public.invite_token
  WHERE nickname = p_nickname
    AND invite_used = false
    AND invite_expires > NOW();
  
  IF FOUND THEN
    RAISE EXCEPTION 'Usuário % já possui um convite ativo', p_nickname;
  END IF;
  
  v_invite_token := replace(gen_random_uuid()::text, '-', '') || 
                    replace(gen_random_uuid()::text, '-', '');
  
  LOOP
    v_invite_code := 'CX-ALPHA-' || 
      upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 4));
    
    SELECT EXISTS(
      SELECT 1 FROM public.invite_token WHERE invite_code = v_invite_code
    ) INTO v_code_exists;
    
    EXIT WHEN NOT v_code_exists;
  END LOOP;
  
  v_invite_expires := NOW() + INTERVAL '5 days';
  
  v_invite_url := 'https://expconnect.com.br/invite?token=' || v_invite_token;
  
  INSERT INTO public.invite_token (
    nickname,
    invite_token,
    invite_code,
    invite_url,
    invite_expires
  ) VALUES (
    p_nickname,
    v_invite_token,
    v_invite_code,
    v_invite_url,
    v_invite_expires
  );
  
  RETURN jsonb_build_object(
    'nickname', p_nickname,
    'invite_token', v_invite_token,
    'invite_code', v_invite_code,
    'invite_url', v_invite_url,
    'invite_expires', v_invite_expires
  );
END;
$$;

COMMENT ON FUNCTION public.gerar_invite(TEXT) IS 'Gera um novo convite para um usuário com token seguro e código único. Retorna os dados do convite incluindo a URL.';



GRANT EXECUTE ON FUNCTION public.gerar_invite(TEXT) TO service_role;



DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'gerar_invite' 
    AND pg_catalog.pg_get_function_identity_arguments(oid) = 'p_nickname text'
  ) THEN
    RAISE NOTICE '✓ Function gerar_invite(TEXT) created successfully';
  END IF;
  
  RAISE NOTICE '✓ gerar_invite() RPC function setup complete!';
  RAISE NOTICE '';
  RAISE NOTICE 'Usage example:';
  RAISE NOTICE '  SELECT gerar_invite(''username'');';
  RAISE NOTICE '';
  RAISE NOTICE 'Returns:';
  RAISE NOTICE '  {';
  RAISE NOTICE '    "nickname": "username",';
  RAISE NOTICE '    "invite_token": "64-char-hex-token",';
  RAISE NOTICE '    "invite_code": "CX-ALPHA-XXXX",';
  RAISE NOTICE '    "invite_url": "https://expconnect.com.br/invite?token=...",';
  RAISE NOTICE '    "invite_expires": "2026-04-10T12:00:00Z"';
  RAISE NOTICE '  }';
END $$;
