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
