# Engineering Roadmap & Evolution Rules

> Part of the [Engineering Constitution](./ENGINEERING_CONSTITUTION.md). How the
> project — and this constitution — are allowed to evolve. The product roadmap
> lives in the root [`ROADMAP.md`](../ROADMAP.md); this is the **engineering**
> roadmap.

## 1. Rules of evolution

- **Standards evolve via ADR.** A new pattern, a changed gate, a dropped rule —
  each is an [ADR](./ADR/) plus the doc update. No silent drift.
- **Gates only move up, or move down with an ADR.** Raising a bar is encouraged
  and needs no ceremony; lowering one is a deliberate, documented decision.
- **One way to do a thing.** Introducing a second state manager, data-fetching
  layer, test framework, or styling approach requires an ADR that also says what
  it replaces.
- **Debt is tracked, not hidden.** New tech debt is an issue labelled `tech-debt`
  with an owner; TODOs reference issues.
- **Every phase ends green.** No phase is "done" while a gate is red or a defect
  lock is unaddressed.

## 2. Engineering phases

### Phase 0 — Foundations (in progress)
- [x] Test harness bootstrap: Vitest + fast-check + Stryker, pytest + Hypothesis
      + mutmut; coverage & mutation gates; data-integrity suite.
- [x] Engineering Constitution + standards (this doc set).
- [ ] Branch protection wiring the gate jobs as required checks.
- [ ] Lint + `madge` cycle check in CI.

### Phase 1 — Harden the core
- [ ] Grow coverage/mutation outward: randomizer graceful-degrade, scoring,
      timer, room/lobby hooks.
- [ ] Component tests (loading/error/empty/success + a11y) for all screens.
- [ ] i18n key-sync + RTL tests across all 9 locales.
- [ ] Telegram `initData` verification tests (valid/tampered/expired/absent).
- [ ] Close data defect locks **D1** (difficulty) and **D2** (dup player).

### Phase 2 — Integration & resilience
- [ ] Mocked integration + RPC contract snapshots.
- [ ] BDD/Gherkin for the game loop; Playwright E2E vs local Supabase.
- [ ] Chaos (mocked): Supabase sleep/timeout, offline, bad RPC, broken images.
- [ ] Realtime reconnect/room-recovery tests.

### Phase 3 — Production hardening
- [ ] Sentry (client + edge) + structured logging conventions.
- [ ] Security: Semgrep/CodeQL, dependency audit gates, RLS policy tests.
- [ ] Performance: Lighthouse CI + bundle budget in CI; search benchmarks.
- [ ] Visual regression (Playwright + pixelmatch) on key screens.

### Phase 4 — Scale & data depth
- [ ] Search at tens/hundreds of thousands of players (index + virtualisation).
- [ ] Deeper football-data validation (transfers/seasons/national-team facts).
- [ ] Deck/league packs, admin editor hardening.

## 3. Checkpoints

At the end of each phase, review the trend of the [engineering metrics](./ENGINEERING_METRICS.md):
coverage, mutation score, `any` count, open defect locks, bundle size, Web
Vitals. A phase advances only when its exit criteria are green and the metrics
did not regress.

## 4. Decision log

Significant decisions are recorded as ADRs in [`ADR/`](./ADR/). Start there to
understand *why* the project is the way it is before changing it.
