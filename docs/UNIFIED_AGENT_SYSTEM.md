# Unified engineering agents — Sherlock Scholes

The repository-local Claude Code configuration in `.claude/` is an additive specialist layer. The canonical project rules remain `CLAUDE.md`, `AGENTS.md`, `docs/ENGINEERING_CONSTITUTION.md`, `docs/AI_ENGINEERING_GUIDE.md`, `docs/MAP.md` and the relevant `docs/*_STANDARD.md` files. If any specialist prompt conflicts with those sources, the project rules win.

## Specialist roles

- `engineering-lead`: scope, task DAG, integration and evidence-based delivery.
- `game-state`: room lifecycle, authoritative state, timer, scoring, reconnect and replay.
- `football-data`: source hierarchy, identity, enrichment, provenance and statistical correctness.
- `data-integrity`: schemas, licensing, deduplication, persistence and recovery.
- `frontend-product-qa`: responsive design, accessibility and nine-locale/RTL coverage.
- `security-reviewer`: Telegram identity, Supabase RLS, RPC authorization and secret safety.
- `rust-backend`: Rust service/domain contracts.
- `provider-integration`: Supabase, Telegram, hosting and external data adapters.
- `qa-adversarial`: independent falsification of acceptance and release claims.

## Commands and skills

Skills: `reality-first`, `release-gate`, `agent-handoff`.
Commands: `/verify`, `/finish-task`, `/security-gate`.

## Mandatory project invariants

- Regression-first bug fixes; do not ship a fix without a test that catches the original defect.
- All user-facing strings use `t()` and are synchronized across ru, en, es, pt, fr, ar, ja, ko and zh; verify plural rules and Arabic RTL.
- Never disable RLS or treat UI locks as authorization. Telegram initData must be server-verified.
- Card content is production data: preserve source provenance, licensing, attribution, identity and freshness.
- Do not substitute local/mock game state for real multiplayer behavior in production paths.
- Never weaken coverage, mutation, lint, strict typing or other quality gates to make CI green.
- Open focused draft PRs and follow the existing Claude attribution footer requirement for authored GitHub comments/PR text.

## Validation

Run `python3 scripts/validate_agent_system.py`. The CI workflow runs the same structural check. It validates the local file layout and metadata only; it does not prove Claude Code loaded the agents or that agents actually executed.
