# Football Dynasty — Implementation and Release Plan

## Implemented in the current PR

- React/Vite/TypeScript integration at `/dynasty`, linked from the Sherlock Scholes home screen and localized across all nine existing locales.
- Separate Rust service: Axum + Tokio + SQLx + PostgreSQL, Docker image, Vercel Container deployment in the existing project, liveness/readiness endpoints, graceful shutdown, and bounded connection pool.
- Private PostgreSQL `fd` schema; fictional state is isolated from real football and Alias tables.
- Telegram identity is verified directly by `public.tg_validate_init_data(text)` through SQLx. The production function's HMAC, freshness, SECURITY DEFINER, fixed search path, and bigint return contract were inspected. The migration grants EXECUTE only to `fd_runtime`; no service-role key or browser-supplied Telegram ID is used.
- NOLOGIN `fd_runtime` role; every API transaction uses `SET LOCAL ROLE fd_runtime` and a transaction-local verified Telegram owner GUC. Vercel uses the existing `POSTGRES_URL` Supavisor pooler; `FD_DATABASE_URL` can override with a dedicated `fd_app` login.
- Campaign creation, six origins, sandbox/scenario modes, founder, dynasty, fictional club, dynastic club ownership, opening double-entry capital ledger, family heir creation, bounded time advancement, deterministic founder death at age 90, succession preview and atomic succession, personal cash-account inheritance, player-character switch, and chronicle.
- Owner-scoped reads/writes, idempotency keys for mutations, deferred database journal-balance constraint.
- CI uses disposable PostgreSQL 17 and tests campaign creation/replay, heir creation, death, succession, persistence reload, and verifier privilege path. CI never connects to production.

## Release sequence

1. Finish green Rust and Sherlock CI on the exact PR head; fix any failing checks.
2. Apply the reviewed `0001_foundation.sql` migration to the private `fd` schema only; verify the verifier grant and role permissions. Do not alter existing public football or Alias tables.
3. Use the existing Vercel `POSTGRES_URL` Supavisor transaction-pooler URL; keep `FD_DATABASE_URL` as an encrypted override for a future dedicated `fd_app` login.
4. Deploy the Rust Docker image as a Vercel Container service inside the existing Sherlock Scholes Vercel project. Route `/api/v1/*` and `/health/*` to it through Vercel Services; keep the frontend and API on one origin. Set `FD_ALLOWED_ORIGIN`, keep `FD_RUN_MIGRATIONS=false`, and verify readiness using the production `POSTGRES_URL` pooler connection.
5. Keep `VITE_FD_API_URL` empty so the frontend uses same-origin routing; deploy the combined Vercel Services project.
6. Run a real Telegram Mini App smoke test: create campaign, add heir, advance time, verify death, complete succession, reload after restart, and confirm owner isolation.
7. Review backup/restore, request limits, logs, and rollback before marking the slice production-ready.

## Environment constraints

- The organization is at its two-project free-plan limit, so no separate Sherlock Supabase project was created.
- CI uses a disposable PostgreSQL service; no paid Supabase branch was provisioned.
- Production migrations and API deployment have not yet been run from this PR.
- Railway Free refused additional service provisioning in the existing workspace. The existing media `stream-service` and bot service are not repurposed. Vercel Services is used inside the already-connected Sherlock Scholes project; no additional project is created.

## Explicit non-goals of this vertical slice

No multiplayer, no tactical 3D match engine, no global 24/7 simulation worker, no LLM-authoritative game state, and no writes to Sherlock Scholes real-football or Alias tables.
