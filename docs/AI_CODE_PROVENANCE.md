# AI code provenance — Sherlock Scholes

**Last checked:** 2026-11-19  
**Purpose:** distinguish generated application code from agent infrastructure and from code whose author cannot be proven.

## Rules

- Count source-code additions and deletions from exact Git diffs, not token usage.
- Attribute a change to Starimg, local Qwen/Ollama, or ChatGPT only when a task record, model execution log, and exact patch/commit can be connected.
- Keep application code, tests, documentation, and agent infrastructure as separate totals.
- A delegated task, successful policy test, green generic CI, or model token charge is not evidence that a model wrote accepted application code.
- Every future model-generated patch must record: task/issue ID, provider, exact model, role, workflow run ID, base SHA, resulting commit SHA, changed paths, additions/deletions by file, and test results. Store no prompt/completion text in the usage ledger.

## Verified historical evidence

### Starimg

- The 2026-11-18/19 provider export contains 30 requests: 19 Fable 5.2, 9 Opus 5, and 2 Fable 5.1. These are provider request counts and token counters, not a code-generation ledger.
- Football Dynasty issue #394 was delegated to Fable 5.2. Six files were handled as separate requests, but the implementation remained unfinished; Fable failed to apply the `roster.rs` patch and PostgreSQL integration tests had three race failures. No accepted commit, exact diff, or line count was verified for that task.
- A separate Fable task #6853413961 was assigned on 2026-11-13, but no verified diff or CI result was recorded.
- **Verified accepted Football Dynasty application-code lines attributable to Starimg: unknown.** Do not infer this from request volume or intermediate generated files.

### Local Qwen / Ollama

- PR #438 added 302 lines and removed 38 lines while expanding the local Qwen agent's allowed source scope and adding patch-policy tests. The PR body explicitly required a separate bounded issue task to prove the frontend path was usable; this PR is agent infrastructure, not proof of 302 generated application lines.
- PR #440 added 211 lines and removed 10 lines for worker repository isolation. Its runtime evidence stated that both scheduled workers were disabled and no live worker execution or Starimg completion was claimed.
- PR #442 currently contains 974 additions and 22 deletions for the local Qwen multi-agent workflow, but remains a draft and inactive. It is infrastructure, not generated game code.
- **Verified accepted Football Dynasty application-code lines attributable to local Qwen/Ollama: 0 confirmed.** This means no attributable accepted output was found in the inspected evidence, not that no unrecorded local experiments ever occurred.

### ChatGPT assistant

- ChatGPT directly authored the initial backend patch in this session: 103 Rust source additions and 27 test additions, with 4 test-line deletions.
- Subsequent branch commits with no model/run provenance refactored and formatted the match outcome logic (39 additions / 44 deletions in Rust), strengthened the integration test (13 additions / 1 deletion), and added backend CI wiring (34 additions in `.github/workflows/ci.yml`, plus 4 additions / 1 deletion in the Rust workflow). These commits are not attributable to Starimg or local Qwen from the available evidence.
- The current exact PR diff is 98 added Rust source lines, 39 added test lines / 4 deleted test lines, 38 workflow additions / 1 deletion, and 50 documentation additions: **225 additions and 5 deletions** total. The assistant's original code contribution is recorded separately from these unclassified follow-on edits.
- PR #444 contains 252 additions and 118 deletions across 10 files, but the historical patch does not contain reliable per-model provenance. Do not assign those lines to ChatGPT or Starimg without evidence.

## Current measurement gap

There is no complete mapping from provider request IDs to generated patch files and merged commits. Therefore a trustworthy lifetime percentage split among Starimg, local models, and ChatGPT cannot yet be calculated. Future agent workflows must emit per-task diff statistics and link them to the provider usage record.
