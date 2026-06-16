

CREATE TABLE IF NOT EXISTS public.user_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  completed_challenges TEXT[] NOT NULL DEFAULT '{}',
  completed_minigames TEXT[] NOT NULL DEFAULT '{}',
  attempt_history JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT user_progress_user_id_key UNIQUE (user_id),
  CONSTRAINT user_progress_xp_check CHECK (xp >= 0),
  CONSTRAINT user_progress_level_check CHECK (level >= 1)
);

COMMENT ON TABLE public.user_progress IS 'Armazena o progresso atual de cada usuário no CX Game';
COMMENT ON COLUMN public.user_progress.user_id IS 'Referência ao usuário na tabela usuarios';
COMMENT ON COLUMN public.user_progress.xp IS 'Pontos de experiência acumulados';
COMMENT ON COLUMN public.user_progress.level IS 'Nível atual do jogador (calculado: floor(xp/500) + 1)';
COMMENT ON COLUMN public.user_progress.completed_challenges IS 'Array de IDs de desafios completados';
COMMENT ON COLUMN public.user_progress.completed_minigames IS 'Array de IDs de minigames completados';
COMMENT ON COLUMN public.user_progress.attempt_history IS 'Histórico das últimas 100 tentativas (JSONB)';

-- Índices para otimização de queries
CREATE INDEX IF NOT EXISTS idx_user_progress_user_id ON public.user_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_user_progress_updated_at ON public.user_progress(updated_at DESC);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_progress_updated_at
  BEFORE UPDATE ON public.user_progress
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


-- 1.2 Criar tabela progress_history (auditoria)

CREATE TABLE IF NOT EXISTS public.progress_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  sync_type VARCHAR(20) NOT NULL,
  xp_before INTEGER NOT NULL,
  xp_after INTEGER NOT NULL,
  xp_delta INTEGER NOT NULL,
  new_challenges TEXT[] NOT NULL DEFAULT '{}',
  new_minigames TEXT[] NOT NULL DEFAULT '{}',
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT progress_history_sync_type_check 
    CHECK (sync_type IN ('delta', 'full'))
);

COMMENT ON TABLE public.progress_history IS 'Histórico de sincronizações de progresso para auditoria';
COMMENT ON COLUMN public.progress_history.sync_type IS 'Tipo de sincronização: delta (incremental) ou full (completo)';
COMMENT ON COLUMN public.progress_history.xp_delta IS 'Diferença de XP aplicada (pode ser negativa em correções)';

CREATE INDEX IF NOT EXISTS idx_progress_history_user_id ON public.progress_history(user_id);
CREATE INDEX IF NOT EXISTS idx_progress_history_synced_at ON public.progress_history(synced_at DESC);
CREATE INDEX IF NOT EXISTS idx_progress_history_user_synced ON public.progress_history(user_id, synced_at DESC);



ALTER TABLE public.user_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress_history ENABLE ROW LEVEL SECURITY;


CREATE POLICY "Users can view own progress"
  ON public.user_progress
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own progress"
  ON public.user_progress
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own progress"
  ON public.user_progress
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);




CREATE POLICY "Users can view own history"
  ON public.progress_history
  FOR SELECT
  USING (auth.uid() = user_id);




DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'user_progress') THEN
    RAISE NOTICE '✓ Tabela user_progress criada com sucesso';
  END IF;
  
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'progress_history') THEN
    RAISE NOTICE '✓ Tabela progress_history criada com sucesso';
  END IF;
  
  RAISE NOTICE '✓ Database setup completo!';
END $$;
