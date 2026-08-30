# Sherlock Scholes — Engineering Constitution

> The single source of truth for how this project is built. Every human and
> every AI agent (Claude Code, Codex, Cursor, Windsurf, Gemini CLI, …) is bound
> by this document. When code and this document disagree, **this document
> wins** — fix the code or, with an ADR, change the document.

Status: **living**. Version: 1.0 (2026-07). Owner: repository maintainer.

---

## 0. How to use this document

This is an index + the project philosophy. Detailed rules live in focused
standards under `docs/`, so they can be searched, updated and fed to agents one
at a time:

| Area | Document |
| --- | --- |
| Philosophy, Definition of Done, quality bar | **this file** |
| Architecture, layers, FSD, dependency rules | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| React component & hook rules | [`REACT_STANDARD.md`](./REACT_STANDARD.md) |
| TypeScript rules (strict, no `any`, branded types) | [`TYPESCRIPT_STANDARD.md`](./TYPESCRIPT_STANDARD.md) |
| Telegram Mini App (initData, lifecycle, UX) | [`TELEGRAM_STANDARD.md`](./TELEGRAM_STANDARD.md) |
| Supabase (RLS, migrations, indexes, SQL) | [`SUPABASE_STANDARD.md`](./SUPABASE_STANDARD.md) |
| Code review checklist & PR acceptance | [`CODE_REVIEW_STANDARD.md`](./CODE_REVIEW_STANDARD.md) |
| Full testing strategy | [`TESTING_STANDARD.md`](./TESTING_STANDARD.md) |
| Performance budgets & Web Vitals | [`PERFORMANCE_STANDARD.md`](./PERFORMANCE_STANDARD.md) |
| Security (OWASP, secrets, auth, roles) | [`SECURITY_STANDARD.md`](./SECURITY_STANDARD.md) |
| Observability (logging, tracing, Sentry) | [`OBSERVABILITY_STANDARD.md`](./OBSERVABILITY_STANDARD.md) |
| Football data quality & dedup | [`DATA_QUALITY_STANDARD.md`](./DATA_QUALITY_STANDARD.md) |
| CI/CD & quality gates | [`CI_CD_STANDARD.md`](./CI_CD_STANDARD.md) |
| Engineering metrics | [`ENGINEERING_METRICS.md`](./ENGINEERING_METRICS.md) |
| How AI agents must operate here | [`AI_ENGINEERING_GUIDE.md`](./AI_ENGINEERING_GUIDE.md) |
| Project evolution rules | [`ROADMAP.md`](./ROADMAP.md) |
| Architecture Decision Records | [`ADR/`](./ADR/) |
| Reusable checklists | [`CHECKLISTS/`](./CHECKLISTS/) |
| Agent/task prompts | [`PROMPTS/`](./PROMPTS/) |

`CLAUDE.md` / `AGENTS.md` at the repo root are the **agent entrypoints**.
`CLAUDE.md` carries the hands-on working rules for the app (i18n, design system,
the deck, local checks) and is kept current as the code changes; it links here
for the long-form standards. Read `CLAUDE.md` first, then the relevant standard
below. Where `CLAUDE.md` and this constitution disagree about the app itself,
`CLAUDE.md` wins; on the engineering standards, this document wins.

---

## 1. What Sherlock Scholes is

A Telegram Mini App — a football "Alias" party game. Players describe footballers
(and clubs, coaches, stadiums, terms…) instead of ordinary words; teammates
guess against a timer. Cards live in Supabase; an offline Python scraper
(`football_scraper/`) builds and enriches the deck.

The product is **content + a real-time social loop**. That shapes the two things
we defend hardest: **data correctness** (a wrong card is visible to every player)
and **the game state machine / timer / scoring** (a bug there breaks a live
round for a whole room).

---

## 2. Engineering philosophy

1. **Never trust existing code.** Assume hidden bugs. A change is not safe
   because "it worked before" — it is safe because a test proves it.
2. **The constraint chain replaces code-reading.** We surround code with
   extreme constraints — types, lint, unit, property, data-integrity, mutation,
   review gates — so that correctness is enforced, not inspected. An AI agent's
   output is trusted only after it has passed the whole chain.
3. **Bugs are specifications we forgot to write.** Every bug is fixed
   **regression-first**: a failing test that reproduces it, then the fix, then
   green. No fix without a test that would have caught it.
4. **Simple beats clever.** Code is read far more than written. Optimise for the
   next reader (often an agent with no context). No cleverness without a comment
   explaining why it must be clever.
5. **Make illegal states unrepresentable.** Prefer types and state machines that
   cannot express a broken state over runtime checks that hope to catch one.
6. **Boring, explicit, boundaried.** Explicit data flow, explicit error
   handling, explicit layer boundaries. Magic is a liability.
7. **Data is a first-class citizen.** The deck is production content. It gets the
   same rigour as code: schema, invariants, tests, review.
8. **Small, reversible steps.** Small PRs, feature flags, migrations that can be
   rolled forward. Big-bang changes are an anti-pattern.

---

## 3. Definition of Done

A change is **Done** only when **all** of the following hold:

- [ ] It does what the issue/PR says, and nothing it doesn't say (no scope creep).
- [ ] `npm run typecheck` passes under **TypeScript strict** — zero `any` added
      (see [`TYPESCRIPT_STANDARD.md`](./TYPESCRIPT_STANDARD.md)).
- [ ] `npm run build` succeeds.
- [ ] Lint passes with zero new warnings.
- [ ] New/changed logic has **unit tests**; pure invariants have **property
      tests**; deck changes have **data-integrity tests**.
- [ ] Coverage on touched core modules stays ≥ the gate (line 90 / branch 85).
- [ ] **Mutation score** on touched core modules stays ≥ 85 %; no new *meaningful*
      survivors (equivalent mutants must be justified in the PR).
- [ ] Every bug fixed in the PR has a regression test that fails without the fix.
- [ ] User-facing strings go through i18n (all 9 locales keep matching keys).
- [ ] Supabase changes ship as a migration with RLS considered
      (see [`SUPABASE_STANDARD.md`](./SUPABASE_STANDARD.md)).
- [ ] Docs updated when behaviour or a standard changed; an ADR added for a
      significant decision.
- [ ] CI is green. **A red gate blocks merge — always.**

If you cannot check a box, say so explicitly in the PR — do not silently skip it.

---

## 4. Quality bar (the numbers)

These are enforced, not aspirational. See [`ENGINEERING_METRICS.md`](./ENGINEERING_METRICS.md)
and [`CI_CD_STANDARD.md`](./CI_CD_STANDARD.md).

| Metric | Gate | Target |
| --- | --- | --- |
| TypeScript | `strict: true`, no new `any` | 0 `any` |
| Coverage (core: `features/game`, `shared/lib`, `shared/store`, `scraper/`) | line ≥ 90 %, branch ≥ 85 % | ≥ 95 % |
| Mutation score (core) | break < 80 | ≥ 85 %, climbing |
| Data-integrity suite | 0 failures | 0 |
| Bundle (initial JS, gz) | ≤ 250 KB | ≤ 180 KB |
| Lighthouse (mobile) Perf / A11y | ≥ 85 / ≥ 90 | ≥ 90 / 100 |
| Known `it.fails` defect locks | tracked in issues | trending to 0 |

**Non-goals / explicitly rejected** (see [`TESTING_STANDARD.md`](./TESTING_STANDARD.md)
§ "Deliberately excluded"): dogmatic 100 % branch coverage; load/stress or fuzz
against the live free-tier Supabase / API-Football; paid SaaS (Percy/Pact/
SonarQube) at this project's scale. These are wrong for this project and must not
be added without an ADR.

---

## 5. Amending this constitution

The constitution changes only through a PR that:
1. adds or updates an **ADR** in [`ADR/`](./ADR/) explaining the decision, and
2. updates the affected standard document, and
3. is approved by the repository maintainer.

Agents may **propose** amendments (as an ADR draft) but must not weaken a gate to
make their own change pass. Lowering a quality bar is itself a decision requiring
an ADR.
