-- Propósito: Evitar tentativas duplicadas em caso de erros de infraestrutura

-- Valores NULL são permitidos para compatibilidade com tentativas já existentes

ALTER TABLE challenge_attempts 
ADD COLUMN IF NOT EXISTS idempotency_key TEXT UNIQUE;

-- Índice parcial (apenas chaves não-NULL) para performance otimizada
-- Garante verificação de deduplicação rápida (<1ms)

CREATE INDEX IF NOT EXISTS idx_challenge_attempts_idempotency_key 
ON challenge_attempts(idempotency_key) 
WHERE idempotency_key IS NOT NULL;


COMMENT ON COLUMN challenge_attempts.idempotency_key IS
'Chave única para deduplicação de requisições. Formato: {user_id}:{challenge_id}:{timestamp_ms}. Evita tentativas duplicadas em erros de infraestrutura (500, 503, timeouts). NULL para tentativas legadas.';








-- Migração retrocompatível: o índice parcial indexa apenas chaves não-NULL (otimização de performance)
