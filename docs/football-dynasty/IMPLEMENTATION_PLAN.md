# Football Dynasty — Repository Integration and Delivery Plan

**Inspection:** 2026-11-05 · **Host:** Sherlock Scholes React/Vite/TypeScript + Supabase.

## Verified host facts

- Frontend: React 18 + Vite + TypeScript, Feature-Sliced Design.
- Route registry: `src/app/Router.tsx`; FSD layers include `src/shared`, `src/features`, `src/screens`, `src/app`.
- Existing feature services use Supabase PostgREST/RPC; selected server operations use Supabase Edge Functions. There is no general-purpose custom backend in the inspected host.
- Nine locales: ru, en, es, pt, fr, ar, ja, ko, zh.
- Production project `konoavrduynecxblqfvq` had 126 base tables in `public`.
- Real football relations include `cards`, `players`, `player_stats`, `player_season_stat`, `player_match_stats`, `football_club`, `club_roster`, `fixtures`, `club_match`, and `league_season`.
- Telegram verifier `public.tg_validate_init_data(p_init_data text)` verifies HMAC/freshness and returns Telegram ID as `bigint`; direct execution is restricted. The exact callable wrapper contract must be checked before Rust integration.
- No dedicated Sherlock Scholes staging project exists in the connected Supabase organization. Creating a separate project was blocked by the free-plan limit of two active projects; no existing project was paused or deleted.

## Architecture decisions

1. Implement Football Dynasty as one independently deployed Rust HTTP service, using Axum + Tokio + SQLx + PostgreSQL.
2. Keep the existing React/Vite app, Telegram Mini App shell, router, and FSD conventions.
3. Supabase remains the managed PostgreSQL provider; Rust is the only application writer for the private fictional campaign schema.
4. Use a dedicated least-privilege runtime database role and separate migration credentials. Never put service credentials in the browser.
5. Validate Telegram `initData` server-side through a verified narrow identity adapter. Do not accept client-supplied Telegram IDs and do not assume `auth.uid()` equals Telegram ID.
6. Keep fictional data in private `fd_*` relations. Never insert fictional entities into real football catalogue tables.
7. Single-player campaign first; defer multiplayer and always-on world simulation.
8. No Redis or distributed worker in the first release; use bounded ticks and a worker loop in the Rust service until measurements justify another component.

## Repository layout

```
services/football-dynasty/
  Cargo.toml
  Cargo.lock
  Dockerfile
  src/
    main.rs
    config.rs
    http/
    auth/
    domain/
    application/
    persistence/
    simulation/
  migrations/
  tests/
```

The initial commit may contain only the service bootstrap and health endpoint. Do not scaffold unverified business rules as if implemented.

## First vertical slice

**Founder → club → family → heir → death → succession → continue as heir.**

Required service capabilities:
- create campaign and generated fictional world;
- create founder and family relationships;
- acquire a fictional club and establish ownership/control;
- appoint initial staff;
- create heir and validate succession rules;
- process death as a deterministic event;
- preview succession without writes;
- execute succession atomically and idempotently;
- reload campaign and chronicle after restart.

No 3D life simulation or full tactical match engine is required for this slice.

## Delivery sequence

- **Phase 0 — architecture and security:** ADR; exact Telegram wrapper contract; private schema exposure decision; runtime/migration role design; API threat model.
- **Phase 1 — Rust service bootstrap:** Axum server, configuration validation, tracing, graceful shutdown, Docker image, CI fmt/clippy/test, liveness and DB readiness.
- **Phase 2 — domain core:** pure Rust types and deterministic tests for age, kinship, relationship, ownership, succession, and ledger balancing.
- **Phase 3 — persistence:** additive private-schema migrations, SQLx repositories, transaction boundaries, campaign isolation, idempotency; disposable PostgreSQL tests.
- **Phase 4 — identity/API:** verified Telegram adapter, request context, ownership guards, versioned HTTP API, OpenAPI, rate limits, audit events.
- **Phase 5 — vertical slice:** founder, club, family, heir, death, succession, reload.
- **Phase 6 — frontend:** lazy-loaded `/dynasty` route, typed API client, feature screens, all nine locales.
- **Phase 7 — simulation and content:** deterministic bounded ticks, fictional leagues/clubs/players, season progression, budget-constrained rival AI.
- **Phase 8 — release validation:** save/reload, restart recovery, deterministic replay, cross-user isolation, migration drift, performance, existing Sherlock regression suite.

## Test strategy and acceptance gates

- Rust: `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo test --workspace`.
- Persistence: disposable PostgreSQL integration tests for foreign keys, transaction rollback, ledger balance, idempotency, and cross-campaign isolation.
- Security: forged/stale Telegram initData, spoofed Telegram ID, IDOR, unauthorized succession, replayed idempotency key.
- Simulation: fixed-seed replay yields byte-equivalent canonical state; bounded tick does not skip or double-apply events.
- Frontend: typecheck, build, unit/component tests, locale completeness, existing game smoke paths.
- Operational: container health, graceful shutdown, startup with invalid/missing configuration fails closed, database outage makes readiness fail.
- Release: no merge/deploy while required checks are queued, pending, or failing. No production migration before disposable tests and explicit release review.

## Explicit non-goals

No changes to existing football catalogue or Alias tables, no production migration during discovery, no service-role secret in browser, no LLM-authoritative game state, no Redis/Kafka/microservices in MVP, no automatic production deployment from this documentation PR.
