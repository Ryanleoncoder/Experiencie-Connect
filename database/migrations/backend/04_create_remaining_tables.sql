-- Tabelas: state_transitions, distributed_locks, admin_audit_logs

CREATE TABLE IF NOT EXISTS state_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
    from_state season_state NOT NULL,
    to_state season_state NOT NULL,
    transitioned_by VARCHAR(100) NOT NULL,
    transitioned_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    CONSTRAINT valid_transition CHECK (from_state != to_state)
);

CREATE INDEX IF NOT EXISTS idx_state_transitions_season_id ON state_transitions(season_id);
CREATE INDEX IF NOT EXISTS idx_state_transitions_transitioned_at ON state_transitions(transitioned_at);

COMMENT ON TABLE state_transitions IS 'Log de auditoria para transições de estado de temporadas.';

CREATE TABLE IF NOT EXISTS distributed_locks (
    lock_name VARCHAR(100) PRIMARY KEY,
    acquired_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    owner VARCHAR(100) NOT NULL,
    CONSTRAINT valid_expiration CHECK (expires_at > acquired_at)
);

CREATE INDEX IF NOT EXISTS idx_distributed_locks_expires_at ON distributed_locks(expires_at);

COMMENT ON TABLE distributed_locks IS 'Locks distribuídos para idempotência de cron jobs.';
COMMENT ON COLUMN distributed_locks.owner IS 'Identificador do processo que detém o lock.';

CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation VARCHAR(100) NOT NULL,
    "user" VARCHAR(100) NOT NULL,
    details JSONB DEFAULT '{}'::jsonb NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_operation ON admin_audit_logs(operation);
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_user ON admin_audit_logs("user");
CREATE INDEX IF NOT EXISTS idx_admin_audit_logs_created_at ON admin_audit_logs(created_at);

COMMENT ON TABLE admin_audit_logs IS 'Trilha de auditoria para todas as operações administrativas.';
COMMENT ON COLUMN admin_audit_logs.details IS 'Objeto JSON com detalhes específicos da operação.';
