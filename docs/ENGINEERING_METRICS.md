# Engineering Metrics

> Part of the [Engineering Constitution](./ENGINEERING_CONSTITUTION.md). What we
> measure and the thresholds we hold. Metrics exist to catch regressions, not to
> be gamed — a green number with meaningless tests is a lie (that's why mutation
> score exists).

## 1. Coverage

- **Scope:** the core — `src/features/game`, `src/shared/lib`, `src/shared/store`,
  `football_scraper/scraper`.
- **Gate:** line ≥ 90 %, branch ≥ 85 %. **Target:** ≥ 95 %.
- Widen `coverage.include` in `vitest.config.ts` as tests reach new modules.
- Coverage is necessary, not sufficient — always paired with mutation.

## 2. Mutation score

- **Tooling:** StrykerJS (TS, `stryker.conf.json`), mutmut (Py,
  `football_scraper/setup.cfg`).
- **Gate:** break < 80. **Target:** ≥ 85 %, climbing.
- **Current:** 96.9 % on the bootstrap core (state machine + tier). The only
  survivors allowed are **equivalent mutants**, each justified in the PR.
- A surviving non-equivalent mutant is a missing assertion — add a test.

## 3. Type safety

- **Gate:** `tsc --noEmit` strict passes; **0** new `any`.
- Track `any`/`@ts-ignore` count over time; trend must be flat-or-down.

## 4. Architecture health

- **0 dependency cycles** (`madge --circular`).
- Layer-violation count (import from a higher layer) = **0**.
- Module size / complexity: flag files that grow past a sensible threshold
  (e.g. > 400 lines or high cyclomatic complexity) for a split.

## 5. Data quality

- Data-integrity suite: **0 failures** (merge gate).
- Open `it.fails()` defect locks: tracked, trending to **0** (currently D1, D2 —
  see [`DATA_QUALITY_STANDARD.md`](./DATA_QUALITY_STANDARD.md)).
- Duplicate-player count (by `canonical_key`): **0**.

## 6. Performance

- Bundle (initial JS, gz) ≤ 250 KB (target ≤ 180 KB).
- Lighthouse mobile: Perf ≥ 85, A11y ≥ 90 (target 90 / 100).
- Web Vitals (field): LCP ≤ 2.5s, INP ≤ 200ms, CLS ≤ 0.1.

## 7. Security

- 0 high/critical CVEs (`npm audit` / `pip-audit`).
- 0 committed secrets (secret scan).
- 0 Semgrep high-severity findings.

## 8. Maintainability & technical debt

- Technical debt is tracked as issues labelled `tech-debt`, not left as silent
  TODOs. A TODO in code MUST reference an issue.
- Each defect lock (`it.fails`) and each `tech-debt` issue has an owner and a
  target.
- "Architecture score" (informal): boundaries clean, no cycles, one way to do a
  thing, gates green. Reviewed at each roadmap checkpoint.

## 9. How metrics are reported

- CI prints coverage + mutation summaries and uploads the Stryker report.
- A change that moves any gate metric MUST call it out in the PR description.
- Trends (coverage, mutation, `any` count, open locks) are reviewed at roadmap
  checkpoints (see [`ROADMAP.md`](./ROADMAP.md)).
