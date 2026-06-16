
ALTER TABLE public.invite_token 
ADD COLUMN IF NOT EXISTS invite_url TEXT;

COMMENT ON COLUMN public.invite_token.invite_url IS 'Complete invite URL with token (e.g., https://expconnect.com.br/invite?token=...)';

UPDATE public.invite_token
SET invite_url = 'https://expconnect.com.br/invite?token=' || invite_token
WHERE invite_url IS NULL;

ALTER TABLE public.invite_token 
ALTER COLUMN invite_url SET NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_name = 'invite_token' 
    AND column_name = 'invite_url'
  ) THEN
    RAISE NOTICE '✓ Column invite_url added successfully';
  END IF;
  
  RAISE NOTICE '✓ Migration complete! invite_url column is now available.';
END $$;
