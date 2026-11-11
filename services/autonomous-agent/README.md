# Sherlock Scholes autonomous engineering worker

The worker runs as a scheduled job in the existing Railway project. GitHub is the durable task/PR ledger; Starimg is the only model gateway.

## Trigger

On an ordinary GitHub issue (not a pull request), the repository owner can add a comment:

`/ai Implement the requested change and add regression tests.`

Railway runs the worker every fifteen minutes. Each run accepts at most one pending owner-authored task, generates a bounded patch through Starimg, validates changed paths, runs applicable local checks without provider credentials in the test process, pushes an isolated branch, and opens a pull request. It never merges or deploys.

## Railway service configuration

Create a separate service in the existing `distinguished-transformation` project:

- Source: `Aloews/sherlock-scholes-`, branch `main`
- Root directory: `services/autonomous-agent`
- Builder: Dockerfile
- Dockerfile: `Dockerfile`
- Cron schedule: `*/15 * * * *`
- Start command: Dockerfile default; the process exits after checking one task

Required variables:

- `GITHUB_REPOSITORY=Aloews/sherlock-scholes-`
- `GITHUB_TOKEN=${{sherlock-ai-bot.GITHUB_TOKEN}}`
- `STARIMG_API_KEY=${{sherlock-ai-bot.STARIMG_API_KEY}}`
- `STARIMG_BASE_URL=https://ai.starimg.ru/v1`
- `TASKS_SINCE=<UTC timestamp recorded at activation>` (fixed UTC start boundary; ignore older comments)

Optional `STARIMG_MODEL` pins a model. If unset, the worker discovers the authenticated Starimg catalog, prefers an available coding model, and refuses to guess if no supported model is listed.

The referenced credentials are injected by Railway and never printed. The GitHub token must have repository contents write and pull-request write permissions. No Supabase, Vercel, Telegram, or production database credentials are required.

## Safety boundaries

- Only owner-authored `/ai ` issue comments are tasks.
- Pull request comments are ignored.
- Only allowlisted source, test, documentation, scraper, migration, and Rust Football Dynasty paths can be changed.
- No workflow, package manifest, lockfile, deployment config, worker self-modification, file deletion, rename, or symlink changes.
- No arbitrary model-generated shell commands or model-generated test commands.
- Test subprocesses do not receive GitHub or Starimg credentials.
- The worker creates branches and PRs only. It cannot merge, deploy, apply migrations, or write production data.
- A deterministic branch and GitHub issue marker prevent duplicate work after restarts; failed tasks are recorded on the source issue.

## Cost controls

- Railway runs a short job every fifteen minutes rather than keeping a VM awake continuously.
- At most one task is processed per invocation, with up to two Starimg completions if a patch or its local checks fail.
- Completion output is capped at 6,000 tokens per attempt; patches are limited to eight files and 60,000 characters.
- Model usage is charged by Starimg; Railway usage is limited to the scheduled job runtime.
- Starimg model discovery is deferred until an eligible task exists; idle runs do not call the model API.

## Verification

The worker preflights GitHub repository write permissions and the authenticated Starimg model catalog before processing. A task is accepted only when a PR exists. Required CI checks remain the release gate; no PR is merged automatically.
