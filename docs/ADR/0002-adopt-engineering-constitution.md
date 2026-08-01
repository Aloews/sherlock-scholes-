# 0002. Adopt the Engineering Constitution

- **Status:** Accepted
- **Date:** 2026-07
- **Deciders:** Repository maintainer
- **Related:** [Engineering Constitution](../ENGINEERING_CONSTITUTION.md), all `docs/*_STANDARD.md`

## Context

Sherlock Scholes is built by humans and by AI agents across different tools
(Claude Code, Codex, Cursor, Windsurf, Gemini CLI). Without one shared standard,
each contributor invents conventions, quality is uneven, and there is no single
answer to "how do we do X here?". The project also carries real risk in two
places — production card data (a wrong card is seen by every player) and the
live game state machine — that demands a high, enforced bar.

## Decision

We adopt a single **Engineering Constitution**: a top-level philosophy +
Definition of Done, plus focused standard documents under `docs/`, with root
`CLAUDE.md`/`AGENTS.md` as the agent entrypoints. It is a multi-file set (not one
mega-file) so sections can be searched, updated, and fed to agents individually.
The constitution is binding on humans and agents alike; when code and the
constitution disagree, the constitution wins.

## Alternatives considered

- **One giant `ENGINEERING_CONSTITUTION.md` (40–80k words)** — rejected: hard to
  search, update, and load into an agent's context; merge-conflict magnet.
- **Rely on tool-specific config only (per-IDE rules)** — rejected: fragments the
  standard across tools; no single source of truth.
- **No written standard** — rejected: uneven quality, especially with agents.

## Consequences

- **Positive:** one enforced standard for humans and every agent; discoverable,
  maintainable, testable.
- **Negative:** the docs must be kept current — a stale standard is worse than
  none. Mitigated by the amendment rule (§ 5) and review.
- **Follow-ups:** wire the gates the constitution assumes (branch protection);
  keep docs updated as behaviour changes.

## Compliance

The constitution is self-enforcing via its gates (CI) and the review checklist.
Amendments require an ADR + doc update (§ 5).
