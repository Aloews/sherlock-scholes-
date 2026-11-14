# Autonomous coding-agent network

## Runtime

The GitHub Actions workflow runs on an ephemeral GitHub-hosted runner. It does not depend on the Railway worker. Qwen 2.5 Coder 3B is downloaded through Ollama and performs sequential specialist passes; the passes are isolated by role and share one bounded task context. They do not run concurrently against the same working tree.

## Role sequence

1. **Triage / product analyst — Qwen 2.5 Coder 3B.** Converts the issue into acceptance criteria, identifies risk flags, and decides whether senior escalation is needed.
2. **Solution architect — Qwen 2.5 Coder 3B.** Produces a minimal implementation plan, target files, risks, and a test plan.
3. **Implementer — Qwen 2.5 Coder 3B.** Returns bounded JSON file edits, never a unified diff. Exact source snippets must match once before any write.
4. **Independent reviewer — Qwen 2.5 Coder 3B.** Reviews the actual Git diff against acceptance criteria and can block the PR.
5. **QA — deterministic GitHub Actions commands.** Runs dependency installation, typecheck, production build, unit tests, and translation validation.
6. **Senior escalation — Fable 5.2 through Starimg.** Invoked only for high-risk architecture, two failed Qwen edit attempts, a reviewer rejection, or failed deterministic quality gates. Fable receives the actual failure evidence and bounded source context, returns structured edits, and must pass the same checks. A post-Fable Qwen review is required for reviewer-triggered escalation.

Qwen role passes are sequential to avoid conflicting edits. Their token limits are bounded. The workflow does not retry the same failed provider request indefinitely.

## Model and provider routing

- Primary worker model: `qwen2.5-coder:3b` via local Ollama on the runner.
- Senior escalation model: `claude-fable-5-2` via the Anthropic-compatible Starimg endpoint `https://ai.starimg.ru/v1/messages`.
- The Fable key is read only from the GitHub Actions secret `STARIMG_API_KEY`; it is never printed or written to a file.
- HTTP 402 is treated as a billing/quota failure. It is not retried automatically; the task stops without opening a PR.
- If the GitHub secret is absent, escalation stops with an explicit missing-secret error. A key stored only in Railway is not automatically available to GitHub Actions.

## Context and token controls

- Caveman 4.1.0 is pinned by commit in the workflow and its skill is supplied to Qwen role prompts.
- Codebase Memory MCP 0.12.1 indexes the checkout per run. Graph context is optional; when indexing or lookup fails, the workflow falls back to a bounded source-file selection.
- Spotify Portal is registered in `.claude/settings.json` for Claude Code hosts. The GitHub Actions runner is a plain Python/Ollama runtime and does not load Claude Code plugins.
- Spotify Shunt remains disabled. Its current upstream hook response contract is not compatible with the registered PreToolUse hook contract; enabling it would be unsafe until corrected and tested.

## Patch and release safety

- The model can modify only the existing source/test/docs/script/Supabase-function/migration/scraper/ML allowlist. It cannot edit workflows, package manifests, lockfiles, secrets, deployment configuration, or production data.
- JSON edits are validated before writes: path traversal and symlinks are rejected, file count and size are bounded, and replacement snippets must match exactly once.
- A PR is opened only after Qwen review and all quality gates pass. If a quality gate fails, Fable may attempt one evidence-based repair and the complete gate set is rerun.
- No automatic merge, production migration, or deployment is performed. Human review and explicit release authorization remain required.
- An agent report is not proof of completion; the exact commit's CI and product-level verification remain authoritative.

## How to dispatch

Post an issue comment as the repository owner beginning with `/ai `. Example:

```text
/ai Fix the team-selection filtering bug and add a regression test.
```

The workflow accepts owner-authored issue comments only. Do not put secrets in issue text.
