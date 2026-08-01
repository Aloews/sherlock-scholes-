# Sherlock Scholes — Engineering Docs

This directory is the project's **development operating system**: one enforced
standard for humans and AI agents alike. Start with the constitution.

## Start here
- **[ENGINEERING_CONSTITUTION.md](./ENGINEERING_CONSTITUTION.md)** — philosophy,
  Definition of Done, quality bar, and the index of everything below.
- Agent entrypoints at the repo root: [`../CLAUDE.md`](../CLAUDE.md),
  [`../AGENTS.md`](../AGENTS.md).

## Standards
| Doc | Covers |
| --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Layers, Feature-Sliced Design, dependency rules, prohibitions |
| [REACT_STANDARD.md](./REACT_STANDARD.md) | Components, hooks, Zustand, performance, error boundaries |
| [TYPESCRIPT_STANDARD.md](./TYPESCRIPT_STANDARD.md) | Strict mode, no `any`, generics, branded types, unions |
| [TELEGRAM_STANDARD.md](./TELEGRAM_STANDARD.md) | `initData`, lifecycle, theming, offline, UX |
| [SUPABASE_STANDARD.md](./SUPABASE_STANDARD.md) | RLS, migrations, RPC, indexes, realtime, SQL |
| [SECURITY_STANDARD.md](./SECURITY_STANDARD.md) | OWASP-as-mapped, auth, secrets, CSP, static analysis |
| [PERFORMANCE_STANDARD.md](./PERFORMANCE_STANDARD.md) | Budgets, Web Vitals, bundle, search at scale |
| [OBSERVABILITY_STANDARD.md](./OBSERVABILITY_STANDARD.md) | Logging, error tracking, tracing, metrics |
| [DATA_QUALITY_STANDARD.md](./DATA_QUALITY_STANDARD.md) | Football data invariants, dedup, source validation |
| [TESTING_STANDARD.md](./TESTING_STANDARD.md) | The full testing policy and gates |
| [CODE_REVIEW_STANDARD.md](./CODE_REVIEW_STANDARD.md) | Review checklist, PR acceptance |
| [CI_CD_STANDARD.md](./CI_CD_STANDARD.md) | Pipeline, quality gates, deployment |
| [ENGINEERING_METRICS.md](./ENGINEERING_METRICS.md) | What we measure and the thresholds |
| [AI_ENGINEERING_GUIDE.md](./AI_ENGINEERING_GUIDE.md) | How agents operate here + canonical system prompt |
| [ROADMAP.md](./ROADMAP.md) | Engineering phases & evolution rules |

## Working material
- [ADR/](./ADR/) — Architecture Decision Records (why the project is the way it is).
- [CHECKLISTS/](./CHECKLISTS/) — PR, architecture audit, security, data quality, release QA.
- [PROMPTS/](./PROMPTS/) — ready-to-paste agent prompts (total testing, audit, feature scaffold).

## Related, at the repo root
- [`../TESTING.md`](../TESTING.md) — how to run each test layer and read a mutation report.
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md), [`../ROADMAP.md`](../ROADMAP.md) — the original short product notes.

> This is a **living** standard. It changes only via a PR that updates the
> relevant doc and adds an ADR. When code and these docs disagree, the docs win —
> fix the code, or change the docs with an ADR.
