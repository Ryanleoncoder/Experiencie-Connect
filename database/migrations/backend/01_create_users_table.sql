
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nickname VARCHAR(50) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    invite_code VARCHAR(20),
    xp INTEGER DEFAULT 0 NOT NULL CHECK (xp >= 0),
    level INTEGER DEFAULT 1 NOT NULL CHECK (level >= 1),
    completed_challenges JSONB DEFAULT '[]'::jsonb NOT NULL,
    completed_minigames JSONB DEFAULT '[]'::jsonb NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_nickname ON users(nickname);
CREATE INDEX IF NOT EXISTS idx_users_invite_code ON users(invite_code);
CREATE INDEX IF NOT EXISTS idx_users_xp ON users(xp DESC);
CREATE INDEX IF NOT EXISTS idx_users_level ON users(level);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE users IS 'Contas de usuários com rastreamento de progresso (tabela legada, substituída por usuarios + user_progress).';
COMMENT ON COLUMN users.id IS 'Identificador único do usuário';
COMMENT ON COLUMN users.nickname IS 'Nome de usuário único para login';
COMMENT ON COLUMN users.password_hash IS 'Senha hasheada com bcrypt';
COMMENT ON COLUMN users.invite_code IS 'Código de convite usado no registro';
COMMENT ON COLUMN users.xp IS 'Total de pontos de experiência acumulados';
COMMENT ON COLUMN users.level IS 'Nível atual (calculado a partir do XP)';
COMMENT ON COLUMN users.completed_challenges IS 'Array de IDs de desafios concluídos';
COMMENT ON COLUMN users.completed_minigames IS 'Array de IDs de minigames concluídos';
