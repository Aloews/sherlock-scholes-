# 0003. Bootstrap testing: Vitest/Stryker + pytest/mutmut, gates, and defect locks

- **Status:** Accepted
- **Date:** 2026-07
- **Deciders:** Repository maintainer
- **Related:** [Testing Standard](../TESTING_STANDARD.md), [Data Quality Standard](../DATA_QUALITY_STANDARD.md), [`../../TESTING.md`](../../TESTING.md)

## Context

The frontend shipped with **zero tests**; CI ran only `typecheck` + `build`. The
app has real correctness risk in the game state machine and in the card deck
(several data inaccuracies were confirmed). We needed a real, runnable test
pipeline and a way to prove and pin defects, without over-engineering a
hobby-scale project on free-tier infrastructure.

## Decision

- **Frontend:** Vitest (unit) + fast-check (property) + StrykerJS (mutation),
  with a coverage gate (line ≥ 90 / branch ≥ 85) and a mutation gate (break 80)
  on the game-logic core, plus a data-integrity suite over `sherlock_cards.csv`.
- **Scraper:** pytest + Hypothesis (property) + mutmut (mutation), offline.
- **Defect handling:** regression-first. Fixable defects are fixed with a guarding
  test; defects whose fix is a data/product decision are **locked with
  `it.fails()`** — which asserts the defect still exists and fails when it's
  corrected, so it can't be forgotten.
- **CI:** add `frontend-tests`, `mutation`, `python-tests` jobs; `build` stays.

## Alternatives considered

- **Jest** instead of Vitest — rejected: Vitest fits the Vite toolchain natively.
- **100 % coverage target** — rejected: produces junk tests; we pair 90 %+ with
  mutation score (which measures whether tests actually assert).
- **Load/stress/fuzz against live Supabase & API-Football** — rejected: free tier,
  rate-limited, and testing against production is harmful. Only local/mocked.
- **Paid SaaS (Percy/Pact/SonarQube)** — rejected: disproportionate at this scale.
- **Deleting the bad data silently** — rejected for the ambiguous cases; a lock
  makes the defect visible and owned.

## Consequences

- **Positive:** real pipeline (bootstrap: 100 % core coverage, 96.9 % mutation);
  defects are proven and pinned, not hidden; CI enforces the bar.
- **Negative:** the `it.fails()` locks (D1 difficulty, D2 dup player) are open
  debt that must be driven to zero; the harness must be grown outward.
- **Follow-ups:** [Roadmap](../ROADMAP.md) phases 1–3 grow coverage/mutation and
  add component/integration/E2E/security layers; close D1 and D2.

## Compliance

Gates enforced in CI (see [CI/CD Standard](../CI_CD_STANDARD.md)); non-goals are
listed in the Testing Standard § 6 and require an ADR to override.
