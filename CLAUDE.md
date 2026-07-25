# CLAUDE.md — agent operating rules for Sherlock Scholes

This file is the entrypoint for AI coding agents (Claude Code, and via
`AGENTS.md` also Codex, Cursor, Windsurf, Gemini CLI…). It is intentionally
short. The binding rules live in the **Engineering Constitution**:
[`docs/ENGINEERING_CONSTITUTION.md`](./docs/ENGINEERING_CONSTITUTION.md).

Read it, and the standard for whatever you're touching, before you change code.

## What this project is

Telegram Mini App — a football "Alias" game. React 18 + TypeScript + Vite +
Zustand + Supabase on the frontend (`src/`); an offline Python scraper
(`football_scraper/`) builds the card deck. No custom backend — the client talks
to Supabase (PostgREST + RPC) directly.

## The 10 rules you must not break

1. **Never trust existing code.** Assume hidden bugs; prove correctness with tests.
2. **Regression-first.** For every bug: write a failing test that reproduces it,
   *then* fix, *then* green. No fix without such a test.
3. **TypeScript strict, zero `any`.** No `any`, no non-null `!` to silence the
   compiler, no `@ts-ignore` without a justifying comment. See
   [`docs/TYPESCRIPT_STANDARD.md`](./docs/TYPESCRIPT_STANDARD.md).
4. **Respect the layers.** Feature-Sliced Design; `shared` never imports from
   `features`/`screens`. See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).
5. **Never mutate game phase directly** — go through `features/game/stateMachine.ts`.
6. **The deck is production data.** Any change to `sherlock_cards.csv` or card
   generation must pass the data-integrity suite. See
   [`docs/DATA_QUALITY_STANDARD.md`](./docs/DATA_QUALITY_STANDARD.md).
7. **All user-facing text via i18n**, keys kept in sync across all 9 locales in
   `src/shared/i18n/locales/`.
8. **Supabase changes are migrations**, and you must consider RLS. Never disable
   RLS to make something work. See [`docs/SUPABASE_STANDARD.md`](./docs/SUPABASE_STANDARD.md).
9. **Never weaken a quality gate** (coverage, mutation, lint) to make your change
   pass. Lowering a bar needs an ADR.
10. **Secrets never leave `.env`.** No keys in code, tests, logs, or commits.

## Definition of Done

See the constitution § 3. In short: typecheck + build + lint green; unit +
(where relevant) property + data-integrity tests added; coverage & mutation gates
hold; regression test for every bug; i18n synced; docs/ADR updated; CI green.

## Commands

```bash
npm run dev          # run the mini app locally (Vite)
npm run typecheck    # tsc --noEmit (strict)
npm run build        # tsc && vite build
npm test             # Vitest: unit + property + data-integrity
npm run test:cov     # + coverage gate
npm run test:mutation# StrykerJS mutation testing (game-logic core)

cd football_scraper && pip install -r requirements.txt && python -m pytest -q
```

See [`TESTING.md`](./TESTING.md) for the test layout and how to read a mutation
report.

## Workflow expectations for agents

- Work on a branch; open a **draft PR**; keep PRs small and focused.
- Fill in [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md).
- If a task is ambiguous or architecturally significant, **stop and ask** rather
  than guessing.
- Do not touch content that contradicts how it was described without flagging it.
- Full agent guidance: [`docs/AI_ENGINEERING_GUIDE.md`](./docs/AI_ENGINEERING_GUIDE.md).
