

CREATE TABLE IF NOT EXISTS public.usuarios (
  id UUID NOT NULL DEFAULT gen_random_uuid(),
  nickname CHARACTER VARYING(30) NOT NULL,
  senha_hash TEXT NOT NULL,
  criado_em TIMESTAMP WITHOUT TIME ZONE NULL DEFAULT NOW(),
  
  CONSTRAINT usuarios_pkey PRIMARY KEY (id),
  CONSTRAINT usuarios_nickname_key UNIQUE (nickname)
) TABLESPACE pg_default;

COMMENT ON TABLE public.usuarios IS 'Tabela de usuários do CX Game';
COMMENT ON COLUMN public.usuarios.id IS 'ID único do usuário (UUID)';
COMMENT ON COLUMN public.usuarios.nickname IS 'Nome de usuário único (máximo 30 caracteres)';
COMMENT ON COLUMN public.usuarios.senha_hash IS 'Hash da senha do usuário';
COMMENT ON COLUMN public.usuarios.criado_em IS 'Data e hora de criação da conta';

-- Índices para otimização de queries
CREATE INDEX IF NOT EXISTS idx_usuarios_nickname ON public.usuarios(nickname);
CREATE INDEX IF NOT EXISTS idx_usuarios_criado_em ON public.usuarios(criado_em DESC);


ALTER TABLE public.usuarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON public.usuarios
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.usuarios
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);



DO $
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'usuarios') THEN
    RAISE NOTICE '✓ Tabela usuarios criada com sucesso';
  END IF;
  
  RAISE NOTICE '✓ Schema inicial completo!';
END $;
