# Football Dynasty

Design and implementation baseline for the fictional Football Dynasty mode in Sherlock Scholes.

- GDD.md — game design and MVP acceptance criteria
- ARCHITECTURE.md — verified Rust backend integration architecture
- ADR-001-rust-backend.md — decision record for the separate Rust service
- DATA_MODEL.md — logical campaign data model
- IMPLEMENTATION_PLAN.md — implementation status and release gates
- `../../services/football-dynasty/` — Axum API, SQLx migrations, Docker/Railway config, and lifecycle tests

The first playable lifecycle is implemented in the current PR. Production migration, Railway deployment, and real Telegram smoke testing remain release gates.

## Runtime reliability constraints

- Production uses Supavisor transaction pooling. Runtime SQLx statements must go through the `fd_query!`, `fd_query_as!` or `fd_query_scalar!` helpers, which set `.persistent(false)`; do not reintroduce persistent prepared statements.
- Production currently sets `FD_MAX_CONNECTIONS=1` per Rust container. Initial campaign-panel requests must remain sequential unless the pool limit is deliberately changed and load-tested.
- Event API failures must remain distinguishable from an empty event list. The UI must show a retry path and must not silently convert a failed response into `[]`.
- Production verification requires an authenticated Telegram smoke test that loads the active campaign, retrieves the pending events and resolves one event without creating duplicate events.

