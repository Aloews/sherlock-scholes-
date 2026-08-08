# AGENTS.md

This repository uses a single standard for all AI coding agents — Claude Code,
OpenAI Codex, Cursor, Windsurf, Gemini CLI, Aider, and any other agentic tool.

**The operating rules are in [`CLAUDE.md`](./CLAUDE.md)** — the hands-on,
frequently-updated working rules for this app (i18n, design system, the deck,
local checks). It is authoritative on how the app itself works and links out to
the long-form [`docs/ENGINEERING_CONSTITUTION.md`](./docs/ENGINEERING_CONSTITUTION.md)
and the per-area standards.

Whichever file your tool reads, the path is the same: read `CLAUDE.md` first,
then the relevant `docs/*_STANDARD.md`. Where `CLAUDE.md` and the constitution
disagree about the app itself, `CLAUDE.md` is current.

## TL;DR for any agent

1. Read `CLAUDE.md` and the relevant `docs/*_STANDARD.md` before editing.
2. Never trust existing code; fix bugs **regression-first** (failing test → fix →
   green).
3. TypeScript strict, zero `any`; respect the Feature-Sliced layer boundaries.
4. The card deck is production data — changes must pass the data-integrity suite.
5. Never weaken a quality gate (coverage, mutation, lint) to pass; that needs an
   ADR.
6. Small focused branches, draft PRs, fill in the PR template, keep CI green.

The canonical, detailed system prompt for agents lives in
[`docs/AI_ENGINEERING_GUIDE.md`](./docs/AI_ENGINEERING_GUIDE.md) and
[`docs/PROMPTS/`](./docs/PROMPTS/).
