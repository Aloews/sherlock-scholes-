# Football Dynasty — Integration Architecture

**Baseline:** v1.1 · **Inspection date:** 2026-11-05.

## Verified host architecture

Sherlock Scholes is a React 18 + Vite + TypeScript Telegram Mini App using Feature-Sliced Design. `src/app/Router.tsx` owns routes and lazy-loads screens. Existing features use Supabase PostgREST/RPC and selected Edge Functions; the host application has no general-purpose custom backend today.

The connected production Supabase project has 126 base tables in `public`. Existing real football data includes `cards`, `players`, `player_stats`, `player_season_stat`, `player_match_stats`, `football_club`, `club_roster`, `fixtures`, `club_match`, and `league_season`. Alias game data uses separate existing tables. These domains are not to be modified by Football Dynasty.

The production Telegram verifier `public.tg_validate_init_data(p_init_data text)` was inspected. It verifies Telegram HMAC/freshness and returns a Telegram ID as `bigint`; direct execution is restricted to `postgres` and `service_role`. Existing callable wrappers include `get_user_status(p_init_data)`, but the exact response contract must be verified before the Rust service integrates with it. Do not assume `auth.uid()` equals Telegram ID.

## Architecture decision

Football Dynasty is a bounded context inside Sherlock Scholes, implemented as a **separate Rust backend service**. It is not a second frontend or a second identity system.

- Frontend remains inside the existing React/Vite app and follows FSD, Router, design-system, and all nine locale conventions.
- The frontend calls the Football Dynasty HTTP API for all campaign state and commands. It must not write `fd_*` state through Supabase PostgREST.
- Rust service owns domain rules, authorization decisions, simulation, command idempotency, and transaction boundaries.
- Supabase remains the managed PostgreSQL platform. The service connects server-to-server using SQLx and a dedicated least-privilege database role; migration credentials are separate from runtime credentials.
- Fictional campaign state is isolated in a private `fd_*` schema (or another explicitly private namespace after verifying Supabase schema exposure). It never enters real football catalogue tables.
- Use Axum for HTTP, Tokio for async runtime, SQLx for PostgreSQL, Serde for API types, tracing for structured telemetry, and OpenAPI for the public API contract once endpoints are introduced.
- Package the service as a Docker container. Host it independently from the Vercel frontend on a container-capable runtime; hosting provider selection is a separate deployment decision.
- Start with one Rust service and one Postgres database. Do not introduce Redis, Kafka, microservices, or a separate simulation worker until load measurements justify them.

## Trust and identity boundary

Telegram `initData` is untrusted input until validated server-side. The Rust service must never accept a client-supplied Telegram ID as identity.

Before implementing protected endpoints, verify the callable Supabase wrapper's exact input/output contract and grants. Preferred integration is to validate the raw `initData` through the existing narrow verifier wrapper over a server-side Supabase request, then bind the returned Telegram ID to the request context. If the wrapper contract cannot safely support this, implement a separately reviewed verifier adapter without exposing `service_role` or verifier privileges to the browser.

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

Use SQLx compile-time query checking where practical. Runtime database role must not own schema objects or have migration privileges. Apply additive migrations only in a disposable/local database first; compare exact migration versions before any production release.

## Observability and operations

Emit structured logs with request ID, campaign ID (not sensitive identity), command name, simulation version, duration, and outcome. Never log raw Telegram `initData`, access tokens, database URLs, or secrets. Expose liveness/readiness separately; readiness must include a real database connectivity check once SQLx is wired. Apply request timeouts, bounded body sizes, graceful shutdown, and rate limits to mutation routes.

## Frontend placement

Proposed route: `/dynasty`, registered only in `src/app/Router.tsx` and lazy-loaded.

Suggested feature:
```
src/features/football-dynasty/
  api/
  model/
  services/
  hooks/
  types/
src/screens/football-dynasty/
  DynastyHomeScreen.tsx
  CampaignSetupScreen.tsx
  CharacterScreen.tsx
  DynastyScreen.tsx
  ClubScreen.tsx
  ChronicleScreen.tsx
```

This is a target layout, not a claim about existing directories. All visible strings go into ru, en, es, pt, fr, ar, ja, ko, zh. Keep current navigation unchanged until the feature has a complete entry/exit flow.

## Release gates

No production schema change, public route, or deployment during the architecture phase. Require: reviewed ADR; local/disposable PostgreSQL integration tests; identity and ownership security tests; migration drift check; deterministic simulation tests; Rust fmt/clippy/test; frontend typecheck/build/tests; green required CI; and verified rollback plan. A hidden route is not an authorization control.
