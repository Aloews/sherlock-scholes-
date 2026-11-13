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
- **Supabase:** the reviewer uses the existing scoped Management API token for read-only project health checks. The database connection string is not used by the agent.
- **Vercel:** the reviewer uses the existing token for read-only project and latest-deployment checks.
- **Railway:** the implementer and reviewer run as separate scheduled roles in the existing Railway project. Railway environment/service metadata is included in the read-only preflight; no Railway API token is currently configured for runtime resource-management operations.

Supabase and Vercel credentials already exist on the reviewer service. Their values are never copied into source, prompts, logs, or subprocess environments.

## Railway roles

| Service | Role | Schedule | Runtime |
|---|---|---|---|
| stream-service | implementer + architect + internal reviewer | every 5 minutes | one task per invocation |
| sherlock-ai-bot | independent PR reviewer | every 5 minutes | one PR per invocation |

Both services use the same pinned source branch and Dockerfile root /services/autonomous-agent. The reviewer role is enabled only after the branch passes its worker tests and Docker build. No public domain is required.

## Required runtime variables

Common:
- AGENT_ENABLED=true
- AGENT_ROLE=implementer or reviewer
- GITHUB_REPOSITORIES — explicit repository allowlist
- GITHUB_TOKEN
- STARIMG_API_KEY
- STARIMG_BASE_URL=https://ai.starimg.ru/v1
- STARIMG_MODEL=claude-fable-5-2

Reviewer-only, non-secret:
- SUPABASE_PROJECT_REF=konoavrduynecxblqfvq
- VERCEL_PROJECT_ID=prj_zPmwoDaqeK57VzUBzFxTJGMjUm65
- VERCEL_TEAM_ID=team_e1o23XoY7tj0C19a4zwqDMhT

Reviewer-only existing secrets:
- SUPABASE_ACCESS_TOKEN
- VERCEL_TOKEN

The reviewer uses only GET requests against Supabase and Vercel. It never reads secret values from those providers, changes settings, applies migrations, or triggers deployments.

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
