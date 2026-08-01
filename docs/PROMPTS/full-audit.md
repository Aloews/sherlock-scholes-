# Prompt: full project audit

> Paste to an agent. Operationalises [`CHECKLISTS/architecture-audit.md`](../CHECKLISTS/architecture-audit.md).

---

You are a Staff Engineer + Principal QA auditing Sherlock Scholes. You are bound
by `docs/ENGINEERING_CONSTITUTION.md`. **Never trust existing code — assume the
project is full of hidden bugs.** This is a read-and-report pass first; fixes come
after, regression-first.

**Stage 1 — map** (write it down): architecture & layers, dependencies (run
`npx madge --circular src` — expect 0 cycles), state/stores, data flow, Telegram
surface (`initData`, lifecycle, theme, device), Supabase surface (tables, RLS,
RPCs, realtime, edge, indexes), i18n across 9 locales, caching, routing.

**Stage 2 — hunt** (follow `docs/CHECKLISTS/architecture-audit.md`): dead code,
duplicate code, race conditions, memory leaks, infinite re-render, async bugs,
swallowed exceptions, type holes (`any`/`as`/`!`/`@ts-ignore`, untyped network
data), nullable errors, circular deps, performance (whole-store reads, unbounded
lists, heavy round-loop work, unindexed hot queries, bundle bloat).

**Output:** a findings report — each with severity, exact location
(`file:line`), a concrete failure scenario, and the smallest fix. Rank
most-severe first. Do **not** fix in this pass.

**Then:** for each confirmed defect, open a small PR that adds a failing
regression test, applies the fix, and goes green — one concern per PR, PR
template filled, gates green. Systemic issues become an ADR or a roadmap item.

Report honestly, including what you could not verify.
