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
| stream-service | implementer + architect + internal reviewer | every 5 minutes | one task per invocation |
| sherlock-ai-bot | independent PR reviewer | every 5 minutes | one PR per invocation |

Both services use the same pinned source branch and Dockerfile root /services/autonomous-agent. The implementation service is scoped to Aloews/sherlock-scholes- only; the reviewer scans only that repository. No public domain is required.

## Required runtime variables

Common:
- AGENT_ENABLED=true
- AGENT_ROLE=implementer or reviewer
- GITHUB_REPOSITORIES — explicit repository allowlist
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
