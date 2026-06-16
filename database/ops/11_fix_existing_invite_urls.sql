
UPDATE public.invite_token
SET invite_url = replace(invite_url, '/frontend/invite?token=', '/invite?token=')
WHERE invite_url LIKE '%/frontend/invite?token=%';

DO $$
DECLARE
  v_updated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_updated_count
  FROM public.invite_token
  WHERE invite_url LIKE '%/invite?token=%'
    AND invite_url NOT LIKE '%/frontend/invite?token=%';
  
  RAISE NOTICE '✓ Updated invite URLs to use /invite path';
  RAISE NOTICE 'Total invites with correct path: %', v_updated_count;
END $$;
