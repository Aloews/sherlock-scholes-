# Football Dynasty API

Rust/Axum backend for the Football Dynasty mode inside Sherlock Scholes.

## Local run

1. Copy `.env.example` to `.env`.
2. Set `SUPABASE_URL` and the public anon key for the Sherlock Scholes Supabase project. The service validates raw Telegram Mini App `initData` server-side through the existing `get_user_status(p_init_data)` RPC; the browser never sends a Telegram user ID.
3. Run `docker compose up --build` from this directory.
4. Open `http://localhost:8080/health/ready`.

The compose database is disposable local development data. Do not point it at production.

## Required runtime configuration

- `FD_DATABASE_URL`: PostgreSQL connection string. The service runs `SET ROLE fd_runtime` on every pooled connection.
- `SUPABASE_URL` and `SUPABASE_ANON_KEY`: server-side call to the existing Telegram verifier wrapper.
- `FD_ALLOWED_ORIGIN`: exact frontend origin allowed by CORS.
- `FD_RUN_MIGRATIONS`: default false; set true only in a controlled environment where the database URL has migration privileges.

Production migration and runtime credentials must be provisioned separately. Do not use a browser key as a database credential, and do not expose database URLs or Supabase service-role keys to the frontend.

## API v1

All campaign routes require:
- `x-tg-init-data`: raw Telegram WebApp initData, validated by Supabase.
- `Idempotency-Key`: unique value for each mutation (8–128 characters).

- `GET /health/live`
- `GET /health/ready`
- `GET /api/v1/campaigns`
- `POST /api/v1/campaigns`
- `GET /api/v1/campaigns/{campaign_id}`
- `POST /api/v1/campaigns/{campaign_id}/heirs`
- `POST /api/v1/campaigns/{campaign_id}/advance`
- `GET /api/v1/campaigns/{campaign_id}/succession/preview`
- `POST /api/v1/campaigns/{campaign_id}/succession`

## First playable lifecycle

Create a campaign (founder age 40, one fictional club, family holding and balanced opening ledger), add an heir, advance in bounded 1–10 year steps, reach the founder's deterministic age-90 death, preview eligible adult heirs, execute succession atomically, and continue as the heir. The chronicle and ledger survive service restarts because they are stored in PostgreSQL.

## Verification

The CI workflow starts a disposable PostgreSQL 17 service, applies migrations, and tests the full founder → heir → death → succession → reload flow, idempotent campaign creation, and Telegram authentication rejection. No production migration is run by CI.
