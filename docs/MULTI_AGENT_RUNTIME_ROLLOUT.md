# Multi-Agent Delivery System — Runtime Rollout

**Last checked:** 2026-11-13  
**Purpose:** distinguish the intended multi-agent architecture from what is actually provisioned.

## Existing foundation

- The repository already contains the Reality-First Autonomous Engineering skill and a bounded GitHub issue-to-PR worker design in PR #389.
- The custom Railway `stream-service` is the current autonomous coding worker and uses Starimg as its model gateway. The worker is not, by itself, a multi-agent team with independent QA.
- The configured task worker accepts owner-authenticated `/ai` issue comments, processes one task per poll, and creates isolated branches/PRs. Its write permissions are bounded by a repository allowlist and path policies.
- The connected GitHub allowlist in the worker PR names six repositories: Sherlock Scholes, First Traffic Platform, Russian Dev Projects, Sherlock TV, Sherlock AI Bot, and Novel Forge. Any new repository requires explicit allowlist and path-policy review.
- PR #389 is open and unmerged. PR #404 is also open and unmerged. Their contents must not be described as merged into the default branch.
- Current task #394 has a demonstrated failure: the worker stopped after three patch attempts against `services/football-dynasty/src/roster.rs` because the generated patch did not apply. This is evidence that the current single-worker loop is not yet reliable enough to serve as a quality-controlled delivery system.

## Verified platform constraints

- Railway Automations are not enabled for this account; listing them returns an explicit “not enabled” error.
- Railway Cloud Agent Tasks currently return an empty task list in this environment.
- The Railway Cloud Agent model catalog returned Claude Haiku 5.5, Sonnet 5.5, Opus 5.5 and Fable 5.1; it did not list Fable 5.2.
- The custom worker's Starimg configuration is separate from Railway's built-in Cloud Agent model catalog. Do not infer one catalog from the other.
- No second independent QA worker has been provisioned or verified as running. The existing `sherlock-ai-bot` service is not evidence of an independent QA role.

## Required runtime implementation

### Phase A — durable orchestration and task ledger

- Add a persisted task/lease state machine with unique task IDs, idempotency keys, bounded retries and per-project isolation.
- Store role assignments, task dependencies, branch/base/head SHAs, test evidence, review verdicts, CI run IDs, deployment IDs and terminal state.
- Ensure one active writer per conflicting repository/path/schema/deployment resource.
- Resume safely after worker restart without repeating completed side effects.

### Phase B — separate execution roles

- Keep the current Starimg/Fable coding worker as Implementation Lead.
- Add an independent read-only Reviewer worker. It consumes a PR and exact head SHA, inspects the full diff and relevant source/tests, and emits a structured review verdict with file/line evidence. It must not push commits or alter the implementation branch.
- Add a QA worker that derives tests from acceptance criteria and risk, runs them in an isolated environment, and reports commands, logs, artifacts and exact SHA. It must not approve its own generated tests.
- Add a security/reliability reviewer for changes involving auth, data isolation, migrations, secrets, payments, infrastructure or production operations.
- Add a coordinator that owns task state and prevents overlapping writers. It may fan out read-only reviews in parallel after an implementation candidate is frozen.

### Phase C — automated gates

- Require review verdict, QA report, applicable security verdict, and exact-head GitHub CI before a PR is eligible for merge.
- A new commit invalidates all previous review and test results.
- A failed gate creates a bounded correction task for the implementation owner; do not let reviewers silently edit the implementation branch.
- Block merge/release when required checks are pending, stale, failed, or unavailable.
- Add integration tests for duplicate events, task leases, worker restarts, concurrent PRs, stale SHAs, provider quota errors, and idempotent retries.

### Phase D — rollout and proof

- Start with one project and one low-risk task in a non-production branch.
- Prove developer → reviewer → QA → correction → re-review → exact-SHA CI as one end-to-end cycle.
- Run at least three distinct tasks, including a multi-file feature and a failure/recovery case, before enabling the system across the allowlist.
- Enable more concurrent implementers only after lease/conflict tests pass.
- Add repositories one by one with explicit path allowlists and environment boundaries.
- Do not create duplicate Railway services or enable the Telegram bot as a QA agent without a separate role entrypoint, queue/lease isolation, read-only credentials and an observed end-to-end test.

## Acceptance tests for operational readiness

- [ ] One user task produces a durable task record and explicit acceptance contract.
- [ ] Coordinator selects roles according to task complexity.
- [ ] Parallel read-only reviewers can inspect the same frozen SHA without conflicting writes.
- [ ] Only one implementation owner can hold a conflicting write lease.
- [ ] A stale SHA is rejected and forces re-review/re-test.
- [ ] Reviewer can identify a seeded defect and block the PR.
- [ ] QA can fail a seeded regression and attach reproducible evidence.
- [ ] A correction triggers all affected gates again.
- [ ] Provider 402/auth failures stop retries and preserve a precise blocker.
- [ ] Worker restart resumes without duplicate branches, PRs, migrations or deployments.
- [ ] Required CI, review, QA and security checks gate merge/release.
- [ ] Production deployment and production data writes remain behind the configured approval boundary.
- [ ] The system completes three end-to-end pilot tasks with exact-SHA evidence.

## Current operational verdict

**Architecture documented; multi-agent runtime not yet provisioned or accepted.** The current evidence supports one custom coding worker, not a working developer + independent QA + release-controller team. Do not enable a second copy of the existing worker as a substitute for role separation.
