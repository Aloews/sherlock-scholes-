# Project accounting

This ledger tracks the engineering cost of Sherlock Scholes and its Football Dynasty work. It is append-only by reporting period: do not silently rewrite historical measurements. Every entry must identify its source and confidence.

## Accounting rules

- Keep elapsed wall time, active execution time, queue/wait time and human time separate. Never label elapsed time as billable labour.
- Record every agent invocation, including failed generations, rejected patches, retries, reviews and CI failures. Failed work is part of delivery cost.
- Capture provider-reported usage per request: provider, model, task/issue/PR, request count, input tokens, output tokens, cached input, cache creation, total tokens, and provider request ID where available. Do not retain prompts, completions, API keys or other secrets in the ledger.
- Calculate money only from a verified provider rate card or invoice for the exact model, token class, plan and billing period. If rates or usage are unavailable, mark cost as unknown; do not infer it from a token balance.
- Record infrastructure separately by service and billing period: Railway compute/egress/volume, Supabase compute/storage/egress, Vercel plan/usage, domains, monitoring, and other paid APIs. Distinguish actual invoice, provider usage estimate, included quota and unknown.
- Track currency, tax inclusion, billing period, source URL/export and retrieval timestamp for every monetary figure.
- Report committed budget/credits separately from consumption. A top-up is not usage.
- Forecast using measured recent burn rate and the remaining backlog. State the confidence interval and assumptions; do not translate token count directly into a percentage of product completion.

## Baseline — 2026-11-19

### Budget and provider balance

| Item | Value | Status / source |
|---|---:|---|
| Starimg token top-up | 25,000,000 tokens | User-reported in this conversation; not independently checked against provider dashboard |
| Starimg consumed tokens at baseline | Unknown | No usage export or authoritative provider counter retrieved |
| Starimg monetary cost per token | Unknown | Exact active model/rate card and billing terms not verified |
| Remaining Starimg balance after the current task | Unknown | Must not assume the full top-up remains available |

### Agent execution record

| Task | Model | Observed activity | Time evidence | Token usage | Outcome |
|---|---|---|---|---|---|
| GitHub issue #441, comment 7006522916 | `claude-fable-5-2` | Architect handoff; 2 implementation attempts; independent review started; task then failed | Worker logs: start 10:36:36Z, architect handoff 10:37:03–10:37:38Z, first patch validation failure 10:39:32Z, review start 10:39:59Z; failure comment 10:41:07Z. Approx. 4m31s observed elapsed worker window; this is not active labour time. | Unknown; failure comment did not contain usage summary, and no provider usage export was retrieved | No PR/accepted change. Patch validation failed against the repository tree; reviewer identified stale/mismatched assumptions about existing UI paths. Count as failed effort, not delivered work. |
| GitHub issue #441, comment 7006068348 | Starimg request rejected | One failed agent launch | Failure comment created 10:16:19Z; exact active duration unavailable | No usage reported; HTTP 402 rejected request | No production changes. Do not assume billable tokens were consumed. |

### Infrastructure

| Provider / service | Billing period | Actual spend | Usage / evidence | Status |
|---|---|---:|---|---|
| Railway — autonomous worker and reviewer services | Current period | Unknown | Deployment/log activity observed; no invoice or metered usage export captured | Not priced |
| Supabase — project `konoavrduynecxblqfvq` | Current period | Unknown | Production project active; no billing export captured | Not priced |
| Vercel — Sherlock Scholes production | Current period | Unknown | Deployment status observed; no billing export captured | Not priced |
| Other APIs, domains and storage | Current period | Unknown | No complete billing inventory yet | Not priced |

### Time accounting limitations

The worker logs provide timestamps for some agent phases, but not a complete per-phase duration report. Queue wait, cold starts, provider latency, review time and execution time must be separately measured in future runs. Human engineering time and this assistant's orchestration time have not been independently timed and are not included in the observed 4m31s.

## Required record for every future task

For each task, append one task record containing:

- project, issue/task ID, branch and resulting PR/commit;
- start/end timestamps and phase durations (queue, architect, implementer, retries, reviewer, CI, deployment);
- each provider request's model and exact usage counters, plus aggregated input/output/cache/total tokens;
- price source, rate class, calculated cost and currency, or an explicit `unknown`;
- infrastructure usage and allocated cost where metering permits;
- failed/rejected calls and their resource consumption;
- accepted deliverables, test evidence and production status;
- forecast delta: actual versus estimated time, tokens and money.

Do not mark a task complete or accepted based solely on a generated patch. Use the exact branch/commit, review, checks and deployment evidence.

## Reporting

At each meaningful milestone report:

1. cumulative time by role/phase and accepted-deliverable count;
2. cumulative token usage by provider/model and known monetary cost;
3. infrastructure spend by provider and billing period;
4. failure/rework overhead;
5. current burn rate and forecast to the next milestone and remaining backlog;
6. confidence and missing metering data.

The current baseline is incomplete. Monetary totals, token consumption and project-completion percentage remain unmeasured until provider usage and billing records are available.







## Additional task records — 2026-11-19

- **Issue #441, comment 7006805718 — failed attempt:** model claude-fable-5-2 via Starimg; 7 calls; input 14,757; output 56,778; total 71,535; cache-creation input 282,176. Worker window 10:43:53–10:50:25Z (~6m32s elapsed, not active labour time). Three attempts to update docs/MAP.md failed, including a Starimg HTTP 503 and patch-context mismatch. No PR or production changes. Exact monetary cost unknown because the Starimg rate card was not verified.
- **Issue #441, comment 7006979375 — interrupted attempt:** Architect handoff completed 10:52:18–10:52:45Z; screen implementation unit began 10:52:45Z; last log 10:52:53Z. No usage summary, PR or production change observed. Token usage and cost unknown. The worker briefly selected obsolete issue #392 comment 7006040886 before service redeployment; usage for that interrupted request is also unknown.

### Provider request export — 2026-11-18 to 2026-11-19

Source: user-uploaded `request-logs(2).csv`, 30 rows. The export does not identify a timezone, task/PR per request, provider request IDs, a rate card, or the unit represented by `Списано`.

| Model | Requests | Input | Output | Cache | `Списано` |
|---|---:|---:|---:|---:|---:|
| `claude-fable-5-2` | 19 | 732,305 | 153,879 | 0 | 7,089,472 |
| `claude-opus-5` | 9 | 328,990 | 9,954 | 268,789 | 1,355,776 |
| `claude-fable-5-1` | 2 | 23,470 | 10,776 | 0 | 273,968 |
| **Total** | **30** | **1,084,765** | **174,609** | **268,789** | **8,719,216** |

- 29 requests succeeded; 1 ended with `provider_error`.
- `claude-fable-5-2` accounts for 81.3% of the export's `Списано` units. This is a share of the export's provider counter, not a verified share of money or tokens.
- Mean request latency: 29.8 seconds; median: 23.6 seconds.
- Cache values are reported only for `claude-opus-5` in this export. Do not infer cache creation, cache-read pricing, or caching configuration from this field alone.
- The 30-row export is a bounded sample, not a complete account-period usage statement. It does not establish the remaining balance of the user-reported 25,000,000-token top-up.
- Input plus output counters in this sample total **1,259,374 tokens**. Numerically this is about **5.0%** of the user-reported 25,000,000-token top-up *if* these 30 rows belong to that top-up period; it is not a verified balance or total-consumption percentage.
- Monetary cost and the conversion of `Списано` units to billable tokens remain **unknown** until the exact Starimg rate card/invoice and metric definition are verified.

### Cost-control actions derived from the export

1. Route repository discovery, task decomposition, routine implementation and test triage to the local Qwen workflow proposed in PR #442 once its security review and checks are complete. Do not describe it as active until merged and an actual run is evidenced.
2. Keep paid-model calls for bounded escalation/review only; require a task-specific reason before escalating from the local model.
3. Send only the target file, relevant symbols and the minimal dependency/test context. Exclude the large project map unless the task explicitly requires editing it.
4. Cap output by role and split large changes into independently testable file-level units. A truncated response must not trigger an unbounded retry loop.
5. Stop retries on deterministic infrastructure failures (missing compiler/toolchain, invalid credentials, permission denial, unavailable provider). Repair the environment or stop the task before requesting another generation.
6. Record usage per provider request and role, including failed calls, retry count, cache-read/cache-creation counters separately, and provider request ID when available.

These are controls to implement/verify, not a claim that the current agent runtime already enforces them.

## AI code attribution baseline — 2026-11-19

Attribution is tracked separately from Git commit authorship. GitHub commits made through an authenticated repository connection may all show the repository owner as author; this is not evidence that the owner, Starimg, a local model, or ChatGPT wrote every changed line.

| Source | Confirmed code volume | Evidence | Confidence |
|---|---:|---|---|
| Starimg | Unknown; no attributable merged LOC established | The 30-row provider export has no task/PR mapping. Issue #441 records seven failed/partial Fable calls and no PR or production change. | Insufficient to assign lines |
| Local Qwen | 0 LOC confirmed as generated by an actual agent run; historical total unknown | Qwen-only workflow PR #424 and bounded-write PR #438 establish workflow code, not proof of a model execution producing accepted application code. PR #442 remains draft/inactive in this snapshot. | No execution evidence |
| ChatGPT assistant | 181 additions/6 deletions in `simulation.rs`, plus 16 integration-test additions | Current-session patch on `feat/dynasty-rating-match-engine-20261119`; exact PR patch reports 181 added/6 removed lines in the Rust backend and 16 added lines in `campaign_lifecycle.rs`. | High for this task only |

These figures are not percentages of the repository and must not be extrapolated to historical code. Starting with this record, every agent task must capture provider/model, run ID, issue/PR, accepted patch SHA, exact diff additions/deletions, rejected/retried patches and provider usage. Do not attribute a line merely because a model was available or a workflow was merged.

