
CREATE EXTENSION IF NOT EXISTS pgcrypto;


DROP FUNCTION IF EXISTS public.criar_usuario(TEXT, TEXT);
DROP FUNCTION IF EXISTS public.criar_usuario(TEXT, TEXT, VARCHAR);

CREATE OR REPLACE FUNCTION public.criar_usuario(
  p_nickname TEXT,
  p_senha TEXT,
  p_avatar_file_name VARCHAR(100) DEFAULT 'h3535.webp'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_senha_hash TEXT;
BEGIN
  IF p_nickname IS NULL OR trim(p_nickname) = '' THEN
    RAISE EXCEPTION 'Nickname cannot be empty';
  END IF;
  
  IF p_senha IS NULL OR length(p_senha) < 6 THEN
    RAISE EXCEPTION 'Password must be at least 6 characters';
  END IF;
  
  IF p_avatar_file_name IS NULL OR trim(p_avatar_file_name) = '' THEN
    RAISE EXCEPTION 'Avatar file name cannot be empty';
  END IF;
  
  IF EXISTS (SELECT 1 FROM public.usuarios WHERE nickname = p_nickname) THEN
    RAISE EXCEPTION 'Usuário já existe';
  END IF;
  
  v_senha_hash := crypt(p_senha, gen_salt('bf', 10));
  
  INSERT INTO public.usuarios (nickname, senha_hash, avatar_file_name)
  VALUES (p_nickname, v_senha_hash, p_avatar_file_name)
  RETURNING id INTO v_user_id;
  
  RETURN jsonb_build_object(
    'id', v_user_id,
    'nickname', p_nickname,
    'avatar_file_name', p_avatar_file_name,
    'success', true
  );
END;
$$;

COMMENT ON FUNCTION public.criar_usuario IS 'Cria uma nova conta de usuário com senha hasheada via bcrypt e seleção de avatar.';

GRANT EXECUTE ON FUNCTION public.criar_usuario(TEXT, TEXT, VARCHAR) TO service_role, anon;



DROP FUNCTION IF EXISTS public.verify_password(TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.verify_password(
  p_nickname TEXT,
  p_senha TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_senha_hash TEXT;
BEGIN
  IF p_nickname IS NULL OR p_senha IS NULL THEN
    RETURN false;
  END IF;
  
  SELECT senha_hash INTO v_senha_hash
  FROM public.usuarios
  WHERE nickname = p_nickname;
  
  IF v_senha_hash IS NULL THEN
    RETURN false;
  END IF;
  
  RETURN (v_senha_hash = crypt(p_senha, v_senha_hash));
END;
$$;

COMMENT ON FUNCTION public.verify_password IS 'Verifica a senha do usuário via comparação bcrypt. Retorna true se a senha estiver correta.';

GRANT EXECUTE ON FUNCTION public.verify_password(TEXT, TEXT) TO service_role, anon;



DO $$
BEGIN
  RAISE NOTICE '✓ Extension pgcrypto enabled';
  RAISE NOTICE '✓ Function criar_usuario(TEXT, TEXT, VARCHAR) created';
  RAISE NOTICE '✓ Function verify_password(TEXT, TEXT) created';
  RAISE NOTICE '✓ Authentication RPC functions setup complete!';
  RAISE NOTICE '';
  RAISE NOTICE 'Usage examples:';
  RAISE NOTICE '  -- Create user with default avatar:';
  RAISE NOTICE '  SELECT criar_usuario(''username'', ''password123'');';
  RAISE NOTICE '';
  RAISE NOTICE '  -- Create user with specific avatar:';
  RAISE NOTICE '  SELECT criar_usuario(''username'', ''password123'', ''h3535.webp'');';
  RAISE NOTICE '';
  RAISE NOTICE '  -- Verify password:';
  RAISE NOTICE '  SELECT verify_password(''username'', ''password123'');';
END $$;
