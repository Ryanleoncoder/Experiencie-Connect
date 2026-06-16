

ALTER TABLE public.usuarios
ADD COLUMN IF NOT EXISTS avatar_file_name VARCHAR(100) DEFAULT 'h3535.webp';

COMMENT ON COLUMN public.usuarios.avatar_file_name IS
  'Nome do arquivo do avatar do usuário (ex.: h3535.webp, diogocxcool.webp). Armazena o avatar selecionado no fluxo de convite/onboarding.';


CREATE INDEX IF NOT EXISTS idx_usuarios_avatar_file_name 
  ON public.usuarios(avatar_file_name);


DO $$
DECLARE
  column_exists BOOLEAN;
  index_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'usuarios' 
      AND column_name = 'avatar_file_name'
  ) INTO column_exists;

  SELECT EXISTS (
    SELECT 1 
    FROM pg_indexes 
    WHERE schemaname = 'public' 
      AND tablename = 'usuarios' 
      AND indexname = 'idx_usuarios_avatar_file_name'
  ) INTO index_exists;

  IF column_exists THEN
    RAISE NOTICE '✓ Column avatar_file_name added successfully';
  ELSE
    RAISE EXCEPTION '✗ Failed to add avatar_file_name column';
  END IF;

  IF index_exists THEN
    RAISE NOTICE '✓ Index idx_usuarios_avatar_file_name created successfully';
  ELSE
    RAISE EXCEPTION '✗ Failed to create index on avatar_file_name';
  END IF;

  RAISE NOTICE '✓ Migration 29 completed successfully!';
END $$;
