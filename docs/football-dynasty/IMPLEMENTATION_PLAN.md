# Football Dynasty — Implementation and Release Plan

## Current implementation baseline

- React/Vite/TypeScript remains the Sherlock Scholes frontend.
- One separate Rust service uses Axum, Tokio, SQLx, and PostgreSQL.
- Supabase is the managed PostgreSQL provider; fictional campaign data lives in a private `fd` schema and is not exposed through the browser's PostgREST client.
- Telegram `initData` is verified server-side through the existing `get_user_status(p_init_data)` wrapper. The service extracts the verified `telegram_id`; it never accepts a client-supplied identity.
- Runtime connections switch to the `fd_runtime` database role. Migration credentials are separate from runtime deployment credentials.
- CI uses disposable PostgreSQL 17 and never connects to production.

## Implemented first playable lifecycle

- Campaign creation with sandbox/scenario mode and six origin backgrounds.
- Founder, dynasty, one fictional club, dynastic club control, and opening capital.
- Double-entry opening ledger with a deferred database balance constraint.
- Heir creation with parent/child age-gap validation.
- Bounded time advancement (1–10 years) and deterministic founder death at age 90.
- Eligible-heir preview and atomic succession.
- Personal cash-account inheritance, dynastic club control, player-character switch, and append-only chronicle.
- Owner-scoped reads and writes, Telegram server-side verification, and idempotency keys for mutations.

## Remaining production gates

1. Run full Rust CI and frontend typecheck/build/test on the implementation commit.
2. Verify the exact live Supabase RPC response through a real Telegram test identity; do not use forged or fabricated initData as a success test.
3. Provision a disposable database or use the CI PostgreSQL service for migration and integration testing.
4. Provision separate migration and runtime database credentials; store them only in the backend host's secret manager.
5. Deploy the Rust API to a container-capable service; configure the exact Vercel frontend origin and health checks.
6. Set `VITE_FD_API_URL` in the frontend preview environment, test the complete Telegram Mini App flow, and only then expose the route in production.
7. Review backup/restore, database connection limits, request rate limits, logs, monitoring, and rollback.
8. Merge only with green required checks and deploy only the exact reviewed commit.

## Explicit non-goals of this vertical slice

No multiplayer, no tactical 3D match engine, no global 24/7 simulation worker, no LLM-authoritative game state, and no writes to Sherlock Scholes real-football or Alias tables.
