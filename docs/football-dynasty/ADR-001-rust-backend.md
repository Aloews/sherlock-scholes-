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

The service must validate raw Telegram Mini App initData on the server. It must not accept a Telegram ID supplied by the browser. The production verifier `tg_validate_init_data` is not directly callable by ordinary client roles; the exact wrapper response and grants must be verified before integration. Never expose Supabase service-role credentials or database credentials to the frontend.

Use separate runtime and migration database roles. Runtime role has only the privileges required by the private Football Dynasty schema. Apply RLS or equivalent database defense-in-depth according to the final connection/auth model; do not assume RLS policies automatically see Telegram identity when SQLx uses a backend database role.

## Consequences

- Adds Rust service build, deployment, monitoring, and API compatibility responsibilities.
- Allows domain logic and deterministic simulation to be tested independently of React.
- Keeps Supabase as managed PostgreSQL, avoiding a second database product initially.
- Requires explicit API auth, database role, schema exposure, migration, backup, and deployment decisions before production.
- No Redis or separate worker is required for the first vertical slice; introduce only after measured need.

## Rejected alternatives

- **Frontend + direct PostgREST/RPC only:** rejected for authoritative simulation and transactional game-domain complexity.
- **Supabase Edge Functions as the whole game backend:** rejected as the primary domain runtime; retain only for narrow existing platform integrations if later justified.
- **Multiple microservices and Redis at MVP:** rejected as premature operational complexity.
- **A second Supabase project now:** unavailable under the current free-project limit without pausing/deleting an existing project or changing plan.
