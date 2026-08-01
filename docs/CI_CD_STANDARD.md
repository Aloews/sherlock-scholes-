# CI/CD Standard

> Part of the [Engineering Constitution](./ENGINEERING_CONSTITUTION.md). CI is the
> enforcement layer of the constitution. **A red gate blocks merge — always.**

## 1. Pipeline (GitHub Actions, `.github/workflows/ci.yml`)

Runs on every push to `main` and every PR. Jobs (target state):

| Job | Runs | Gate |
| --- | --- | --- |
| `build` | `tsc` + `vite build` | build must pass |
| `lint` | ESLint + `madge --circular` / dependency-cruiser | 0 errors, no cycles |
| `frontend-tests` | `npm run test:cov` | unit+property+data-integrity + coverage gate |
| `mutation` | `npm run test:mutation` (Stryker, scoped core) | mutation score ≥ 80 (break) |
| `python-tests` | `pytest` in `football_scraper/` | offline property/unit pass |
| `security` | `npm audit` / `pip-audit`, secret scan, Semgrep | no high/critical, no secrets |
| `a11y` (as it grows) | axe in component/E2E | 0 serious violations |
| `e2e` (as it grows) | Playwright vs **local** Supabase | journeys pass |
| `lighthouse` (as it grows) | Lighthouse CI | budgets hold |

The current repo ships `build`, `frontend-tests`, `mutation`, `python-tests`
(added with the test harness). `lint`/`security`/`a11y`/`e2e`/`lighthouse` are
added as those layers grow — see [`TESTING_STANDARD.md`](./TESTING_STANDARD.md) § 7.

## 2. Quality gates (merge blockers)

Configure branch protection on `main` to **require** the gate jobs and forbid
merge while any is red. A gate is never bypassed by force-merge; changing a gate
threshold requires an ADR.

- TypeScript strict: pass.
- Coverage (core): line ≥ 90 %, branch ≥ 85 %.
- Mutation (core): ≥ 80 break / ≥ 85 target.
- Data-integrity: 0 failures.
- Security: 0 high/critical CVEs, 0 committed secrets.
- No dependency cycles.

## 3. Caching & speed

- Cache npm (`actions/setup-node` cache) and pip. Keep the mutation job scoped so
  it stays minutes, not hours (`stryker.conf.json` `mutate`).
- Fail fast: cheap jobs (lint, typecheck) gate before expensive ones where it
  helps signal.
- Upload the Stryker HTML report as a build artifact.

## 4. Deployment

- **Vercel deploys `main`** independently; CI is the safety net that turns a bad
  push red within minutes (as documented in the workflow header).
- Preview deploys per PR (Vercel bot) for manual/E2E verification against a real
  build.
- Supabase migrations are applied through the reviewed migration flow, never ad
  hoc in the dashboard. Edge functions deploy via the checked-in scripts.
- Rollbacks: a bad deploy is reverted by redeploying the previous green commit;
  DB changes are forward-only, so ship reversible migrations.

## 5. Branch & release hygiene

- Short-lived feature branches; draft PR early; squash-merge.
- `main` is always releasable and always green.
- Every merged PR maps to an issue or a clear rationale in its description.

## 6. Prohibitions (MUST NOT)

- MUST NOT merge past a red required gate.
- MUST NOT weaken/disable a gate to pass a change (ADR required).
- MUST NOT deploy schema changes outside the migration flow.
- MUST NOT store secrets in workflow files (use encrypted Actions secrets).
