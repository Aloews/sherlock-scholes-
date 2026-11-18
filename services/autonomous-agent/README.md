# Sherlock Scholes multi-agent engineering runtime

The existing Railway services in project distinguished-transformation are used; no new Railway project or paid service is created.

## Agent roles and handoff

- **Architect** turns the owner-authenticated issue into a bounded implementation plan.
- **Implementer** generates the patch through Starimg, validates allowed paths, runs local syntax/format checks, and applies bounded corrections.
- **Independent reviewer** receives the exact diff and architect handoff, checks correctness/security/tests, and can return findings to the implementer for one correction cycle.
- **External reviewer service** independently reviews the opened PR on the exact head SHA and persists its verdict as a GitHub PR comment. A new commit receives a new review; duplicate reviews for the same SHA are suppressed.

GitHub issues, branches, PRs and review comments are the durable communication ledger. No model can merge, deploy the product, apply production migrations, or write production data. Product CI and maintainer acceptance remain release gates.

## Trigger

On an ordinary GitHub issue, the repository owner can add:

/ai Implement the requested change and add regression tests.

Only owner-authored commands are accepted. At most one implementation task is processed per invocation across the configured repository allowlist.

## Connected services

- **Starimg:** authenticated model catalog and Fable 5.2-compatible Messages API. The model is checked against the live catalog before use.
- **GitHub:** owner-authenticated task intake, repository preflight, isolated branches, PRs and persistent reviewer handoffs.
- **Supabase:** the reviewer attempts a read-only Management API project check. The currently configured `SUPABASE_ACCESS_TOKEN` is rejected with HTTP 401; replace it with a valid Supabase Personal Access Token before treating Supabase as connected. The database connection string is not used by the agent.
- **Vercel:** the reviewer uses the existing token for read-only project and latest-deployment checks.
- **Cloudflare, Fly.io, Neon, Railway, Render, Supabase and Vercel:** the reviewer performs read-only credential/connection checks and reports only minimal status metadata. No provider mutation is performed by these checks.

Provider credentials are synced from GitHub Actions repository secrets by `.github/workflows/sync-agent-secrets.yml`, using stdin and without printing values. The workflow is manual-only and becomes dispatchable after it reaches the default branch. The last secret-sync attempt found only `SUPABASE_ACCESS_TOKEN`; the Railway, Cloudflare, Fly.io, Neon, and Render secrets were absent. Credentials are never copied into source, model prompts, logs, GitHub comments, or subprocess environments.

## Railway roles

| Service | Role | Schedule | Runtime |
|---|---|---|---|
| stream-service | bounded implementer worker | every 5 minutes (live Railway configuration) | at most one task per invocation |
| sherlock-ai-bot | independent read-only PR reviewer | every 5 minutes (live Railway configuration) | at most one PR per invocation |

The live worker currently implements only the GitHub issue/PR path. Architect, builder, tester and recovery are not yet separate Railway consumers of the USH durable queues. Do not infer those roles from the API's role-token schema.

Both services use the same pinned source branch and Dockerfile root /services/autonomous-agent. The live Railway configuration currently contains a seven-repository allowlist; runtime logs confirm both workers report `Worker disabled`. The previous PR description's claim that the live services are restricted to Sherlock is not supported by current environment evidence. The new `SHERLOCK_EXECUTION_SCOPE` fail-closed mode forces the worker to `Aloews/sherlock-scholes-` regardless of the broader list. Do not enable a worker until that scope is configured, exact-head tests pass, and the owner has approved model/CI spend. No public domain is required.

### Sherlock Scholes adapter

The default worker mode supports a legacy repository allowlist. It must not be used for live Sherlock task execution because the Railway configuration currently contains seven repositories.

- `SHERLOCK_EXECUTION_SCOPE=false` by default. When true, the worker ignores `GITHUB_REPOSITORIES` and `GITHUB_REPOSITORY` and instantiates only `Aloews/sherlock-scholes-`.
- The Sherlock scope and USH scope are mutually exclusive; setting both fails before repository preflight.
- The scope uses only the existing Sherlock path allowlist. Agent runtime source, GitHub workflows, secrets, environment files, lockfiles and deployment configuration remain excluded.
- `SHERLOCK_BASE_BRANCH` is mandatory when the scope is enabled. Preflight verifies the branch name and resolves it to a 40-character immutable SHA before the worker accepts any task.
- The scope does not enable execution. `AGENT_ENABLED` remains a separate, default-off gate; no Railway variable or service configuration is changed by this code.
- The implementer and reviewer must each be configured for this same repository scope before either is activated. Model generation and CI usage remain subject to an explicit spend ceiling.

### Universal Service Hub adapter

The executor has a separate, fail-closed USH adapter mode. It is deliberately not enabled by default.

- `USH_EXECUTION_SCOPE=false` — default; preserves the existing configured repository behavior.
- When `USH_EXECUTION_SCOPE=true`, the worker ignores the broader `GITHUB_REPOSITORIES` list and instantiates only `Aloews/russian-dev-projects`.
- Only issues whose title/body identifies `Universal Service Hub` / `universal-service-hub`, or which carry the `project:ush` label, are eligible.
- The adapter contract is explicit in `GitHubProjectAdapter`: project identity, single repository, writable paths, required base-branch variable, validation manifest and issue-label classifier.
- The writable paths are limited to `universal-service-hub/src/`, `rust-migrations/`, `tests/`, `docs/`, the exact file `scripts/test_tenant_schema.sh`, `Cargo.toml`, `Dockerfile` and `README.md` under that project root. Repository workflows, root files, lockfiles, secrets and other projects remain excluded.
- `USH_BASE_BRANCH` is mandatory in this mode. Preflight verifies that it resolves to an immutable 40-character commit SHA; the worker clones and opens a draft PR against that branch. For the current USH workstream the intended base is `feat/ush-durable-task-dispatcher-bootstrap`.
- The adapter reads the nested `universal-service-hub/AGENTS.md` as read-only instructions.
- Rust validation uses `universal-service-hub/Cargo.toml` for formatting, Clippy and test compilation. Database integration/migration tests run only against an explicitly marked disposable PostgreSQL database.
- This adapter currently bounds the existing GitHub issue-to-PR worker; it is not yet wired to claim tasks from the USH PostgreSQL queue, lease persistent Git worktrees, checkpoint execution through the Rust API, or run the architect/builder/tester/recovery queues. Those are separate remaining integration tasks.
- No execution-scope environment change, agent activation, or credential change is made by this code update. Enable the scope only after exact-head tests and the full USH tenant/security acceptance suite pass.


## Required runtime variables

Common:
- AGENT_ENABLED=true (only after the applicable execution acceptance gate)
- AGENT_ROLE=implementer or reviewer
- GITHUB_REPOSITORIES — explicit repository allowlist; ignored only while `USH_EXECUTION_SCOPE=true`
- USH_EXECUTION_SCOPE=false by default; set true only for the isolated USH execution phase
- SHERLOCK_EXECUTION_SCOPE=false by default; set true only after the Sherlock worker scope is reviewed
- SHERLOCK_BASE_BRANCH=main (required only when SHERLOCK_EXECUTION_SCOPE=true)
- USH_BASE_BRANCH — required when USH execution scope is enabled
- GITHUB_TOKEN
- STARIMG_API_KEY
- STARIMG_BASE_URL=https://ai.starimg.ru/v1
- STARIMG_MODEL=claude-fable-5-2
- STARIMG_REVIEWER_MODEL=claude-fable-5-2
- CLOUDFLARE_API_TOKEN (optional read-only token verification)
- FLY_API_TOKEN (optional read-only app inventory)
- NEON_API_KEY (optional read-only project inventory)
- RAILWAY_API_TOKEN or RAILWAY plus RAILWAY_WORKSPACE_ID (optional read-only GraphQL identity/workspace/project-token check)
- RENDER_API_KEY (optional read-only service inventory)

Reviewer-only, non-secret:
- SUPABASE_PROJECT_REF=konoavrduynecxblqfvq
- VERCEL_PROJECT_ID=prj_zPmwoDaqeK57VzUBzFxTJGMjUm65
- VERCEL_TEAM_ID=team_e1o23XoY7tj0C19a4zwqDMhT

Reviewer-only existing secrets:
- SUPABASE_ACCESS_TOKEN
- VERCEL_TOKEN

The reviewer uses only read-only GET requests and Railway GraphQL queries. It never changes infrastructure, reads or prints secret values, applies migrations, triggers product deployments, or writes product data. Vercel's latest production deployment is READY. PR preview deployments are intentionally skipped by the repository's Ignored Build Step unless the commit message contains `[vercel-preview]`. Missing provider credentials are reported as not_configured rather than treated as connected.

## Safety and limits

- No arbitrary model-generated shell commands.
- No worker self-modification, CI workflow edits, lockfiles, secrets, deletions, renames or symlinks. The USH adapter permits only its explicitly listed Cargo manifest and tenant-schema smoke script.
- Per-repository write-path allowlists remain enforced.
- Every child process receives a strict environment allowlist; provider credentials are excluded.
- Patch size is bounded; reviewer corrections are restricted to the original changed-file set.
- Review comments are SHA-scoped and idempotent.
- No automatic merge, production deployment, migration or production data writes.
- Failed model output, invalid handoff JSON, failed validation or unresolved review findings fail closed without opening a PR.

## Verification

The Docker build compiles the worker and runs its offline unit suite. GitHub Actions repeats those checks on the exact PR head. Runtime provider checks are read-only and report only project status, region, deployment state and commit SHA—not credentials.
