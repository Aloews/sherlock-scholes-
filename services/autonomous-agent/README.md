# Sherlock Scholes autonomous engineering worker

The worker is deployed in the existing Railway project using the user's explicitly released `stream-service` Railway service. GitHub is the durable task/PR ledger; Starimg is the only model gateway. One bounded run can scan an explicit allowlist of independent repositories and process at most one task total.

## Trigger

On an ordinary GitHub issue (not a pull request), the repository owner can add a comment:

`/ai Implement the requested change and add regression tests.`

After activation, Railway will run the worker every fifteen minutes. Each run accepts at most one pending owner-authored task, combines the command with the issue title and description (treated as untrusted input), generates a bounded patch through Starimg, validates changed paths against that repository's own allowlist at every validation stage, runs lightweight Python syntax checks without provider credentials, pushes an isolated branch based on that repository's actual default branch, and opens a pull request against the same default branch. Full frontend, Rust, SQL, and integration suites remain GitHub Actions release gates on the exact PR head. It never merges or deploys.

## Railway service configuration

Reuse the existing `stream-service` Railway service in project `distinguished-transformation`; the user explicitly confirmed that the streaming service is no longer used and authorized repurposing it as the coding agent. The old streaming deployment has been replaced; its public domain was removed. Existing `LIVEKIT_URL` and `M3U_SOURCE_URL` variables are preserved but unused by the worker. Do not create another Railway service on the Free plan.

- Source: `Aloews/sherlock-scholes-`, branch `feat/starimg-autonomous-engineering-worker-20261111` (temporary until PR review/merge)
- Root directory: `/services/autonomous-agent`
- No volume is attached; the worker image runs from `/opt/worker`.
- Builder: Dockerfile
- Dockerfile: `Dockerfile`
- Cron schedule: temporarily `0 0 1 1 *`; change to `*/15 * * * *` only after required CI and safe runtime preflight pass.
- Start command: Dockerfile default; the process exits after checking one task
- Sleep mode: disabled; no public domain is required
- Restart policy: `NEVER`

Required variables:

- `GITHUB_REPOSITORIES=Aloews/sherlock-scholes-,Aloews/first-traffic-platform,Aloews/russian-dev-projects,Aloews/sherlock-tv,Aloews/sherlock-ai-bot,Aloews/Novel-forge` (explicit allowlist; each repository is preflighted before tasks are accepted)
- `GITHUB_REPOSITORY=Aloews/sherlock-scholes-` (legacy single-repository fallback only when `GITHUB_REPOSITORIES` is unset)
- `GITHUB_TOKEN=${{sherlock-ai-bot.GITHUB_TOKEN}}` (Railway service reference; the secret value is not copied)
- Preserve the existing `STARIMG_API_KEY` already present on `stream-service`; do not reveal or copy its value.
- `STARIMG_BASE_URL=https://ai.starimg.ru/v1`
- `AGENT_ENABLED=false` until CI and live preflight pass; switch to `true` only after both are verified.
- `STARIMG_PREFLIGHT=false` normally; set to `true` for exactly one scheduled invocation to authenticate GET `/models` and validate model selection without sending a completion, then immediately reset to `false`.
- `TASKS_SINCE=2999-01-01T00:00:00Z` during the disabled verification period; replace with the activation UTC timestamp when enabling tasks.

Optional `STARIMG_MODEL` pins a model. If unset, the worker discovers the authenticated Starimg catalog, prefers an available coding model, and refuses to guess if no supported model is listed.

The referenced credentials are injected by Railway and never printed. The GitHub token must have repository contents write and pull-request write permissions. No Supabase, Vercel, Telegram, or production database credentials are required.

## Safety boundaries

- Only owner-authored `/ai ` issue comments are tasks.
- Pull request comments are ignored.
- Each repository has a separate source-path allowlist; unknown repositories are rejected. Only allowlisted source, test, and documentation paths can be changed. The Russian developer-project directory is restricted to `pages/`, `docs/`, and `scripts/`.
- No workflow, package manifest, lockfile, deployment config, worker self-modification, file deletion, rename, or symlink changes.
- No arbitrary model-generated shell commands or model-generated test commands.
- Every child process receives a strict environment allowlist; GitHub, Starimg, Supabase, Vercel, Telegram, and other Railway secrets are excluded.
- Full product test suites run on GitHub-hosted runners; the Railway worker does not install the application's large dependency trees.
- The worker creates branches and PRs only. It cannot merge, deploy, apply migrations, or write production data.
- A deterministic branch and GitHub issue marker prevent duplicate work after restarts; failed tasks are recorded on the source issue.

## Cost controls

- Once activated, Railway runs a short job every fifteen minutes rather than keeping a VM awake continuously. During verification the schedule is parked and task execution is disabled.
- At most one task across all configured repositories is processed per invocation, with up to two Starimg completions if a patch or its lightweight local checks fail.
- Completion output is capped at 6,000 tokens per attempt; patches are limited to eight files and 60,000 characters.
- Model usage is charged by Starimg; Railway usage is limited to the scheduled job runtime.
- Starimg model discovery is deferred until an eligible task exists; idle runs do not call the model API.

## Verification

The worker preflights GitHub repository write permissions for every configured repository before processing. A one-shot `STARIMG_PREFLIGHT=true` mode validates the authenticated Starimg `/models` catalog without sending a completion or consuming generation tokens; reset it immediately after the one verification run. Normal idle runs do not call Starimg. A task is accepted only when a PR exists. Required CI checks remain the release gate; no PR is merged automatically.
