-- Passwordless authentication for Experience Connect.

create extension if not exists pgcrypto;

drop function if exists public.criar_usuario(text, text, varchar);
drop function if exists public.criar_usuario(text, text);
drop function if exists public.verify_password(text, text);
drop function if exists public.validate_credentials(varchar, text);
drop function if exists public.create_user_with_invite(varchar, text, varchar);
drop function if exists public.gerar_invite(text);
drop view if exists public.users;

alter table public.usuarios
  add column if not exists auth_version integer not null default 1;

alter table public.usuarios
  drop column if exists senha_hash;

create table if not exists public.passkey_grants (
  id uuid primary key default gen_random_uuid(),
  grant_type text not null check (grant_type in ('INVITE', 'MIGRATION', 'RECOVERY')),
  state text not null default 'ISSUED' check (state in ('ISSUED', 'USED', 'BLOCKED', 'EXPIRED', 'REVOKED')),
  nickname text not null,
  target_user_id uuid references public.usuarios(id) on delete cascade,
  pending_user_id uuid unique,
  token_hash text not null unique,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (grant_type = 'INVITE' and target_user_id is null and pending_user_id is not null)
    or
    (grant_type in ('MIGRATION', 'RECOVERY') and target_user_id is not null and pending_user_id is null)
  )
);

create index if not exists idx_passkey_grants_target_active
  on public.passkey_grants (target_user_id, expires_at desc)
  where state = 'ISSUED';

create index if not exists idx_passkey_grants_expiry
  on public.passkey_grants (expires_at)
  where state = 'ISSUED';

create table if not exists public.passkey_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.usuarios(id) on delete cascade,
  credential_id text not null unique,
  public_key text not null,
  sign_count bigint not null default 0 check (sign_count >= 0),
  transports text[] not null default '{}',
  aaguid text,
  backup_eligible boolean not null default false,
  backup_state boolean not null default false,
  friendly_name text not null default 'Passkey',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  check (char_length(credential_id) between 16 and 1024),
  check (char_length(public_key) between 16 and 32768),
  check (char_length(friendly_name) between 1 and 80)
);

create index if not exists idx_passkey_credentials_user_active
  on public.passkey_credentials (user_id, created_at desc)
  where revoked_at is null;

create table if not exists public.auth_sessions (
  id uuid primary key,
  user_id uuid not null references public.usuarios(id) on delete cascade,
  credential_id uuid references public.passkey_credentials(id) on delete set null,
  auth_version integer not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text
);

create index if not exists idx_auth_sessions_active_user
  on public.auth_sessions (user_id, expires_at desc)
  where revoked_at is null;

create table if not exists public.passkey_security_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.usuarios(id) on delete set null,
  credential_id uuid references public.passkey_credentials(id) on delete set null,
  grant_id uuid references public.passkey_grants(id) on delete set null,
  event_type text not null check (event_type in (
    'GRANT_ISSUED', 'GRANT_BLOCKED', 'GRANT_USED', 'PASSKEY_REGISTERED',
    'PASSKEY_AUTHENTICATED', 'PASSKEY_REVOKED', 'SESSIONS_REVOKED'
  )),
  ip_hash text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_passkey_security_events_user
  on public.passkey_security_events (user_id, created_at desc);

alter table public.passkey_grants enable row level security;
alter table public.passkey_credentials enable row level security;
alter table public.auth_sessions enable row level security;
alter table public.passkey_security_events enable row level security;

revoke all on table public.passkey_grants, public.passkey_credentials,
  public.auth_sessions, public.passkey_security_events from anon, authenticated;
grant select, insert, update, delete on table public.passkey_grants,
  public.passkey_credentials, public.auth_sessions, public.passkey_security_events to service_role;

create or replace function public.create_passkey_grant(
  p_grant_type text,
  p_nickname text default null,
  p_target_user_id uuid default null,
  p_expires_at timestamptz default (now() + interval '4 days'),
  p_created_by text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_type text := upper(trim(p_grant_type));
  v_nickname text;
  v_token text;
  v_code_raw text;
  v_code text;
  v_pending_user_id uuid;
  v_grant_id uuid;
begin
  if v_type not in ('INVITE', 'MIGRATION', 'RECOVERY') then
    raise exception 'invalid_grant_type';
  end if;
  if p_expires_at <= now() then
    raise exception 'grant_expired';
  end if;

  if v_type = 'INVITE' then
    v_nickname := trim(coalesce(p_nickname, ''));
    if v_nickname = '' then
      raise exception 'nickname_required';
    end if;
    if exists (select 1 from public.usuarios where nickname = v_nickname) then
      raise exception 'nickname_already_exists';
    end if;
    v_pending_user_id := gen_random_uuid();
  else
    if p_target_user_id is null then
      raise exception 'target_user_required';
    end if;
    select nickname into v_nickname from public.usuarios where id = p_target_user_id;
    if v_nickname is null then
      raise exception 'target_user_not_found';
    end if;
  end if;

  -- One outstanding link per account/nickname prevents competing activation flows.
  update public.passkey_grants
     set state = 'REVOKED', revoked_at = now(), updated_at = now()
   where state = 'ISSUED'
     and ((p_target_user_id is not null and target_user_id = p_target_user_id)
       or (p_target_user_id is null and target_user_id is null and nickname = v_nickname));

  v_token := encode(gen_random_bytes(32), 'hex');
  v_code_raw := upper(encode(gen_random_bytes(7), 'hex'));
  v_code := 'EC-' || substr(v_code_raw, 1, 4) || '-' || substr(v_code_raw, 5, 5) || '-' || substr(v_code_raw, 10, 5);

  insert into public.passkey_grants (
    grant_type, nickname, target_user_id, pending_user_id, token_hash, code_hash,
    expires_at, created_by
  ) values (
    v_type, v_nickname, p_target_user_id, v_pending_user_id,
    encode(digest(v_token, 'sha256'), 'hex'),
    encode(digest(v_code, 'sha256'), 'hex'),
    p_expires_at, p_created_by
  ) returning id into v_grant_id;

  insert into public.passkey_security_events (user_id, grant_id, event_type, metadata)
  values (p_target_user_id, v_grant_id, 'GRANT_ISSUED', jsonb_build_object('grant_type', v_type));

  return jsonb_build_object(
    'id', v_grant_id,
    'grant_type', v_type,
    'nickname', v_nickname,
    'invite_url', 'https://expconnect.com.br/invite?token=' || v_token,
    'invite_token', v_token,
    'invite_code', v_code,
    'invite_expires', p_expires_at
  );
end;
$$;

create or replace function public.verify_passkey_grant(
  p_token_hash text,
  p_code_hash text
)
returns table (
  grant_id uuid,
  grant_type text,
  target_user_id uuid,
  pending_user_id uuid,
  nickname text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_grant public.passkey_grants%rowtype;
begin
  select * into v_grant
    from public.passkey_grants
   where token_hash = p_token_hash
   for update;

  if not found then
    raise exception 'invalid_grant';
  end if;
  if v_grant.state <> 'ISSUED' then
    raise exception 'grant_not_available';
  end if;
  if v_grant.expires_at <= now() then
    update public.passkey_grants
       set state = 'EXPIRED', updated_at = now()
     where id = v_grant.id;
    raise exception 'grant_expired';
  end if;
  if v_grant.code_hash <> p_code_hash then
    update public.passkey_grants
       set attempt_count = attempt_count + 1,
           state = case when attempt_count + 1 >= 5 then 'BLOCKED' else state end,
           updated_at = now()
     where id = v_grant.id;
    if v_grant.attempt_count + 1 >= 5 then
      insert into public.passkey_security_events (user_id, grant_id, event_type)
      values (v_grant.target_user_id, v_grant.id, 'GRANT_BLOCKED');
    end if;
    raise exception 'invalid_code';
  end if;

  return query select v_grant.id, v_grant.grant_type, v_grant.target_user_id,
    v_grant.pending_user_id, v_grant.nickname;
end;
$$;

create or replace function public.complete_passkey_onboarding(
  p_grant_id uuid,
  p_credential_id text,
  p_public_key text,
  p_sign_count bigint,
  p_transports text[],
  p_aaguid text,
  p_backup_eligible boolean,
  p_backup_state boolean,
  p_friendly_name text,
  p_avatar_file_name varchar default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_grant public.passkey_grants%rowtype;
  v_user_id uuid;
  v_credential_uuid uuid;
begin
  select * into v_grant from public.passkey_grants where id = p_grant_id for update;
  if not found or v_grant.state <> 'ISSUED' or v_grant.expires_at <= now() then
    raise exception 'grant_not_available';
  end if;

  if v_grant.target_user_id is null then
    if p_avatar_file_name is null or trim(p_avatar_file_name) = '' then
      raise exception 'avatar_required';
    end if;
    v_user_id := v_grant.pending_user_id;
    insert into public.usuarios (id, nickname, avatar_file_name)
    values (v_user_id, v_grant.nickname, p_avatar_file_name);
  else
    v_user_id := v_grant.target_user_id;
  end if;

  insert into public.passkey_credentials (
    user_id, credential_id, public_key, sign_count, transports, aaguid,
    backup_eligible, backup_state, friendly_name
  ) values (
    v_user_id, p_credential_id, p_public_key, greatest(p_sign_count, 0),
    coalesce(p_transports, '{}'), nullif(p_aaguid, ''),
    coalesce(p_backup_eligible, false), coalesce(p_backup_state, false),
    left(coalesce(nullif(trim(p_friendly_name), ''), 'Passkey'), 80)
  ) returning id into v_credential_uuid;

  update public.passkey_grants
     set state = 'USED', used_at = now(), updated_at = now()
   where id = v_grant.id;

  insert into public.passkey_security_events (user_id, credential_id, grant_id, event_type)
  values (v_user_id, v_credential_uuid, v_grant.id, 'PASSKEY_REGISTERED');
  insert into public.passkey_security_events (user_id, grant_id, event_type)
  values (v_user_id, v_grant.id, 'GRANT_USED');

  return jsonb_build_object(
    'user_id', v_user_id,
    'credential_id', v_credential_uuid,
    'nickname', v_grant.nickname,
    'avatar_file_name', coalesce(p_avatar_file_name, (select avatar_file_name from public.usuarios where id = v_user_id))
  );
end;
$$;

create or replace function public.revoke_passkey_credential(
  p_credential_id uuid,
  p_reason text default 'admin_revoked'
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  update public.passkey_credentials
     set revoked_at = now(), revoked_reason = left(coalesce(nullif(trim(p_reason), ''), 'admin_revoked'), 200)
   where id = p_credential_id and revoked_at is null
   returning user_id into v_user_id;
  if not found then
    return false;
  end if;
  update public.auth_sessions
     set revoked_at = now(), revoked_reason = 'credential_revoked'
   where credential_id = p_credential_id and revoked_at is null;
  insert into public.passkey_security_events (user_id, credential_id, event_type, metadata)
  values (v_user_id, p_credential_id, 'PASSKEY_REVOKED', jsonb_build_object('reason', p_reason));
  return true;
end;
$$;

create or replace function public.revoke_all_user_passkeys(
  p_user_id uuid,
  p_reason text default 'admin_revoked_all'
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.passkey_credentials
     set revoked_at = now(),
         revoked_reason = left(coalesce(nullif(trim(p_reason), ''), 'admin_revoked_all'), 200)
   where user_id = p_user_id and revoked_at is null;
  get diagnostics v_count = row_count;

  if v_count > 0 then
    update public.auth_sessions
       set revoked_at = now(), revoked_reason = 'all_passkeys_revoked'
     where user_id = p_user_id and revoked_at is null;
    insert into public.passkey_security_events (user_id, event_type, metadata)
    values (p_user_id, 'SESSIONS_REVOKED', jsonb_build_object('reason', p_reason, 'credential_count', v_count));
  end if;
  return v_count;
end;
$$;

revoke all on function public.create_passkey_grant(text, text, uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function public.verify_passkey_grant(text, text) from public, anon, authenticated;
revoke all on function public.complete_passkey_onboarding(uuid, text, text, bigint, text[], text, boolean, boolean, text, varchar) from public, anon, authenticated;
revoke all on function public.revoke_passkey_credential(uuid, text) from public, anon, authenticated;
revoke all on function public.revoke_all_user_passkeys(uuid, text) from public, anon, authenticated;
grant execute on function public.create_passkey_grant(text, text, uuid, timestamptz, text) to service_role;
grant execute on function public.verify_passkey_grant(text, text) to service_role;
grant execute on function public.complete_passkey_onboarding(uuid, text, text, bigint, text[], text, boolean, boolean, text, varchar) to service_role;
grant execute on function public.revoke_passkey_credential(uuid, text) to service_role;
grant execute on function public.revoke_all_user_passkeys(uuid, text) to service_role;
