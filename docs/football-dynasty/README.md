# Football Dynasty

Design and implementation baseline for the fictional Football Dynasty mode in Sherlock Scholes.

- GDD.md — game design and MVP acceptance criteria
- ARCHITECTURE.md — verified Rust backend integration architecture
- ADR-001-rust-backend.md — decision record for the separate Rust service
- DATA_MODEL.md — logical campaign data model
- IMPLEMENTATION_PLAN.md — implementation status and release gates
- `../../services/football-dynasty/` — Axum API, SQLx migrations, Docker/Railway config, and lifecycle tests

The first playable lifecycle is implemented in the current PR. Production migration, Railway deployment, and real Telegram smoke testing remain release gates.
