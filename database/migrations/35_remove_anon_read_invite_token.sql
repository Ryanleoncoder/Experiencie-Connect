-- Migration 35: remove anon policy + fix invite URLs to expconnect.com.br

DROP POLICY IF EXISTS "Allow anon to read invites for validation" ON public.invite_token;

UPDATE public.invite_token
SET invite_url = regexp_replace(
  invite_url,
  'https?://[^/]+(/invite\?token=)',
  'https://expconnect.com.br\1'
)
WHERE invite_url NOT LIKE 'https://expconnect.com.br%'
  AND invite_used = false;

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
    nickname, invite_token, invite_code, invite_url, invite_expires
  ) VALUES (
    p_nickname, v_invite_token, v_invite_code, v_invite_url, v_invite_expires
  );

  RETURN jsonb_build_object(
    'nickname',       p_nickname,
    'invite_token',   v_invite_token,
    'invite_code',    v_invite_code,
    'invite_url',     v_invite_url,
    'invite_expires', v_invite_expires
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.gerar_invite(TEXT) TO service_role;
