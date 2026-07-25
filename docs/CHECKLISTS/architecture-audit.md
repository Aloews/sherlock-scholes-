# Architecture Audit Checklist

Periodic full-project audit (and the template for the "Stage 1 audit" an agent
runs before a large change). Pairs with [`ARCHITECTURE.md`](../ARCHITECTURE.md).
Assume hidden bugs — the goal is to find them.

## Map the system
- [ ] Layers & dependencies: `app → screens → features → shared`, no upward
      imports.
- [ ] Import cycles (`npx madge --circular src`) — expect **0**.
- [ ] Feature isolation: no feature imports another feature's internals.
- [ ] State: which stores exist, who mutates them, phase changes only via the
      state machine.
- [ ] Data flow: hook → service → Supabase → typed result; errors surfaced.
- [ ] Telegram surface: `initData`, lifecycle, theme, device.
- [ ] Supabase surface: tables, RLS, RPCs, realtime, edge functions, indexes.
- [ ] i18n coverage across 9 locales.

## Hunt for defects
- [ ] **Dead code** — unreferenced exports/files/props.
- [ ] **Duplicate code** — copy-pasted logic that should be shared.
- [ ] **Race conditions** — realtime + timer + retries interleaving; stale
      closures in effects.
- [ ] **Memory leaks** — subscriptions/timers/listeners without cleanup; state
      set after unmount.
- [ ] **Infinite re-render** — effect that updates its own dependency; setState in
      render.
- [ ] **Async bugs** — unhandled rejections, missing `await`, unbounded retries,
      no timeout.
- [ ] **Hidden exceptions** — `catch {}` that swallows on a critical path.
- [ ] **Type holes** — `any`/`as`/`!`/`@ts-ignore`; untyped network responses.
- [ ] **Nullable errors** — unchecked optional access; `!` past strictNullChecks.
- [ ] **Circular dependencies** — as above.
- [ ] **Performance** — whole-store reads, unbounded lists, heavy work on the
      round loop, unindexed hot queries, oversized bundle.

## Output
- [ ] Findings written up (severity, location, repro).
- [ ] Each real defect → a regression test (red) → fix → green, per PR.
- [ ] Systemic issues → an ADR / roadmap item.
