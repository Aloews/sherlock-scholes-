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

Both services use the same pinned source branch and Dockerfile root /services/autonomous-agent. The live repository list is configured separately through `GITHUB_REPOSITORIES`; a configured repository is not proof that task execution is enabled. Live logs previously reported `Worker disabled`, and execution must remain disabled until the relevant acceptance gates pass. No public domain is required.

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

The reviewer uses only read-only GET requests and Railway GraphQL queries. It never changes infrastructure, reads or prints secret values, applies migrations, triggers product deployments, or writes product data. Vercel's latest production deployment is READY, but preview deployments are currently blocked by the account's free-plan 100-deployments-per-day limit. Missing provider credentials are reported as not_configured rather than treated as connected.

## Safety and limits

- No arbitrary model-generated shell commands.
- No worker self-modification, workflow/manifests/lockfiles, secrets, deletions, renames or symlinks.
- Per-repository write-path allowlists remain enforced.
- Every child process receives a strict environment allowlist; provider credentials are excluded.
- Patch size is bounded; reviewer corrections are restricted to the original changed-file set.
- Review comments are SHA-scoped and idempotent.
- No automatic merge, production deployment, migration or production data writes.
- Failed model output, invalid handoff JSON, failed validation or unresolved review findings fail closed without opening a PR.

## Verification

The Docker build compiles the worker and runs its offline unit suite. GitHub Actions repeats those checks on the exact PR head. Runtime provider checks are read-only and report only project status, region, deployment state and commit SHA—not credentials.
