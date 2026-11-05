# Football Dynasty — Implementation and Release Plan

## Implemented in the current PR

- React/Vite/TypeScript integration at `/dynasty`, linked from the Sherlock Scholes home screen and localized across all nine existing locales.
- Separate Rust service: Axum + Tokio + SQLx + PostgreSQL, Docker image, Railway deployment configuration, liveness/readiness endpoints, graceful shutdown, and bounded connection pool.
- Private PostgreSQL `fd` schema; fictional state is isolated from real football and Alias tables.
- Telegram identity is verified directly by `public.tg_validate_init_data(text)` through SQLx. The production function's HMAC, freshness, SECURITY DEFINER, fixed search path, and bigint return contract were inspected. The migration grants EXECUTE only to `fd_runtime`; no service-role key or browser-supplied Telegram ID is used.
- Dedicated `fd_runtime` role and a separate `fd_app` login model; runtime and migration URLs are separate.
- Campaign creation, six origins, sandbox/scenario modes, founder, dynasty, fictional club, dynastic club ownership, opening double-entry capital ledger, family heir creation, bounded time advancement, deterministic founder death at age 90, succession preview and atomic succession, personal cash-account inheritance, player-character switch, and chronicle.
- Owner-scoped reads/writes, idempotency keys for mutations, deferred database journal-balance constraint.
- CI uses disposable PostgreSQL 17 and tests campaign creation/replay, heir creation, death, succession, persistence reload, and verifier privilege path. CI never connects to production.

## Release sequence

1. Finish green Rust and Sherlock CI on the exact PR head; fix any failing checks.
2. Apply the reviewed `0001_foundation.sql` migration to the private `fd` schema only; verify the verifier grant and role permissions. Do not alter existing public football or Alias tables.
3. Create a dedicated `fd_app` login and store its connection string only in Railway secrets.
4. Connect Railway, deploy the Docker service in the EU region, enable outbound IPv6, set the exact frontend CORS origin, and verify health endpoints.
5. Set `VITE_FD_API_URL` in Vercel and deploy the frontend.
6. Run a real Telegram Mini App smoke test: create campaign, add heir, advance time, verify death, complete succession, reload after restart, and confirm owner isolation.
7. Review backup/restore, request limits, logs, and rollback before marking the slice production-ready.

## Environment constraints

- The organization is at its two-project free-plan limit, so no separate Sherlock Supabase project was created.
- CI uses a disposable PostgreSQL service; no paid Supabase branch was provisioned.
- Production migrations and API deployment have not yet been run from this PR.
- The Railway connection is required before backend provisioning/deployment; connecting the plugin is a user action.

## Explicit non-goals of this vertical slice

No multiplayer, no tactical 3D match engine, no global 24/7 simulation worker, no LLM-authoritative game state, and no writes to Sherlock Scholes real-football or Alias tables.
