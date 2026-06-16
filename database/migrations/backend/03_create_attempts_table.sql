

CREATE TABLE IF NOT EXISTS attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,  -- Referencia a view users (que mapeia para a tabela usuarios)
    challenge_id VARCHAR(100) NOT NULL,
    answer TEXT NOT NULL,
    correct BOOLEAN NOT NULL,
    xp_gained INTEGER DEFAULT 0 NOT NULL CHECK (xp_gained >= 0),
    attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempts_user_id ON attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_attempts_challenge_id ON attempts(challenge_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user_challenge ON attempts(user_id, challenge_id);
CREATE INDEX IF NOT EXISTS idx_attempts_created_at ON attempts(created_at);
CREATE INDEX IF NOT EXISTS idx_attempts_correct ON attempts(correct);

COMMENT ON TABLE attempts IS 'Histórico de tentativas de desafios com rastreamento de XP.';
COMMENT ON COLUMN attempts.attempt_number IS 'Número da tentativa (1-3) para este desafio.';
COMMENT ON COLUMN attempts.xp_gained IS 'XP concedido nesta tentativa (com multiplicador aplicado).';
