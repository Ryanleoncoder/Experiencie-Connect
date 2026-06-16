

CREATE TABLE IF NOT EXISTS public.invite_token (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname TEXT NOT NULL,
  invite_token TEXT NOT NULL,
  invite_code TEXT NOT NULL,
  invite_url TEXT NOT NULL,
  invite_used BOOLEAN NOT NULL DEFAULT false,
  invite_expires TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  blocked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT invite_token_unique UNIQUE (invite_token),
  CONSTRAINT invite_code_unique UNIQUE (invite_code),
  
  CONSTRAINT attempt_count_positive CHECK (attempt_count >= 0)
);

COMMENT ON TABLE public.invite_token IS 'Armazena convites para registro de novos usuários no CX Game';
COMMENT ON COLUMN public.invite_token.id IS 'Chave primária (UUID)';
COMMENT ON COLUMN public.invite_token.nickname IS 'Nome de usuário que será criado ao aceitar o convite';
COMMENT ON COLUMN public.invite_token.invite_token IS 'Token criptograficamente seguro para URL (64 caracteres hex)';
COMMENT ON COLUMN public.invite_token.invite_code IS 'Código de validação legível (formato: CX-ALPHA-XXXX)';
COMMENT ON COLUMN public.invite_token.invite_url IS 'URL completa do convite com token (ex.: https://expconnect.com.br/invite?token=...)';
COMMENT ON COLUMN public.invite_token.invite_used IS 'Indica se o convite já foi utilizado para criar uma conta';
COMMENT ON COLUMN public.invite_token.invite_expires IS 'Expiração do convite (NOW + 5 dias)';
COMMENT ON COLUMN public.invite_token.attempt_count IS 'Número de tentativas inválidas de validação do código';
COMMENT ON COLUMN public.invite_token.blocked_at IS 'Momento em que o convite foi bloqueado por excesso de tentativas (null se não bloqueado)';
COMMENT ON COLUMN public.invite_token.created_at IS 'Momento de criação do convite';



CREATE INDEX IF NOT EXISTS idx_invite_token ON public.invite_token(invite_token);

CREATE INDEX IF NOT EXISTS idx_invite_code ON public.invite_token(invite_code);

-- Índice parcial em invite_expires para convites não utilizados (usado na limpeza e validação)
CREATE INDEX IF NOT EXISTS idx_invite_expires ON public.invite_token(invite_expires)
  WHERE invite_used = false;

-- Índice parcial em blocked_at para convites bloqueados (usado na lógica de desbloqueio)
CREATE INDEX IF NOT EXISTS idx_blocked_at ON public.invite_token(blocked_at)
  WHERE blocked_at IS NOT NULL;



ALTER TABLE public.invite_token ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anon to read invites for validation"
  ON public.invite_token
  FOR SELECT
  TO anon
  USING (true);

-- Apenas service_role pode inserir/atualizar/remover convites
CREATE POLICY "Only service role can modify invites"
  ON public.invite_token
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);



DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'invite_token') THEN
    RAISE NOTICE '✓ Table invite_token created successfully';
  END IF;
  
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_invite_token') THEN
    RAISE NOTICE '✓ Index idx_invite_token created successfully';
  END IF;
  
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_invite_code') THEN
    RAISE NOTICE '✓ Index idx_invite_code created successfully';
  END IF;
  
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_invite_expires') THEN
    RAISE NOTICE '✓ Index idx_invite_expires created successfully';
  END IF;
  
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_blocked_at') THEN
    RAISE NOTICE '✓ Index idx_blocked_at created successfully';
  END IF;
  
  RAISE NOTICE '✓ Invite token table setup complete!';
END $$;
