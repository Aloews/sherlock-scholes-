# Operating model

## Roles

| Role | Owns |
|---|---|
| Human product owner | Desired outcome, business priorities, risk tolerance, approval boundaries, final product acceptance |
| Autonomous engineering agent | Discovery, implementation, testing, repair, review, CI, permitted release, verification, documentation |
| CI system | Reproducible automated checks tied to an immutable commit |
| Runtime/platform | Deployment execution, health signals, logs, metrics, rollback primitives |

The agent should not delegate product acceptance to CI. CI proves only the checks it actually runs.

## Durable task lifecycle

Use a persisted state machine. Suggested states:

1. `received` — request captured.
2. `scoped` — repository, environment, authority, outcome, and acceptance criteria known.
3. `inspected` — baseline and relevant system evidence captured.
4. `implementing` — changes in an isolated branch/worktree.
5. `locally_verified` — targeted checks pass.
6. `reviewed` — diff and security boundaries reviewed.
7. `ci_pending` / `ci_failed` / `ci_passed` — exact-SHA CI state.
8. `release_pending_approval` — release requires a human decision.
9. `deploying` — authorized release in progress.
10. `deployed` — platform confirms deployment of expected revision.
11. `production_verified` — critical path and operational checks pass.
12. `blocked` — a precise decision or missing capability prevents progress.
13. `completed` — all applicable definition-of-done gates have evidence.

Do not skip states to make a dashboard appear successful. A later commit invalidates checks tied to an earlier SHA.

## Task isolation and idempotency

Each task should have:

- Stable task ID.
- Source request URL and authenticated requester.
- Repository and base SHA.
- Unique branch/worktree.
- Bounded execution deadline.
- Maximum model attempts and token/cost budget.
- Current lifecycle state.
- Output commit SHA and PR URL.
- CI run IDs and conclusions.
- Deployment ID and health evidence, if released.
- Retry count and last error.

Use a lock or lease to prevent two workers from changing the same task or conflicting project state. Repeated delivery of the same event must not create duplicate branches, commits, PRs, deployments, or data writes. Use idempotency keys at every external side-effect boundary.

## Execution policy

- One task per isolated execution context by default.
- Limit changed files and patch size according to project risk.
- Use bounded model calls; one repair attempt is a reasonable default, not an unlimited loop.
- Run untrusted code only in an isolated environment without production secrets.
- Prefer PRs and reviewable commits to direct writes on the default branch.
- Keep deployment separate from code generation.
- Persist state before and after every irreversible side effect.
- On worker restart, resume from persisted state; do not repeat completed side effects.

## Human communication

The agent should not narrate routine steps. It should surface only:

- A decision requiring product-owner authority.
- A security, privacy, cost, or availability risk.
- A blocker that cannot be resolved using granted tools.
- A final report with evidence and remaining uncertainty.

A final report is not a celebration message. It is a release record.
