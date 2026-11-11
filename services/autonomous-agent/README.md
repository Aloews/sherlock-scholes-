# Sherlock Scholes autonomous engineering worker

The worker runs inside the existing Railway project and uses GitHub as its durable task/PR ledger and Starimg as its only model gateway.

## Trigger

On an ordinary GitHub issue (not a pull request), the repository owner can add a comment:

`/ai Implement the requested change and add regression tests.`

The worker polls GitHub every 90 seconds, accepts only comments authored by the repository owner, generates a bounded patch through Starimg, validates the changed paths, runs applicable local checks without provider credentials in the test process, pushes an isolated branch, and opens a pull request. It never merges or deploys.

## Railway service configuration

Create a separate service in the existing `distinguished-transformation` project:

- Source: `Aloews/sherlock-scholes-`, branch `main`
- Root directory: `services/autonomous-agent`
- Builder: Dockerfile
- Dockerfile: `Dockerfile`
- Health check: `/healthz`
- Start command: Dockerfile default

Required variables:

- `GITHUB_REPOSITORY=Aloews/sherlock-scholes-`
- `GITHUB_TOKEN=${{sherlock-ai-bot.GITHUB_TOKEN}}`
- `STARIMG_API_KEY=${{sherlock-ai-bot.STARIMG_API_KEY}}`
- `STARIMG_BASE_URL=https://ai.starimg.ru/v1`
- `POLL_INTERVAL_SECONDS=90`

Optional `STARIMG_MODEL` pins a model. If unset, the worker discovers the authenticated Starimg catalog and chooses a supported coding model; it refuses to guess if no coding model is listed.

The referenced credentials are injected by Railway and never printed. The GitHub token must have repository contents write and pull-request write permissions. No Supabase, Vercel, Telegram, or production database credentials are required.

## Safety boundaries

- Only owner-authored `/ai ` issue comments are tasks.
- Pull request comments are ignored.
- Only allowlisted source, test, documentation, scraper, migration, and Rust Football Dynasty paths can be changed.
- No workflow, package manifest, lockfile, deployment config, worker self-modification, file deletion, rename, or symlink changes.
- No arbitrary model-generated shell commands or model-generated test commands.
- Test subprocesses do not receive GitHub or Starimg credentials.
- The worker creates branches and PRs only. It cannot merge, deploy, apply migrations, or write production data.
- Each task uses a deterministic branch name, allowing recovery if a process restarts after pushing.

## Cost controls

The worker uses one Starimg completion per task, a 3,000-token output ceiling, at most eight changed files, and one task at a time. Railway compute runs continuously to poll GitHub; keep the service within the Free plan's included credits and sleep/disable it if the plan's remaining credits would be exceeded. Model usage is charged by Starimg separately.

## Verification

The service preflights GitHub repository write permissions and the authenticated Starimg model catalog before polling. A task is considered accepted only when a PR exists. Required CI checks remain the release gate; no PR is merged automatically.
