# Autonomous local-model coding agent

## Usage

The `Local autonomous coding agent` workflow runs Qwen2.5-Coder locally on an ephemeral GitHub-hosted runner. Normal Qwen roles require no model API key. High-risk tasks or failed Qwen stages may require Fable 5.2 through Starimg; if Starimg returns HTTP 402, escalation stops without retry.

Open a GitHub issue, then post a comment as the repository owner beginning with `/ai `, for example:

```text
/ai Fix the team-selection filtering bug and add a regression test.
```

The workflow downloads Ollama and `qwen2.5-coder:3b`, passes both the issue body and owner comment to five sequential roles (triage, architect, QA planner, implementer, independent reviewer), validates structured edits against a path allowlist, and runs frontend typecheck/build/tests/i18n checks. Backend changes also trigger the repository's Rust CI. Successful work opens a draft pull request. It never merges or deploys automatically.

## Limits and safety

- The model runs only during a workflow run; it is not a continuously running server.
- The model is smaller than hosted frontier models and may fail on complex tasks. Failures must remain visible.
- No Railway service, paid inference API, model key, or Vercel deployment is required.
- The model cannot call shell tools. It proposes a patch; the workflow runs only predefined validation commands.
- Patches are restricted to source, tests, scripts, docs, scraper, ML, and Supabase function/migration directories. Workflow files, deployment settings, package manifests, lockfiles, and secrets are outside the allowed paths.
- The workflow only accepts `/ai ` comments posted by the repository owner. Never put secrets in issue text.
- GitHub-hosted runners and Actions usage are subject to GitHub's applicable usage limits.
- The resulting pull request requires human review; the agent does not merge its own changes.


## Source scope and escalation

- Only a repository-owner issue comment beginning with `/ai ` starts the workflow.
- The issue body is included as requirements context; the comment supplies the immediate task.
- Editable source includes `src/`, `docs/`, tests/scripts and `services/football-dynasty/`.
- Existing service/Supabase migrations, manifests, lockfiles, workflow files, secrets, deployment settings and production data are protected. A new service migration may be created; existing migrations may not be rewritten.
- Qwen edits are limited to eight files, must use exact unique source snippets, and pass `git diff --check`.
- Fable 5.2 is a bounded escalation path, not a silent fallback. HTTP 402 is surfaced as a blocker and is never retried automatically.
- Every result is a draft PR. Exact-head GitHub Actions checks and human review remain required before merge.
