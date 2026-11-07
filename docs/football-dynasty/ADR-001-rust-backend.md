# ADR-001: Separate Rust backend for Football Dynasty

- **Status:** Accepted for implementation
- **Date:** 2026-11-05
- **Scope:** Football Dynasty module in Sherlock Scholes

## Context

Sherlock Scholes is currently a React/Vite Telegram Mini App whose feature services call Supabase PostgREST/RPC, with selected Edge Functions. Football Dynasty requires deterministic long-running simulation, complex transactional succession, ownership and financial ledgers, idempotent commands, and explicit domain boundaries. Implementing the authoritative game state in browser code or a growing collection of public RPCs would make the security and simulation boundaries harder to reason about.

A separate Supabase project could not be provisioned: the connected organization has reached its free-plan limit of two active projects. No existing project was paused or deleted. A Supabase development branch was quoted at $0.01344/hour and has not been created or approved.

## Decision

Build one independently deployed Rust backend service using Axum, Tokio, SQLx, and PostgreSQL. Keep the existing Sherlock Scholes frontend and Telegram entry point. Use the existing managed Supabase PostgreSQL project as the initial database provider, with a private fictional-game schema and dedicated least-privilege database roles.

The Rust service is the sole application writer for Football Dynasty state. The frontend communicates with it through a versioned HTTPS API. Existing real football catalogue tables and Alias gameplay tables remain outside this bounded context.

## Identity and security

The service must validate raw Telegram Mini App initData on the server. It must not accept a Telegram ID supplied by the browser. The production `public.tg_validate_init_data(p_init_data text)` function was inspected: SECURITY DEFINER, fixed search path, Telegram HMAC and 24-hour freshness validation, Vault bot-token lookup, and bigint Telegram ID result. Its original ACL was postgres/service_role only. The migration grants EXECUTE only to `fd_runtime`; the Rust service calls it over SQLx. This avoids the `get_user_status` wrapper's per-request user-row upsert. Never expose service-role credentials or database credentials to the frontend.

Use a NOLOGIN `fd_runtime` role with only private-schema privileges and a separate `fd_app` LOGIN member. Migrations use a separate privileged connection. Campaign ownership is enforced in the Rust service using the verified Telegram ID; the private `fd` schema is not exposed through PostgREST. Do not assume RLS automatically sees Telegram identity when SQLx uses a backend database role.

## Consequences

- Adds Rust service build, deployment, monitoring, and API compatibility responsibilities.
- Allows domain logic and deterministic simulation to be tested independently of React.
- Keeps Supabase as managed PostgreSQL, avoiding a second database product initially.
- Requires a Railway service with outbound IPv6 for Supabase direct PostgreSQL, a private-schema migration, a restricted database login, and real Telegram end-to-end verification before production.
- No Redis or separate worker is required for the first vertical slice; introduce only after measured need.

## Rejected alternatives

- **Frontend + direct PostgREST/RPC only:** rejected for authoritative simulation and transactional game-domain complexity.
- **Supabase Edge Functions as the whole game backend:** rejected as the primary domain runtime; retain only for narrow existing platform integrations if later justified.
- **Multiple microservices and Redis at MVP:** rejected as premature operational complexity.
- **A second Supabase project now:** unavailable under the current free-project limit without pausing/deleting an existing project or changing plan.
