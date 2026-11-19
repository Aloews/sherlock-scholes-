# Football Dynasty API

Rust/Axum backend for the Football Dynasty mode inside Sherlock Scholes.

## Local run

1. Copy `.env.example` to `.env`.
2. Run `docker compose up --build` from this directory.
3. Open `http://localhost:8080/health/ready`.

The compose database is disposable local development data. Do not point it at production.

## Telegram identity boundary

The service accepts raw Telegram Mini App `initData` in `x-tg-init-data`. It validates the payload directly against the existing `public.tg_validate_init_data(text)` SECURITY DEFINER function over the database connection. The verified function checks Telegram's HMAC and 24-hour freshness, reads the bot token from Vault, and returns only the verified Telegram user ID. The migration grants the restricted `fd_runtime` role EXECUTE on this one function; the browser never sends a Telegram ID, and the backend does not call the user-upsert RPC on every request.

## Database roles and connection modes

- `POSTGRES_URL` is preferred on Vercel: it is the Supavisor transaction-pooler connection and works over IPv4. SQLx disables the prepared-statement cache; each request opens a transaction and runs `SET LOCAL ROLE fd_runtime` plus the verified Telegram owner GUC before touching `fd` tables. `POSTGRES_URL_NON_POOLING` is a direct/local fallback. `FD_DATABASE_URL` can override either with a dedicated runtime login.
- `FD_MIGRATION_DATABASE_URL` is a separate privileged connection used only when `FD_RUN_MIGRATIONS=true`.
- After applying the foundation migration, provision a dedicated login for the API (never use the `postgres` superuser in production):

```sql
CREATE ROLE fd_app LOGIN PASSWORD '<set-a-unique-secret-in-your-secret-manager>' IN ROLE fd_runtime;
```

Deploy as a Vercel Container service in the existing Sherlock Scholes project. Use the existing `POSTGRES_URL` environment variable from the Supabase integration; Vercel's outbound database path is IPv4-only, so do not use the direct IPv6 host from `POSTGRES_URL_NON_POOLING`. The API switches to `fd_runtime` transaction-locally, so Supavisor transaction pooling is supported. A dedicated `fd_app` login can be added later and supplied through encrypted `FD_DATABASE_URL`; never put database URLs in the frontend.

For production, apply reviewed migrations through the controlled migration path and keep `FD_RUN_MIGRATIONS=false` on horizontally scaled API instances. Do not put database URLs in the frontend.

## Runtime configuration

- `FD_BIND_ADDR`: optional bind address; defaults to `0.0.0.0:$PORT` (8080 locally).
- `FD_DATABASE_URL`: optional restricted runtime connection override; on Vercel the default is `POSTGRES_URL`.
- `FD_MIGRATION_DATABASE_URL`: optional migration URL, required only when auto-migrations are explicitly enabled.
- `FD_ALLOWED_ORIGIN`: exact frontend origin allowed by CORS.
- `FD_MAX_CONNECTIONS`: SQLx pool size; default 2 for horizontally scaled instances.
- `FD_RUN_MIGRATIONS`: default false.

## API v1

All campaign routes require:
- `x-tg-init-data`: raw Telegram WebApp initData, validated by the existing Supabase database function.
- `Idempotency-Key`: unique value for each mutation (8–128 characters).

- `GET /health/live`
- `GET /health/ready`
- `GET /api/v1/campaigns`
- `POST /api/v1/campaigns`
- `GET /api/v1/campaigns/{campaign_id}`
- `POST /api/v1/campaigns/{campaign_id}/heirs`
- `POST /api/v1/campaigns/{campaign_id}/advance` returns `409 use_day_based_calendar`; decade-step advancement is disabled
- `POST /api/v1/campaigns/{campaign_id}/time/advance` (1–31 in-game days)
- `GET /api/v1/campaigns/{campaign_id}/events` (includes the inclusive `expires_on` deadline and `pending` / `resolved` / `expired` state)
- `POST /api/v1/campaigns/{campaign_id}/events/{event_id}/resolve`
- `GET /api/v1/campaigns/{campaign_id}/succession/preview`
- `POST /api/v1/campaigns/{campaign_id}/succession`

## First playable lifecycle

Create a campaign (founder age 40, one fictional club, family holding and balanced opening ledger), add an heir, advance the persisted calendar in bounded day steps, receive a weekly club-review event, resolve a choice with a persisted club/dynasty consequence, reach the founder's age-90 boundary through annual birthdays, preview eligible adult heirs, execute succession atomically, and continue as the heir. The legacy year-step route is retained only as an explicit `409` migration response; it cannot change campaign state. The chronicle and ledger survive service restarts because they are stored in PostgreSQL.

## Verification

The CI workflow starts a disposable PostgreSQL 17 service, applies migrations, and tests the full founder → heir → death → succession → reload flow, idempotent campaign creation, and Telegram authentication rejection. No production migration is run by CI.


## Season and event loop

- A new campaign starts with three persisted, actionable launch decisions; older campaigns with an empty event inbox are backfilled on first inbox read.
- A six-matchday, four-team fictional league schedule is persisted per campaign (12 fixtures). Existing campaigns are backfilled by migration 0007_season_fixtures.sql.
- Every simulated day resolves fixtures due on that date. Scores are deterministic from the campaign seed and fixture identity, then stored with a chronicle entry and a resolved match-report event.
- GET /api/v1/campaigns/{campaign_id}/season returns the fixture calendar and standings derived from played results.
- This is a bounded first season loop, not a tactical match engine or full season rollover system.


Weekly decisions rotate between board review, sponsor approach, supporter meeting and rival scouting report. Accepting the sponsor offer posts a balanced €250,000 EUR double-entry transaction to club cash and sponsorship revenue. The other choices update club reputation or dynasty prestige.


Fixture dates and season year are derived from each campaign's current game clock, not a hard-coded calendar year. The first match is scheduled for the next Saturday on or after the campaign start date. Migration 20261119150000 aligns existing production fixtures to the campaign year.
