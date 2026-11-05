# Football Dynasty API

Rust/Axum backend for the Football Dynasty mode inside Sherlock Scholes.

## Local run

1. Copy `.env.example` to `.env`.
2. Set `SUPABASE_URL` and the public anon key for the Sherlock Scholes Supabase project. The service validates raw Telegram Mini App `initData` server-side through the existing `get_user_status(p_init_data)` RPC; the browser never sends a Telegram user ID.
3. Run `docker compose up --build` from this directory.
4. Open `http://localhost:8080/health/ready`.

The compose database is disposable local development data. Do not point it at production.

## Database roles and connection modes

- `FD_DATABASE_URL` is the runtime connection. It must connect as a login role that is a member of `fd_runtime`; the service switches to that restricted role on each connection.
- `FD_MIGRATION_DATABASE_URL` is a separate privileged connection used only when `FD_RUN_MIGRATIONS=true`.
- After applying the foundation migration, provision a dedicated login for the API (never use the `postgres` superuser in production):

```sql
CREATE ROLE fd_app LOGIN PASSWORD '<set-a-unique-secret-in-your-secret-manager>' IN ROLE fd_runtime;
```

Store the resulting runtime connection string only in the backend host's encrypted secret manager. For Supabase's shared pooler, use session mode on port 5432 and username `fd_app.<project-ref>`; session mode is required because the service sets a database role per connection. Do not use transaction-pooler port 6543 for this service.

For production, apply reviewed migrations through the controlled migration path and keep `FD_RUN_MIGRATIONS=false` on horizontally scaled API instances. Do not put either database URL or Supabase service-role credentials in the frontend.

## Runtime configuration

- `FD_BIND_ADDR`: optional bind address; defaults to `0.0.0.0:$PORT` (8080 locally).
- `FD_DATABASE_URL`: restricted runtime connection string.
- `FD_MIGRATION_DATABASE_URL`: optional migration URL, required only when auto-migrations are explicitly enabled.
- `FD_ALLOWED_ORIGIN`: exact frontend origin allowed by CORS.
- `FD_MAX_CONNECTIONS`: SQLx pool size; default 2 for serverless container instances.
- `FD_RUN_MIGRATIONS`: default false.
- `SUPABASE_URL` and `SUPABASE_ANON_KEY`: server-side call to the existing Telegram verifier wrapper.

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
