# Sherlock Scholes — Rust Migration Inventory

**Baseline:** `main` at `df937667e6d950f1788c23abd3f9cf855679c92f`  
**Observed:** 2026-11-11  
**Purpose:** capability-level inventory for the full Rust migration. This file records what exists in the repository; it does not claim parity or production readiness.

## Migration objective

Migrate the complete Sherlock Scholes application and its business logic to Rust in incremental, independently verifiable slices. Preserve the existing Supabase project and PostgreSQL data, Telegram Mini App identity model, user-visible journeys, data provenance, RLS boundaries, and production URLs unless an explicitly reviewed change proves necessary.

A compiling Rust service is not completion. The target includes browser/Telegram UI, application state, domain logic, APIs, authorization, integrations, collectors, scheduled jobs, admin operations, and tests. Any non-Rust component retained for a concrete browser/Telegram/platform constraint must have an explicit reason, interface, owner, and retirement condition.

## Observed repository baseline

| Surface | Observed count | Current implementation |
|---|---:|---|
| Top-level route screens | 26 | React + TypeScript |
| Feature domains | 30 | React/TypeScript modules |
| Supabase Edge Function directories | 12 | Deno / TypeScript |
| GitHub Actions workflows | 31 | YAML orchestration, Python/TypeScript/Rust jobs |
| Python collector / analytics modules (excluding tests) | 30 | Python |
| Existing Rust service | 1 | Axum + Tokio + SQLx, Football Dynasty only |
| Supabase database | 1 existing production project | PostgreSQL, PostgREST, RPC, RLS, Realtime, Edge Functions |

These are repository tree counts, not runtime coverage metrics. Nested components and route-level aliases are not additional product capabilities.

## Existing navigation contract

Source: `src/app/Router.tsx`. All route entries below require behavioural parity; legacy aliases must continue to resolve until existing Telegram/deep links are proven retired.

### Primary routes

- `/`
- `/lobby`
- `/game`
- `/end`
- `/training`
- `/tutorial`
- `/collection`
- `/profile`
- `/sources`
- `/friends`
- `/matches`
- `/fantasy`
- `/chess`
- `/digest`
- `/news`
- `/duel`
- `/spotlight`
- `/amateur`
- `/club/:key`
- `/table`
- `/table/:tournament`
- `/minigames`
- `/arena`
- `/dynasty`
- `/admin`

### Redirects / compatibility routes

- `/ratings`
- `/clubs`
- `/quiz`
- `/famous`
- `/squad`
- `/arena/online`
- `/pro`
- `*`

Route count: 33 declarations (25 primary entries and 8 redirects/fallback entries). Dynamic path parameters and query-string behaviour are part of the contract.

## Feature-domain inventory

- `src/features/admin`
- `src/features/amateur`
- `src/features/arena`
- `src/features/auth`
- `src/features/chess`
- `src/features/clubs`
- `src/features/collection`
- `src/features/decks`
- `src/features/digest`
- `src/features/duel`
- `src/features/famous`
- `src/features/fantasy`
- `src/features/fixtures`
- `src/features/football-dynasty`
- `src/features/friends`
- `src/features/game`
- `src/features/lobby`
- `src/features/pro`
- `src/features/quests`
- `src/features/quiz`
- `src/features/ratings`
- `src/features/reports`
- `src/features/rights`
- `src/features/room`
- `src/features/soccerwiki`
- `src/features/social`
- `src/features/spotlight`
- `src/features/squad`
- `src/features/transfers`
- `src/features/voice`

Every feature must be decomposed into its screens, API contracts, state transitions, authorization requirements, external dependencies, and test fixtures before migration status can advance beyond `NOT_ASSESSED`.

## Supabase Edge Function inventory

- `supabase/functions/amateur-logo/`
- `supabase/functions/assistant-bot/`
- `supabase/functions/digest-summary/`
- `supabase/functions/football-digest/`
- `supabase/functions/football-fixtures/`
- `supabase/functions/football-national/`
- `supabase/functions/football-odds/`
- `supabase/functions/football-scores-espn/`
- `supabase/functions/livekit-token/`
- `supabase/functions/smart-deck-builder/`
- `supabase/functions/smart-deck-editorial/`
- `supabase/functions/tg-pay/`

Each function must be classified as user-facing request handling, privileged operation, integration adapter, or content/data pipeline. Preserve JWT verification, Telegram initData verification, rate limits, RLS, service-role isolation, idempotency, and response contracts. A function is not replaceable until its caller inventory and production traffic are known.

## Scheduled jobs and automation inventory

- `.github/workflows/accumulator-settlement-regression.yml`
- `.github/workflows/award-and-tournament-candidates.yml`
- `.github/workflows/card-tier-market-value-regression.yml`
- `.github/workflows/cards-descriptions.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/daily-enrich.yml`
- `.github/workflows/deck-squad-filter-regression.yml`
- `.github/workflows/deploy.yml`
- `.github/workflows/dynamic-player-discovery-regression.yml`
- `.github/workflows/espn-results-refresh.yml`
- `.github/workflows/football-dynasty-rust.yml`
- `.github/workflows/forecast.yml`
- `.github/workflows/llm-finetuning.yml`
- `.github/workflows/local-autonomous-agent.yml`
- `.github/workflows/multimarket-odds-collection.yml`
- `.github/workflows/player-honours.yml`
- `.github/workflows/player-market-value-refresh.yml`
- `.github/workflows/player-profile-data.yml`
- `.github/workflows/player-stats-sql-regression.yml`
- `.github/workflows/player-stats.yml`
- `.github/workflows/profile-backfill-queue-tests.yml`
- `.github/workflows/profile-backfill-queue.yml`
- `.github/workflows/room-code-concurrency.yml`
- `.github/workflows/room-code-regression.yml`
- `.github/workflows/rpl-standings-source-regression.yml`
- `.github/workflows/settle-market-quotes.yml`
- `.github/workflows/smart-deck-intent-regression.yml`
- `.github/workflows/soccerwiki-roster-refresh.yml`
- `.github/workflows/supabase-production-backup.yml`
- `.github/workflows/transfer-refresh-queue-regression.yml`
- `.github/workflows/women-stats-backfill.yml`

Workflows may trigger other workflows, update Supabase, call external providers, or publish artifacts. Migration requires a dependency graph (trigger, schedule, secrets, upstream status, side effects, timeout, retry, idempotency, output tables) and a verified Rust replacement or a documented platform exception. Do not run collectors merely to test migration wiring.

## Python collector / analytics inventory

- `football_scraper/accumulator_backtest.py`
- `football_scraper/calibration.py`
- `football_scraper/espn_stats.py`
- `football_scraper/fetcher.py`
- `football_scraper/forecast_duel.py`
- `football_scraper/forecast_pipeline.py`
- `football_scraper/forecast_winner.py`
- `football_scraper/legend_guard.py`
- `football_scraper/legends_wikidata_recon.py`
- `football_scraper/paper_bankroll.py`
- `football_scraper/paper_bankroll_math.py`
- `football_scraper/ratings.py`
- `football_scraper/run.py`
- `football_scraper/scraper/__init__.py`
- `football_scraper/scraper/api_football.py`
- `football_scraper/scraper/cache.py`
- `football_scraper/scraper/config.py`
- `football_scraper/scraper/dedup.py`
- `football_scraper/scraper/espn.py`
- `football_scraper/scraper/history.py`
- `football_scraper/scraper/pageviews.py`
- `football_scraper/scraper/pipeline.py`
- `football_scraper/scraper/sports_ru.py`
- `football_scraper/scraper/supabase_writer.py`
- `football_scraper/scraper/team_filter.py`
- `football_scraper/scraper/wikidata.py`
- `football_scraper/sports_ru_stats.py`
- `football_scraper/stadium_photo_audit.py`
- `football_scraper/women_leagues_probe.py`
- `football_scraper/women_stats_backfill.py`

The tree also contains Python tests and supporting configuration/data files. The listed modules are only the initial source inventory. Build a call graph and group modules by capability: source adapters, parsers, identity resolution, data validation, persistence, market values, statistics, forecasts, calibration, and operations. Preserve source attribution and freshness; do not port a parser without fixture-based parity tests.

## Existing Rust foundation

- Service: `services/football-dynasty/`
- Framework/runtime: Axum, Tokio, SQLx, PostgreSQL.
- Database boundary: private `fd` schema and owner-scoped role; it is isolated from real-football and Alias data.
- Existing API endpoints: campaign list/create/read, heir creation, time advance, succession preview/execute.
- Existing Rust code is a separate product vertical slice, not the Rust migration of the rest of Sherlock Scholes.
- The frontend currently calls Supabase directly for most features. `docs/ARCHITECTURE.md` describes the legacy React + PostgREST/RPC/Edge Functions architecture.

## Migration state

All capability groups begin at `NOT_ASSESSED` until implementation and production behaviour are inspected individually.

| Capability group | Legacy surface | Rust target | State | Required proof |
|---|---|---|---|---|
| Browser / Telegram app shell | `src/app/`, `src/shared/` | Rust/WASM app shell | NOT_ASSESSED | Telegram WebView compatibility, startup, routing, i18n, accessibility, performance |
| Alias game | `src/features/game`, `lobby`, `room`, `voice` | Rust domain + Rust/WASM client | NOT_ASSESSED | Room lifecycle, concurrency, reconnect, timers, replay, voice providers, deep links |
| Football discovery | `clubs`, `fixtures`, `collection`, `ratings`, `transfers`, `spotlight` | Rust domain/API + UI | NOT_ASSESSED | Identity, source provenance, freshness, pagination, filters, sorting, parity fixtures |
| Forecasts / awards / fantasy | `duel`, `fantasy`, forecast pipelines | Rust domain/API + jobs | NOT_ASSESSED | Leakage-safe snapshots, settlement, calibration, evaluation, consistent metric definitions |
| Social / amateur | `friends`, `social`, `amateur`, `quests` | Rust domain/API + UI | NOT_ASSESSED | Telegram identity, owner isolation, RLS-equivalent authorization, uploads, abuse limits |
| News / media / digest | `digest`, `famous`, `quiz`, `squad`, `rights` | Rust domain/API + adapters | NOT_ASSESSED | Attribution, content rights, source freshness, media playback, deduplication |
| Admin / operations | `admin`, operational screens and workflows | Rust admin API + UI | NOT_ASSESSED | Privileged auth, audit trail, bounded jobs, secrets isolation, rollback |
| Data collection | `football_scraper/`, workflows, Edge Functions | Rust collectors/workers | NOT_ASSESSED | Fixture parity, source identity, bounded retries, yield, freshness, cost, observability |
| Database / authorization | Supabase Postgres, RPC, RLS, Realtime | Existing Postgres with Rust SQLx boundary | NOT_ASSESSED | No data loss, policy parity, least privilege, transaction and concurrency tests |
| Football Dynasty | `services/football-dynasty/`, `fd` schema | Existing Rust service | IMPLEMENTED (partial product scope) | Remaining game simulation scope is tracked separately; this does not count as full-app migration |

## Required technical decisions before broad porting

1. **Rust/WASM UI framework:** benchmark at least two viable Rust browser frameworks against Telegram WebView constraints, bundle size, routing, i18n, accessibility, canvas/voice/media integrations, and maintainability. Do not select based on preference alone.
2. **Backend topology:** decide whether the existing Football Dynasty Axum service becomes a shared Rust API workspace or remains a separately bounded service. Do not deploy duplicate services or repurpose unrelated Railway workloads.
3. **Database access:** preserve the existing Supabase Postgres database and RLS/ownership model. Define a typed SQLx data-access layer and service roles; never put service credentials in the browser.
4. **Realtime:** explicitly map Supabase Realtime channels, room presence, and broadcast semantics to a Rust-compatible transport before replacing clients.
5. **AI gateway:** Starimg is the only approved model gateway. No direct provider calls or silent fallback paths.
6. **Deployment:** retain the current production origin and Telegram entry point during migration; route only parity-tested slices to Rust and keep a tested rollback path.
7. **Collectors:** port by source adapter and data contract, not by translating Python files mechanically. Keep source-specific fixtures and data-yield comparisons.

## Release gates for each migration slice

- [ ] Legacy callers and side effects inventoried.
- [ ] Rust contract and authorization boundary specified.
- [ ] Existing production data and schema inspected; no destructive schema rewrite.
- [ ] Golden fixtures captured from trusted legacy behaviour.
- [ ] Rust unit/property tests pass.
- [ ] PostgreSQL integration and RLS/owner-isolation tests pass.
- [ ] Telegram/browser E2E tests pass on the Rust slice.
- [ ] Performance and failure/retry behaviour meet recorded thresholds.
- [ ] CI is green on the exact PR head.
- [ ] Preview deployment is tested; production cutover is separately approved and reversible.
- [ ] Legacy implementation is retired only after production parity is proven.

## Immediate next executable work

1. Generate the exact route-to-screen-to-feature-to-API dependency graph from the current source.
2. Inventory all Supabase RPC/PostgREST calls and map them to tables, functions, RLS policies, and callers.
3. Inventory Edge Function and workflow triggers, secrets, schedules, side effects, and outputs.
4. Build a Telegram WebView Rust/WASM proof-of-concept and compare framework candidates with a repeatable benchmark.
5. Choose the first complete parity slice based on dependency centrality and user impact; do not start with an isolated toy screen.

**Current conclusion:** the repository has a substantial Rust Football Dynasty vertical slice, but the main Sherlock Scholes application remains predominantly React/TypeScript, with Python collectors and Supabase Edge Functions. Full Rust migration has not started at application-wide parity level.
