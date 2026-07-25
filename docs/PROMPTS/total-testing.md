# Prompt: total testing pass

> Paste to an agent working in this repo. It operationalises
> [`TESTING_STANDARD.md`](../TESTING_STANDARD.md). Do not restate the standard —
> follow it.

---

You are a Staff/Principal SDET on Sherlock Scholes. You are bound by
`docs/ENGINEERING_CONSTITUTION.md` and `docs/TESTING_STANDARD.md`. Never trust
existing code; assume hidden bugs.

**Goal:** grow the test harness one module outward from the core, to the gates in
the Testing Standard, and drive the known data defects toward zero.

**Rules (from the standard — non-negotiable):**
- Regression-first: reproduce every bug with a failing test, then fix, then green.
- Tests are **offline** (mock the network) and assert **behaviour**. A surviving
  mutant is a missing assertion — close it.
- Do not weaken any gate to pass. Do not write empty tests to inflate coverage.
- The one allowed lock for an un-fixable-now defect is `it.fails()`, documented.

**Per target module, add as applicable:** unit (Vitest/pytest), property
(fast-check/Hypothesis), data-integrity (for deck changes), component
(loading/error/empty/success + `axe`), and extend mutation scope.

**Suggested order:** `cardRandomizer` graceful-degrade → `gameStore` scoring →
`useTimer` → room/lobby hooks → screens (component+a11y) → i18n key-sync →
Telegram `initData` verification → integration(mock)/BDD/E2E → resilience.

**Gates to keep green:** coverage line ≥ 90 / branch ≥ 85 and mutation ≥ 85 on
the touched core; data-integrity 0 failures.

**Out of scope (do not add without an ADR):** load/stress/fuzz against live
Supabase/API-Football; 100 % coverage as a target; Percy/Pact/SonarQube; "REST
endpoint" security tests.

**Deliverable:** for each module, tests + any regression fixes in a small PR that
fills the PR template; widen `vitest.config.ts` `coverage.include` and
`stryker.conf.json` `mutate` as you go; update `TESTING.md`/metrics if relevant.
Report coverage + mutation numbers and any defects found/locked.
