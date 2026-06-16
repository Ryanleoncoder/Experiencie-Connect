# Security Overview - Experience Connect

This document summarizes the platform security model. The Portuguese version in `security.md` is the primary reference; this file is kept as a compact English overview.

## Principles

- **Server-authoritative:** answer keys, scoring and game composition are validated server-side.
- **Least privilege:** privileged keys are restricted to server-side runtimes.
- **Environment-based configuration:** credentials and runtime URLs come from environment variables.
- **Data minimization:** the data model stores only what the gameplay flow needs.

```text
Client
  |
  v
Vercel API
  |-- session validation
  |-- input validation
  |-- CORS
  |
  +--> Supabase RLS
  +--> Firebase rules
  +--> VPS API + Redis
```

## Authentication and Authorization

- Protected endpoints require a signed session token.
- APIs derive the player identity from the token, not from client-provided IDs.
- Supabase Row Level Security protects user progress and identity data.
- Firebase rules keep challenge answer keys outside client access.

## Network and Runtime

- Public traffic enters through the web/API layer.
- Stateful services such as Redis run behind backend services.
- CORS is restricted by explicit allowed origins in application middleware.
- Security headers are configured in `vercel.json`.

## Data Protection

- `.env` files are ignored by Git.
- `.env.example` files document required variables without real values.
- Logs should avoid full tokens, raw IP persistence and verbose provider errors.
- Sensitive values should be rotated if they were ever exposed outside the local environment.

## Abuse Controls

- Rate limits combine session/user signals with short-lived cache state.
- Invite flows include validation and throttling.
- Open-text inputs are length-limited and validated before processing.

## Related Docs

- `security.md`
- `privacy.md`
- `ARCHITECTURE.md`
