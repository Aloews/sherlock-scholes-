<!--
Bound by docs/ENGINEERING_CONSTITUTION.md. Fill this in — don't delete sections.
Full rules: docs/CODE_REVIEW_STANDARD.md and the Definition of Done (Constitution §3).
-->

## What & why
<!-- What does this change do, and why? Link the issue. -->

Closes #

## How it was tested
<!-- Commands run, cases covered. For a bug: describe the regression test that
fails without the fix. -->

## Type of change
- [ ] Feature
- [ ] Bug fix (has a regression test that fails without the fix)
- [ ] Data / deck change (passes data-integrity)
- [ ] Refactor / chore
- [ ] Docs / ADR

## Definition of Done
- [ ] `npm run typecheck` (strict) + `npm run build` pass; no new `any`.
- [ ] Lint passes; no dependency cycles.
- [ ] Tests added (unit / property / data-integrity / component as applicable).
- [ ] Coverage & mutation gates hold on touched core; no new meaningful survivors.
- [ ] Layer boundaries respected; game phase changed only via the state machine.
- [ ] Supabase change is a migration; RLS considered; no secrets committed/logged.
- [ ] Telegram `initData` trusted only after server verification (if touched).
- [ ] i18n keys synced across all 9 locales; no hardcoded user-facing strings.
- [ ] Docs updated; **ADR added** if a pattern or a quality gate changed.
- [ ] CI is green.

## Notes for the reviewer
<!-- Anything to look at closely, trade-offs, follow-ups, equivalent mutants
justified, gates deliberately unchanged, etc. -->
