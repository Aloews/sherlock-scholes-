# Testing Standard

> Part of the [Engineering Constitution](./ENGINEERING_CONSTITUTION.md).
> Operational how-to (commands, layout) is in [`../TESTING.md`](../TESTING.md);
> the ready-to-run agent prompt is in [`PROMPTS/total-testing.md`](./PROMPTS/total-testing.md).
> This document is the **policy**.

## 1. Philosophy

We surround code with a chain of tests so correctness is enforced, not inspected:
**static → unit → property → data-integrity → component → integration(mock) →
BDD → mutation → coverage → security/a11y**. "Tests pass" without a mutation
report is not a result. Tests assert **behaviour**, not implementation — a
surviving mutant is a hole in a test, closed with a meaningful assertion.

Every bug is fixed **regression-first**: a failing test that reproduces it, then
the fix, then green. A test without a prior red run is invalid.

## 2. Test types (all are in scope)

| Type | Tool | Applies to |
| --- | --- | --- |
| Static analysis | `tsc` strict, ESLint, `madge`/`dependency-cruiser`, Semgrep | everything |
| Unit | Vitest (TS), pytest (Py) | pure logic, stores, hooks, utils, validators, services |
| Property-based | fast-check (TS), Hypothesis (Py) | invariants: state machine, scoring, `canonical_key` |
| Data-integrity | Vitest over `sherlock_cards.csv` | the deck (see [`DATA_QUALITY_STANDARD.md`](./DATA_QUALITY_STANDARD.md)) |
| Component | Vitest + Testing Library + `axe` | every React component |
| Snapshot | Vitest | stable presentational components |
| Integration (mocked) | Vitest, mocked PostgREST | Front → RPC → Telegram → cache path |
| Contract | RPC response-schema snapshot | Front ↔ Supabase RPC |
| BDD / Gherkin | Playwright + `@cucumber/cucumber` | the game loop (RU features allowed) |
| E2E | Playwright | full user journeys, on **local** Supabase / mock |
| Mutation | StrykerJS (TS), mutmut (Py) | the game-logic + data core |
| Resilience / Chaos | mocked failures | Supabase sleep/timeout, offline, broken images, bad RPC |
| Accessibility | `axe`, keyboard, WCAG AA | all components & E2E |
| Security | see [`SECURITY_STANDARD.md`](./SECURITY_STANDARD.md) | RLS, `tg-pay`, `initData`, `npm audit` |
| Visual regression | Playwright + `pixelmatch` (local, no SaaS) | key screens |

## 3. What MUST be tested

- **State machine** (`features/game/stateMachine.ts`): every legal transition
  succeeds, every illegal one is refused, exhaustive over `GamePhase`; property
  test that no sequence escapes the transition table.
- **Scoring** (`shared/store/gameStore.ts`): correct/skipped accounting; score
  never negative.
- **Randomizer graceful-degrade** (`features/game/cardRandomizer.ts`): each
  `PGRST202` fallback path keeps the game working; retry/backoff behaviour.
- **Pure libs** (`shared/lib/*`): `tier`, `flag`, `countryName`, `cardName`,
  `pro` — direct unit + property tests.
- **Telegram** (`shared/lib/telegram.ts`): `initData` parse + **signature
  verification** (valid/tampered/expired/absent), theme, lifecycle, cleanup.
- **i18n**: all 9 locales have matching keys, no empties, matching interpolation
  placeholders, RTL for `ar`.
- **Deck**: the data-integrity invariants.
- **Dedup** (`scraper/dedup.canonical_key`): property tests (done).

## 4. Determinism (MUST)

- Tests run **offline**. No real Supabase / API-Football / network. Mock the
  boundary. The scraper tests are marked "NO network" — keep that bar.
- No `skip`/`xfail`/commented tests to make CI green. The one sanctioned pattern
  is `it.fails()` to **lock a known defect** — it asserts the bug still exists and
  fails when fixed (see [`DATA_QUALITY_STANDARD.md`](./DATA_QUALITY_STANDARD.md) § 6).
- Seed randomness; freeze time for timer tests.

## 5. Gates (enforced in CI)

- Coverage on the core (`features/game`, `shared/lib`, `shared/store`,
  `scraper/`): **line ≥ 90 %, branch ≥ 85 %**.
- **Mutation score ≥ 85 %** on the core (Stryker break threshold 80). No new
  meaningful survivors; equivalent mutants justified in the PR.
- 0 failing unit/property/data-integrity/BDD/a11y tests.
- Data-integrity is a **merge gate**: bad data does not ship.

See [`CI_CD_STANDARD.md`](./CI_CD_STANDARD.md).

## 6. Deliberately excluded (MUST NOT add without an ADR)

These are wrong for this project (free-tier Supabase, API-Football 100 req/day,
hobby scale):

- **Load/stress (k6/Locust) or fuzz against live Supabase / API-Football.** Only
  meaningful on a **local** stack or a mock; running it live rate-limits and can
  take down the deployment.
- **Dogmatic 100 % Lines/Branches/Functions.** Produces junk tests; we hold
  90 %+ on the core plus a high mutation score.
- **Paid SaaS (Percy, Pact, SonarQube).** Visual regression via Playwright +
  `pixelmatch`; contract via RPC-schema snapshots.
- **"API endpoint" security tests (SQLi/CSRF/path-traversal on REST routes).**
  There is no custom HTTP API; the real surface is RLS + `tg-pay` + `initData`.

## 7. Growing the harness

The current state is the bootstrap layer (state machine, tier, data-integrity,
dedup — 100 % core coverage, 96.9 % mutation). Grow outward one module per PR;
widen `coverage.include` (`vitest.config.ts`) and `mutate` (`stryker.conf.json`)
as you go. The target order: randomizer degrade → scoring → hooks → components/
i18n/Telegram/a11y → integration/BDD/E2E → resilience → security.
