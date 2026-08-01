# Code Review Standard

> Part of the [Engineering Constitution](./ENGINEERING_CONSTITUTION.md). Applies
> to human and AI reviewers. Review is a **gate**, not a formality.

## 1. Principles

- Review for **correctness, clarity, and conformance to the standards** — not
  personal taste. Cite the standard, not an opinion.
- Be specific and kind. Suggest, don't demand style. **Block** only on real
  problems: bugs, standard violations, missing tests, security/data issues.
- The author is responsible for a green, Done PR; the reviewer for catching what
  the gates can't.

## 2. What every PR MUST have

- A clear description: what, why, how tested. The PR template
  ([`.github/PULL_REQUEST_TEMPLATE.md`](../.github/PULL_REQUEST_TEMPLATE.md)) is
  filled in, not deleted.
- Small, focused scope. A PR doing three things gets split.
- Passing CI (all gates). A red gate is an automatic block.
- Tests for new logic; a **regression test for every bug fixed**.
- Docs/ADR updated when behaviour or a standard changed.

## 3. Reviewer checklist (block if any fails)

Correctness
- [ ] Does what it claims; edge cases (null, empty, error, offline) handled.
- [ ] No race conditions in effects/realtime/timer; no missing cleanup.
- [ ] Every bug fix has a test that fails without the fix.

Standards
- [ ] Layer boundaries respected; no cycles; correct FSD placement
      ([`ARCHITECTURE.md`](./ARCHITECTURE.md)).
- [ ] TS strict; no new `any`/unjustified `as`/`!`/`@ts-ignore`
      ([`TYPESCRIPT_STANDARD.md`](./TYPESCRIPT_STANDARD.md)).
- [ ] React: dumb components stay dumb, narrow selectors, effects correct,
      loading/error/empty/success handled ([`REACT_STANDARD.md`](./REACT_STANDARD.md)).
- [ ] Game phase changed only via the state machine.
- [ ] Supabase change is a migration; RLS considered; no secret leak
      ([`SUPABASE_STANDARD.md`](./SUPABASE_STANDARD.md), [`SECURITY_STANDARD.md`](./SECURITY_STANDARD.md)).
- [ ] Telegram: `initData` trusted only after server verification
      ([`TELEGRAM_STANDARD.md`](./TELEGRAM_STANDARD.md)).
- [ ] Deck change passes data-integrity; found defects locked
      ([`DATA_QUALITY_STANDARD.md`](./DATA_QUALITY_STANDARD.md)).
- [ ] i18n keys synced across all 9 locales; no hardcoded strings.

Tests & quality
- [ ] Adequate unit/property/data-integrity coverage; tests assert behaviour.
- [ ] Coverage & mutation gates hold; no new meaningful mutation survivors.
- [ ] No gate weakened to pass (that requires an ADR).

Clarity
- [ ] Names are honest; non-obvious code has a *why* comment; no dead/commented
      code; no debug leftovers.

## 4. Approval criteria (Definition of Reviewed)

Approve only when: CI green, checklist clear, description accurate, tests present
and meaningful, docs/ADR updated as needed. If you can't verify a claim, ask —
don't approve on trust.

## 5. AI-authored PRs

Hold agent PRs to the **same** bar — never lower. Because agents can produce
plausible-but-wrong code and tests, pay extra attention to: tests that don't
actually assert (mutation report is the tell), invented APIs, silent scope creep,
and gates quietly weakened. Every agent comment/PR carries the Claude attribution
footer.

## 6. Merging

- Squash-merge with a clean, conventional message.
- Never merge your own PR past a red gate. Never force-merge to skip a gate; fix
  the gate or write an ADR to change it.
