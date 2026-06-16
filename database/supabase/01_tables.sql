-- Criação das tabelas em ordem de dependência (enums → usuarios → seasons → demais).

DO $$ BEGIN
  CREATE TYPE public.season_state AS ENUM ('ACTIVE', 'CLOSED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.usuarios (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname         varchar NOT NULL UNIQUE,
  senha_hash       text NOT NULL,
  criado_em        timestamp DEFAULT now(),
  invite_code      varchar,
  updated_at       timestamptz DEFAULT now(),
  banned           boolean NOT NULL DEFAULT false,
  banned_at        timestamptz,
  ban_reason       text,
  avatar_file_name varchar DEFAULT 'h3535.webp'::varchar,
  display_name     text,
  ranking_code     text,
  hide_public_name boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.seasons (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       varchar NOT NULL,
  state      public.season_state NOT NULL DEFAULT 'ACTIVE'::public.season_state,
  start_date timestamptz NOT NULL,
  end_date   timestamptz,
  closed_at  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.state_transitions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id        uuid NOT NULL REFERENCES public.seasons(id),
  from_state       public.season_state NOT NULL,
  to_state         public.season_state NOT NULL,
  transitioned_by  varchar NOT NULL,
  transitioned_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_progress (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL UNIQUE REFERENCES public.usuarios(id),
  xp                   integer NOT NULL DEFAULT 0 CHECK (xp >= 0),
  level                integer NOT NULL DEFAULT 1 CHECK (level >= 1),
  completed_challenges text[] NOT NULL DEFAULT '{}'::text[],
  completed_minigames  text[] NOT NULL DEFAULT '{}'::text[],
  attempt_history      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.progress_history (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.usuarios(id),
  sync_type     varchar NOT NULL CHECK (sync_type::text = ANY (ARRAY['delta','full','attempt'])),
  xp_before     integer NOT NULL,
  xp_after      integer NOT NULL,
  xp_delta      integer NOT NULL,
  new_challenges text[] NOT NULL DEFAULT '{}'::text[],
  new_minigames  text[] NOT NULL DEFAULT '{}'::text[],
  synced_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.challenge_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.usuarios(id),
  challenge_id    text NOT NULL,
  level           integer NOT NULL,
  setor           text NOT NULL CHECK (setor = ANY (ARRAY['CX','EX'])),
  season_id       text NOT NULL,
  attempt_number  integer NOT NULL CHECK (attempt_number >= 1 AND attempt_number <= 3),
  user_answer     text NOT NULL,
  is_correct      boolean NOT NULL,
  xp_earned       integer NOT NULL DEFAULT 0,
  time_taken_ms   integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  idempotency_key text UNIQUE
);

CREATE TABLE IF NOT EXISTS public.attempts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.usuarios(id),
  challenge_id   varchar NOT NULL,
  answer         text NOT NULL,
  correct        boolean NOT NULL,
  xp_gained      integer NOT NULL DEFAULT 0 CHECK (xp_gained >= 0),
  attempt_number integer NOT NULL CHECK (attempt_number >= 1 AND attempt_number <= 3),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.intermission_game_sessions (
  session_id      text PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES public.usuarios(id),
  game_id         text NOT NULL,
  challenge_id    text NOT NULL,
  minigame_id     text NOT NULL,
  level           integer NOT NULL CHECK (level >= 1 AND level <= 3),
  setor           text NOT NULL CHECK (setor = ANY (ARRAY['CX','EX'])),
  season_id       text NOT NULL,
  score           integer NOT NULL DEFAULT 0,
  max_score       integer NOT NULL DEFAULT 0,
  percent         integer NOT NULL DEFAULT 0 CHECK (percent >= 0 AND percent <= 100),
  xp_earned       integer NOT NULL DEFAULT 0 CHECK (xp_earned >= 0),
  result          jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL UNIQUE,
  completed_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.invite_token (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname        text NOT NULL,
  invite_token    text NOT NULL UNIQUE,
  invite_code     text NOT NULL UNIQUE,
  invite_used     boolean NOT NULL DEFAULT false,
  invite_expires  timestamptz NOT NULL,
  attempt_count   integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  blocked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  invite_url      text NOT NULL
);

-- Coluna `ip` mantida por compatibilidade; a aplicação deve gravar apenas `ip_hash`.
CREATE TABLE IF NOT EXISTS public.security_logs (
  id         bigserial PRIMARY KEY,
  tipo       text NOT NULL CHECK (tipo = ANY (ARRAY['rate_limit','invalid_token','too_fast','honeypot_triggered','login_failed','invite_blocked'])),
  user_id    uuid,
  ip         text,
  user_agent text,
  endpoint   text,
  metadata   jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  ip_hash    text
);

CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation  varchar NOT NULL,
  "user"     varchar NOT NULL,
  details    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.platform_config (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key        varchar NOT NULL UNIQUE,
  value      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by varchar NOT NULL DEFAULT 'system'::varchar,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.rate_limits (
  key        text PRIMARY KEY,
  requests   jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.login_attempts (
  identifier    text PRIMARY KEY,
  attempts      integer NOT NULL DEFAULT 0,
  first_attempt timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.distributed_locks (
  lock_name   varchar PRIMARY KEY,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  owner       varchar NOT NULL
);
