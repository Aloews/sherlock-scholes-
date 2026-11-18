# Sherlock Scholes — Production Audit Snapshot

**Observed:** 2026-11-18  
**Repository main at audit start:** `0d9e0d2643ec964bb2348e75f535cea25bc2a284`  
**Production Supabase:** `konoavrduynecxblqfvq` — `ACTIVE_HEALTHY`, PostgreSQL 17.6.1  
**Purpose:** evidence snapshot for the execution backlog in `docs/MAP.md`. Counts are point-in-time observations, not guarantees of current freshness.

## 1. Agent runtime

Existing Railway project: `distinguished-transformation`.

| Service | Latest deployment | Source branch | Schedule | Observed runtime state |
|---|---|---|---|---|
| `stream-service` | SUCCESS, 2026-11-16 15:19 UTC | `feat/sherlock-multi-agent-runtime-20261113` | `*/5 * * * *` | Logs on 2026-11-18 explicitly report `Worker disabled`; GitHub preflight succeeds for seven repositories |
| `sherlock-ai-bot` | SUCCESS, 2026-11-17 00:50 UTC | `feat/sherlock-multi-agent-runtime-20261113` | `*/5 * * * *` | Logs on 2026-11-18 explicitly report `Worker disabled`; GitHub preflight succeeds for seven repositories |

The services and source are deployed, but agent task execution is **not active**. An authenticated Starimg model-catalog preflight was attempted on the reviewer service on 2026-11-18 and returned **HTTP 402**. This endpoint does not request a completion; no model generation/task was run. The temporary `STARIMG_PREFLIGHT=true` setting was reverted to `false` on both services. `AGENT_ENABLED` remains disabled. Variable names for GitHub and Starimg credentials exist in Railway; values are redacted and were not inspected. The reviewer branch documents a Supabase Management API token failure (HTTP 401); Vercel read-only preflight had previously succeeded. Treat Starimg inference and Supabase reviewer integration as blocked until revalidated.

Relevant PRs:
- [#406 — Railway Starimg multi-agent runtime](https://github.com/Aloews/sherlock-scholes-/pull/406), Draft, head `c5e6a45080e897ae3bccbb424963bcc9247d096c`. It is deployed to the two existing services but the worker is disabled. No PR-triggered workflow run was returned for this exact head in this audit.
- [#422 — Qwen + Fable GitHub Actions network](https://github.com/Aloews/sherlock-scholes-/pull/422), Draft, head `12424ab5aadd089c72e1ed547dde3cc7e770ab35`; its 11 listed checks passed. It is not active until merged and uses local Qwen plus Starimg escalation.
- [#424 — Qwen-only multi-role network](https://github.com/Aloews/sherlock-scholes-/pull/424) is already merged into main at `0d9e0d2643ec964bb2348e75f535cea25bc2a284`, and that exact main commit is the latest READY Vercel production deployment. The workflow is owner-invoked and uses local Qwen on ephemeral GitHub runners. However, its current write allowlist excludes the repository's `src/` tree, so it cannot implement the open Home / Football Elias UI tasks (#419 and #420) as written. No successful real task run was verified in this audit.
- [#389 — Starimg autonomous worker base](https://github.com/Aloews/sherlock-scholes-/pull/389), open, exact head `afb17ef7738e78ae033c186929987a9aefcbbebe`; 11 listed checks passed.
- The two runtime services share a seven-repository allowlist. Do not enable them blindly: the worker processes one owner-authenticated `/ai ` task per invocation across the entire allowlist. Scope and task watermark must be checked before activation to prevent an unrelated repository task being picked up.

## 2. Product and data snapshot

Read-only production queries returned:

| Area | Observed state | Implication |
|---|---|---|
| Player cards | 28,350 total; 27,370 active | Active-card denominator for coverage |
| Portrait coverage | 20,549 active cards with a photo; 6,821 active cards without one | Significant enrichment backlog remains |
| `photo_tm` queue | 8,646 pending; 500 failed; 1,697 succeeded; 8 no-data | Investigate source-specific failures and retry semantics; do not blindly increase request volume |
| `photo_qid` queue | 1,042 pending; 1,988 no-data; 2,655 succeeded | Resolve candidates only where source evidence exists |
| `photo_sw` queue | 61 pending; 453 no-data; 3,283 succeeded | Small pending tail; no-data must not be retried without new evidence |
| Player season stats | 880,959 rows; newest `fetched_at` 2026-11-17 20:05 UTC | Collection is active, but freshness and competition coverage still need breakdown |
| Season-stat queue | 389 pending; latest pending update 2026-10-21 | Old pending jobs need diagnosis, not just another enqueue |
| Match forecasts | 4,144 picks; 3,684 graded; 460 ungraded; latest creation 2026-11-17 14:50 UTC | Reconcile ungraded rows and settlement freshness |
| Accumulators | 251 tickets; 214 settled; 37 unsettled; latest ticket 2026-11-15 13:56 UTC | Settlement and visible-history verification remain |
| Accumulator generation | Latest run #49, 2026-11-18 07:10 UTC, `no_new_tickets`; 212 future fixtures and 424 future forecast rows, but zero eligible 3-/4-leg model days | This is an eligibility result, not a runtime failure. Diagnose why candidates fail the generation rules before changing thresholds |
| Individual award snapshots | 72,006 rows; latest snapshot 2026-11-16; six award keys; one season; 27 verified outcomes | Snapshot scores are relative indices, not calibrated probabilities; evaluation breadth is insufficient |
| Team tournament snapshots | 57,564 rows; latest snapshot 2026-11-16; 221 tournaments; zero verified outcomes | No outcome-based tournament evaluation exists yet |
| Football Dynasty | 12 tables in `fd`, all RLS-enabled; 0 campaigns and 0 rows in the domain tables | Schema is present, but no production campaign usage is evidenced by current rows |

Vercel production is READY on main commit `0d9e0d2643ec964bb2348e75f535cea25bc2a284` (PR #424). The earlier production deployment for merged PR #423 is also READY on merge commit `11b868fc38e9d13c8600cbf6595afa330f3fc0a6`. This verifies deployment state, not a real-device Telegram smoke test.

The project has 475 recorded Supabase migrations. The latest applied Football Dynasty migrations are `20261110190452` and `20261110191118`; the new Machiavelli doctrine migration in PR #436 is not applied to production.

## 3. Open pull requests and integration risks

There are 30 open PRs in the repository at audit time. This is too many to treat as one ready-to-merge queue. The following are the most relevant active workstreams:

| PR | Scope | Audit disposition |
|---|---|---|
| #406 | Railway Starimg agent runtime | Keep as canonical runtime candidate; disabled; validate exact head and safe activation before enabling |
| #422 | Qwen/Fable GitHub Actions agent network | Draft alternative; do not activate alongside another poller |
| #424 | Qwen-only GitHub Actions network | Merged and present on main; local model, but `src/` is outside its current write allowlist; no real task execution verified |
| #389 | Starimg worker base | Green checks; reconcile its base/commits with #406 before merge |
| #391 | Alias Rust domain core | Green checks; still requires a parity/integration plan before replacing frontend domain logic |
| #390 | Full Rust migration inventory | Review against current main and use as migration ledger |
| #402 | Football Dynasty squad/contracts | Open implementation PR; inspect exact-head checks and reconcile with later doctrine changes |
| #436 | 18 Machiavellian principles in Football Dynasty | Exact-head listed checks passed; no production migration or deployment; requires integration/release gate |
| #423 | League/team filter fix | Merged 2026-11-14; production verification remains open |
| #367 | Market-value reconciliation and award calibration | Open; must be checked against current production data and newer forecast pipeline before reuse |
| #366 | Team-tournament refresh timeout | Open; verify current main and production cron before treating as unresolved |
| #260 / #291 | Accumulator history and generation diagnostics | Older open PRs; reconcile against newer generation run #49 and current main before continuing |

The open PR inventory includes older changes and competing agent protocols. Do not merge PRs in bulk. Every candidate must be compared with current main, its exact-head checks, production impact, and any later replacement.

## 4. Small-task execution backlog

### A. Agent execution — P0

1. **AGT-01 — Choose one canonical execution path.** Compare #406, #389 and #422; record the selected worker, role split, allowed repositories, and non-overlapping ownership. Acceptance: one documented active path, no duplicate pollers.
2. **AGT-02 — Verify Starimg without consuming generation credits.** Run authenticated model-catalog preflight on the existing service; confirm the pinned Fable model exists. Acceptance: exact model ID and HTTP result in logs; no completion call.
3. **AGT-03 — Verify task isolation.** Confirm repository allowlist, owner-only `/ai ` authentication, `TASKS_SINCE` watermark, one-task-per-invocation behavior, path allowlists, and duplicate suppression. Acceptance: one disposable task in Sherlock only cannot cause another repository's task to be selected.
4. **AGT-04 — Verify external reviewer.** Check exact-SHA review, idempotency, read-only provider permissions and failure handling. Acceptance: one test PR receives one SHA-scoped review; invalid Supabase token is reported as disconnected, not as success.
5. **AGT-05 — Enable bounded Sherlock execution.** Only after AGT-01–04 pass, enable the existing worker for the Sherlock task scope and start one low-risk task. Acceptance: a real Starimg task creates a draft PR, exact-head CI passes, independent review is attached, and no merge/deploy/migration occurs.

### B. Core product UX — P1

1. **UX-01 — Verify merged league/team filter fix (#423).** Check production behavior and exact current-main regression tests; close issue #418 only after evidence.
2. **UX-02 — Canonical football icon mapping (#419).** Inventory Home and Football Elias icons, define/reuse one mapping, update both surfaces, test accessibility and responsive states.
3. **UX-03 — Release-quality UX pass (#420).** Audit Home → lobby → game → result → replay; fix only the highest-impact layout/state defects; add mobile overflow and interaction-state tests.
4. **GAME-01 — Room lifecycle regression.** Verify create/join, code parsing, reconnect, replay, team/competitive settings and 3-minute expiry with integration tests.
5. **GAME-02 — Category and deck consistency.** Verify dynamic categories, selected categories, count/deal parity and card provenance across quick, online and competitive modes.
6. **GAME-03 — Online presence and voice.** Verify server-authoritative presence and provider fallback on real supported clients; no synthetic online state or unverified live voice claims.

### C. Football data and canonical statistics — P1/P2

1. **DATA-01 — Photo backlog diagnosis.** Split missing active portraits by source eligibility and failure reason; prioritize Wikidata where available, then Transfermarkt; preserve every verified existing photo.
2. **DATA-02 — Transfermarkt zero-yield failures.** Diagnose the 500 failed and 8,646 pending `photo_tm` jobs by HTTP status/body size/lease age; define bounded retry/backoff and permanent no-data states.
3. **DATA-03 — Stale season-stat jobs.** Inspect the 389 pending jobs and their last errors; recover only valid jobs with bounded leases and read-after-write verification.
4. **DATA-04 — Canonical career/season/match metrics.** Reconcile known player discrepancies; prevent season totals from being displayed as career totals; add regression fixtures.
5. **DATA-05 — Squad and market-value provenance.** Verify SoccerWiki squad truth, Transfermarkt value observations, effective dates, club identity aliases and conflict quarantine; publish coverage by club/competition.

### D. Forecasts and virtual accumulators — P1/P2

1. **FORECAST-01 — Reconcile 460 ungraded forecast picks.** Classify not-yet-finished fixtures, missing results, and grading failures; settle idempotently only when result evidence exists.
2. **FORECAST-02 — Diagnose zero eligible accumulator days.** Trace all generation predicates using the 2026-11-18 run #49 inputs; explain why 424 future forecast rows yield zero eligible 3-/4-leg model days. Do not lower thresholds without backtest evidence.
3. **FORECAST-03 — Reconcile 37 unsettled tickets.** Distinguish future fixtures from overdue unresolved results; verify ledger/balance invariants and history visibility.
4. **FORECAST-04 — Calibrate individual awards.** Build time-correct train/test windows, outcome coverage, baseline comparison, Brier/log loss and calibration; do not call candidate_score a probability.
5. **FORECAST-05 — Evaluate team tournaments.** Add verified outcomes with source URLs and timestamps, then produce leakage-safe historical evaluation; until then label snapshots as rankings, not calibrated probabilities.
6. **FORECAST-06 — Add independent model agents only after baseline readiness.** Grok/Kimi or other model identities must use identical immutable pre-kickoff snapshots and isolated virtual ledgers; do not fake provider connectivity or use real money.

### E. Football Dynasty and Rust migration — P2

1. **FD-01 — Reconcile current Rust foundation and contract PRs.** Compare #390, #402 and #436 to current main; identify migrations, routes and schema dependencies.
2. **FD-02 — Validate 18 Machiavellian principles (#436).** Review lesson content, sequential unlocks, idempotency, owner isolation and all 13-table RLS tests; no production migration before explicit release gate.
3. **FD-03 — Complete one playable Dynasty vertical slice.** Verify campaign creation, club/family progression, squad/contracts, time advance, succession and chronicle through Telegram; production currently has zero campaign rows.
4. **RUST-01 — Alias domain parity.** Integrate #391 only after a route-by-route parity matrix and end-to-end state-machine tests exist.
5. **RUST-02 — Full Rust migration inventory.** Use #390 as the ledger; migrate bounded domain slices one at a time, preserve React/TypeScript behavior until equivalent Rust-backed flows pass.

### F. Release operations — P0

1. **OPS-01 — Triage the 30 open PRs.** Mark each as current, superseded, duplicate, blocked or obsolete; keep only one canonical implementation per feature.
2. **OPS-02 — Exact-head CI and deployment matrix.** For each retained PR record head SHA, CI result, deployment commit, smoke test and rollback path.
3. **OPS-03 — Production acceptance.** Run read-only checks first; production migrations, merges and deployments remain separate release actions and are not implied by agent PASS.

## 5. Execution order and concurrency

- First: AGT-01 → AGT-04. Do not turn on a worker before these checks pass. Reconcile the already-merged #424 workflow as well as the unmerged Starimg runtime branches.
- Then: AGT-05 starts one low-risk Sherlock task.
- Parallel work is allowed only when file write sets do not overlap: UX-02 may run beside DATA-01; FORECAST-04 may run beside FD-02; shared `docs/MAP.md` updates must be serialized by the integration owner.
- UX-03 depends on UX-01 and UX-02.
- Forecast UI changes depend on FORECAST-01–05 evidence.
- Rust replacement depends on domain parity and production smoke tests.
- Agents may create branches, commits and draft PRs, run checks, and fix failures. They may not merge, deploy, apply production migrations, write production data, change secrets/permissions, create paid resources, or delete data.
