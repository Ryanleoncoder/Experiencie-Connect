
CREATE TYPE season_state AS ENUM ('ACTIVE', 'LOCKING', 'CLOSED', 'ARCHIVED');

CREATE TABLE IF NOT EXISTS seasons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    state season_state DEFAULT 'ACTIVE' NOT NULL,
    start_date TIMESTAMP WITH TIME ZONE NOT NULL,
    end_date TIMESTAMP WITH TIME ZONE,
    closed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    CONSTRAINT valid_dates CHECK (end_date IS NULL OR end_date > start_date),
    CONSTRAINT closed_at_when_closed CHECK (
        (state IN ('CLOSED', 'ARCHIVED') AND closed_at IS NOT NULL) OR
        (state IN ('ACTIVE', 'LOCKING') AND closed_at IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_seasons_state ON seasons(state);
CREATE INDEX IF NOT EXISTS idx_seasons_start_date ON seasons(start_date);
CREATE INDEX IF NOT EXISTS idx_seasons_created_at ON seasons(created_at);


COMMENT ON TABLE seasons IS 'Temporadas do jogo com gerenciamento de estado.';
COMMENT ON COLUMN seasons.state IS 'Estado da temporada: ACTIVE (aceitando envios), LOCKING (período de buffer), CLOSED (sem envios), ARCHIVED (histórico).';
COMMENT ON COLUMN seasons.closed_at IS 'Timestamp de quando a temporada foi encerrada.';
