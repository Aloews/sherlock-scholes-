# Sherlock Scholes autonomous engineering worker

The worker runs as a scheduled job in the existing Railway project. GitHub is the durable task/PR ledger; Starimg is the only model gateway.

## Trigger

On an ordinary GitHub issue (not a pull request), the repository owner can add a comment:

`/ai Implement the requested change and add regression tests.`

Railway runs the worker every fifteen minutes. Each run accepts at most one pending owner-authored task, generates a bounded patch through Starimg, validates changed paths, runs lightweight Python syntax checks without provider credentials, pushes an isolated branch, and opens a pull request. Full frontend, Rust, SQL, and integration suites remain GitHub Actions release gates on the exact PR head. It never merges or deploys.

## Railway service configuration

Reuse the existing `sherlock-ai-bot` Railway service in project `distinguished-transformation`; do not create a third service on the Free plan. Its Railway-only long-polling bot is currently crashed and documented as nonworking. The Vercel webhook bot remains separate and is not changed. Do not modify `stream-service`, which serves the M3U playlist.

- Source: `Aloews/sherlock-scholes-`, branch `main`
- Root directory: `/services/autonomous-agent`
- Keep the existing `/app` volume attached but unused; the worker image runs from `/opt/worker` to avoid masking its files.
- Builder: Dockerfile
- Dockerfile: `Dockerfile`
- Cron schedule: `*/15 * * * *`
- Start command: Dockerfile default; the process exits after checking one task
- Sleep mode: disabled; no public domain is required
- Restart policy: `NEVER`

Required variables:

- `GITHUB_REPOSITORY=Aloews/sherlock-scholes-`
- Preserve the existing secret variables `GITHUB_TOKEN` and `STARIMG_API_KEY`; do not reveal or copy their values.
- `STARIMG_BASE_URL=https://ai.starimg.ru/v1`
- `AGENT_ENABLED=false` during deployment verification; switch to `true` only after CI and live preflight pass.
- `TASKS_SINCE=<UTC timestamp recorded at activation>` (fixed UTC start boundary; ignore older comments; required only when enabled)

Optional `STARIMG_MODEL` pins a model. If unset, the worker discovers the authenticated Starimg catalog, prefers an available coding model, and refuses to guess if no supported model is listed.

The referenced credentials are injected by Railway and never printed. The GitHub token must have repository contents write and pull-request write permissions. No Supabase, Vercel, Telegram, or production database credentials are required.

## Safety boundaries

- Only owner-authored `/ai ` issue comments are tasks.
- Pull request comments are ignored.
- Only allowlisted source, test, documentation, scraper, migration, and Rust Football Dynasty paths can be changed.
- No workflow, package manifest, lockfile, deployment config, worker self-modification, file deletion, rename, or symlink changes.
- No arbitrary model-generated shell commands or model-generated test commands.
- Every child process receives a strict environment allowlist; GitHub, Starimg, Supabase, Vercel, Telegram, and other Railway secrets are excluded.
- Full product test suites run on GitHub-hosted runners; the Railway worker does not install the application's large dependency trees.
- The worker creates branches and PRs only. It cannot merge, deploy, apply migrations, or write production data.
- A deterministic branch and GitHub issue marker prevent duplicate work after restarts; failed tasks are recorded on the source issue.

## Cost controls

- Railway runs a short job every fifteen minutes rather than keeping a VM awake continuously.
- At most one task is processed per invocation, with up to two Starimg completions if a patch or its lightweight local checks fail.
- Completion output is capped at 6,000 tokens per attempt; patches are limited to eight files and 60,000 characters.
- Model usage is charged by Starimg; Railway usage is limited to the scheduled job runtime.
- Starimg model discovery is deferred until an eligible task exists; idle runs do not call the model API.

## Verification

The worker preflights GitHub repository write permissions and the authenticated Starimg model catalog before processing. A task is accepted only when a PR exists. Required CI checks remain the release gate; no PR is merged automatically.
