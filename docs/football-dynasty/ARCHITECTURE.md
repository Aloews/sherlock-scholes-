# Football Dynasty — Integration Architecture

**Baseline:** v1.1 · **Inspection date:** 2026-11-05.

## Verified host architecture

Sherlock Scholes is a React 18 + Vite + TypeScript Telegram Mini App using Feature-Sliced Design. `src/app/Router.tsx` owns routes and lazy-loads screens. Existing features use Supabase PostgREST/RPC and selected Edge Functions; the host application has no general-purpose custom backend today.

The connected production Supabase project has 126 base tables in `public`. Existing real football data includes `cards`, `players`, `player_stats`, `player_season_stat`, `player_match_stats`, `football_club`, `club_roster`, `fixtures`, `club_match`, and `league_season`. Alias game data uses separate existing tables. These domains are not to be modified by Football Dynasty.

The production Telegram verifier `public.tg_validate_init_data(p_init_data text)` was inspected. It verifies Telegram HMAC/freshness and returns a Telegram ID as `bigint`; direct execution is restricted to `postgres` and `service_role`. Existing callable wrappers include `get_user_status(p_init_data)`, but the exact response contract must be verified before the Rust service integrates with it. Do not assume `auth.uid()` equals Telegram ID.

## Architecture decision

Football Dynasty is a bounded context inside Sherlock Scholes, implemented as a **separate Rust backend service**. It is not a second frontend or a second identity system.

- Frontend remains inside the existing React/Vite app and follows FSD, Router, design-system, and all nine locale conventions.
- The frontend calls the Football Dynasty HTTP API for all campaign state and commands. It must not write state in the private `fd` schema through Supabase PostgREST.
- Rust service owns domain rules, authorization decisions, simulation, command idempotency, and transaction boundaries.
- Supabase remains the managed PostgreSQL platform. The service connects server-to-server using SQLx and the existing Vercel `POSTGRES_URL` Supavisor pooler URL. Every request switches transaction-locally to the restricted `fd_runtime` role and sets the verified Telegram owner; migration credentials remain separate. `FD_DATABASE_URL` can override the pooler URL with a dedicated runtime login.
- Fictional campaign state is isolated in the private `fd` schema, which is not exposed through PostgREST. It never enters real football catalogue tables.
- Use Axum for HTTP, Tokio for async runtime, SQLx for PostgreSQL, Serde for API types, and tracing for structured telemetry. Version the HTTP surface under `/api/v1`.
- Package the service as a Docker container. Deploy it as a Vercel Container service in the existing Sherlock Scholes Vercel project, with `/api/v1/*` and `/health/*` routed to the backend. Vercel's outbound database path is IPv4-only. Use the existing `POSTGRES_URL` Supavisor pooler URI; the service disables prepared-statement caching and uses transaction-local `SET LOCAL ROLE fd_runtime` so transaction pooling does not leak role state. `POSTGRES_URL_NON_POOLING` is the direct IPv6 endpoint and is not used by Vercel.
- Start with one Rust service and one Postgres database. Do not introduce Redis, Kafka, microservices, or a separate simulation worker until load measurements justify them.

## Trust and identity boundary

Telegram `initData` is untrusted input until validated server-side. The Rust service must never accept a client-supplied Telegram ID as identity.

The production function `public.tg_validate_init_data(p_init_data text)` was inspected directly. It is `SECURITY DEFINER`, fixes its search path, validates Telegram HMAC and the 24-hour `auth_date` window, reads the bot token from Vault, and returns the verified Telegram ID as `bigint` or NULL. Its original ACL was restricted to `postgres` and `service_role`. The foundation migration grants EXECUTE only to `fd_runtime`; Rust calls this function through SQLx. It deliberately avoids `get_user_status`, which upserts `users.updated_at` on each call. No service-role key or Telegram ID from the browser is trusted.

Every campaign query and command must scope by the verified owner or an explicitly authorised participant. Use opaque campaign IDs; return 404 for inaccessible campaigns where that avoids ownership disclosure. Add forged-initData, stale-initData, cross-user, and IDOR tests before enabling routes.

## Fictional data boundary

Real-world players, clubs, leagues, matches, and stats remain in existing Sherlock Scholes relations. Fictional clubs, players, families, competitions, and events exist only in the Football Dynasty private schema. No fictional entity may be inserted into or mutate the real football catalogue.

Any later read-only link to real-world football data must be an explicit adapter with provenance and a reviewed product rule; it must not collapse fictional and real identities.

## API and command boundary

Version HTTP routes under `/api/v1`. Commands are application-level operations, not client-side SQL/RPC calls:

- create campaign/world/character;
- create family relationship and designate a legal heir;
- acquire or transfer club control;
- appoint or dismiss staff;
- advance bounded simulation;
- resolve an event choice;
- preview and execute succession;
- load campaign and chronicle.

Every command validates authorization and preconditions in the service, then commits all related writes atomically. Require an idempotency key for non-repeatable mutations. Never trust client balances, shareholding, ownership, heir selection, campaign clock, or simulation output.

## Simulation execution

The server is authoritative. The client requests bounded advances; it never simulates years locally. Persist campaign time, pause state, seed, ruleset version, simulation version, tick cursor, and idempotency key. Process bounded batches inside explicit transaction boundaries and make long advances resumable.

Use deterministic seed derivation from campaign/tick/entity identifiers. Record the simulation version so saves can be migrated or replayed intentionally. Start with catch-up when the player returns; a global scheduler is deferred until concurrency and cost are measured. A worker loop may live in the same Rust service initially.

## Persistence invariants

Use relational tables for authoritative ownership, kinship, contracts, and ledger entries. Use JSONB only for versioned configuration and event payloads. Every campaign-owned relation carries `campaign_id`; composite foreign keys prevent cross-campaign references. Account balances reconcile to immutable journal entries. Succession is atomic and non-repeatable. Campaign time is monotonic. Chronicle events are append-only. Snapshots carry schema and simulation versions.

Use SQLx query binding for all values. `fd_runtime` does not own schema objects and has no DDL privileges; `fd_app` is a login member of that role. The production migration is isolated to the private `fd` schema and a narrow EXECUTE grant on the Telegram verifier. CI applies the same migration to disposable PostgreSQL 17; production migration remains a separate reviewed step.

## Observability and operations

Emit structured logs without raw Telegram `initData`, access tokens, database URLs, or secrets. `/health/live` and `/health/ready` are separate; readiness performs a real PostgreSQL query. Graceful shutdown and a bounded SQLx pool are configured. Request rate limiting and a full OpenAPI contract remain release hardening tasks.

## Frontend placement

Implemented route: `/dynasty`, registered in `src/app/Router.tsx` and linked from the home screen. The API client lives in `src/features/football-dynasty/api.ts`; the initial screen is `src/screens/FootballDynastyScreen.tsx`. Visible labels are present in all nine existing locales.

## Release gates

Production release gates: green Rust fmt/Clippy/tests and Sherlock CI; successful migration on the isolated private schema; runtime transaction-local role restricted to `fd_runtime`; Supavisor connectivity and health check; real Telegram Mini App smoke test; same-origin frontend routing; rollback/backup review. The route is not protected by hiding it: every API request is verified server-side and owner-scoped.
