# Reality-First skill rollout

The same portable skill is being installed into each accessible active product repository. Each installation is delivered through an isolated draft PR; no PR is auto-merged and no product code or production data is changed by this rollout.

| Repository | Purpose | Installation PR | Included guardrails |
|---|---|---|---|
| `Aloews/sherlock-scholes-` | Football game and analytics | [#389](https://github.com/Aloews/sherlock-scholes-/pull/389) | Rust/service boundaries, Supabase/Vercel/Railway, Starimg |
| `Aloews/first-traffic-platform` | RTB/DSP platform | [#4](https://github.com/Aloews/first-traffic-platform/pull/4) | Preserve existing campaign and data behavior; no unapproved spend or releases |
| `Aloews/russian-dev-projects` | Public directory of Russian developer projects | [#1](https://github.com/Aloews/russian-dev-projects/pull/1) | Preserve third-party entries, attribution, contribution rules, links and status tables |
| `Aloews/sherlock-tv` | MatchLive streaming catalogue/player | [#5](https://github.com/Aloews/sherlock-tv/pull/5) | Catalogue vs media manifest, CORS/mixed content, rights, standalone ownership |
| `Aloews/sherlock-ai-bot` | Telegram AI and management bots | [#14](https://github.com/Aloews/sherlock-ai-bot/pull/14) | Keep bot entrypoints separate, preserve webhook mode, Starimg and token isolation |
| `Aloews/Novel-forge` | AI novel-writing studio | [#12](https://github.com/Aloews/Novel-forge/pull/12) | Chapter continuity, Supabase persistence, resumability, Starimg-only provider boundary |

## Skill package

Every installation contains the identical five-file package:

- `.agents/skills/reality-first-autonomous-engineering/SKILL.md`
- `references/operating-model.md`
- `references/security-and-cost.md`
- `templates/PROJECT_MAP.md`
- `templates/TASK_CONTRACT.md`

Each repository also receives a short root `AGENTS.md` that activates the skill and adds repository-specific guardrails.

## Railway executor

The existing Railway `stream-service` is repurposed with the user's explicit authorization. The worker is configured with the six-repository allowlist above, excluding no product repository in this rollout. The public directory repository is limited to `pages/`, `docs/`, and `scripts/`. Other repositories have distinct writable-path prefixes in the worker source.

Safety gates:
- `AGENT_ENABLED=false` until all required CI checks and multi-repository preflight pass.
- Cron schedule remains parked at `0 0 1 1 *` during verification.
- At most one task across all repositories per invocation.
- Authenticated repository-owner issue comments only.
- One isolated branch and PR per task; no merge, production deployment, migration, or production data writes.
- Starimg is the only model gateway.
- GitHub token permissions are checked per repository before task processing.

## Not included

- `Aloews/full` has only a placeholder README and was not treated as an active software project.
- AlphaPulse and Kontur do not appear as separately accessible repositories in the connected GitHub inventory. Their repository access/location must be established before installing the skill there; no substitute repository was guessed.
