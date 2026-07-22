
ALTER TABLE public.content_seasons
  ALTER COLUMN data_inicio TYPE timestamptz USING data_inicio::timestamptz;

ALTER TABLE public.content_seasons
  ALTER COLUMN data_fim TYPE timestamptz USING data_fim::timestamptz;
