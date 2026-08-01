# PR Checklist

Quick gate before requesting review. Full rules: [Code Review Standard](../CODE_REVIEW_STANDARD.md),
Definition of Done in the [Constitution](../ENGINEERING_CONSTITUTION.md) § 3.

## Scope & description
- [ ] One focused concern; not three changes in one PR.
- [ ] Description says what / why / how tested; PR template filled in.
- [ ] ADR added if a pattern or gate changed.

## Correctness
- [ ] Handles null / empty / error / offline paths.
- [ ] No race conditions; effects/subscriptions/timers cleaned up.
- [ ] **Every bug fixed has a regression test** that fails without the fix.

## Standards
- [ ] Correct FSD layer; no upward imports; no cycles.
- [ ] TS strict; no new `any` / unjustified `as` / `!` / `@ts-ignore`.
- [ ] React: dumb components dumb, narrow selectors, loading/error/empty/success.
- [ ] Game phase changed only via the state machine.
- [ ] Supabase change is a migration; RLS considered; no secrets.
- [ ] Telegram `initData` trusted only after server verification.
- [ ] Deck change passes data-integrity; new inaccuracies locked.
- [ ] i18n keys synced across all 9 locales; no hardcoded strings.

## Tests & gates
- [ ] Unit / property / data-integrity tests added as applicable.
- [ ] `npm run typecheck`, `npm test`, `npm run build` pass locally.
- [ ] Coverage & mutation gates hold; no new meaningful mutation survivors.
- [ ] No gate weakened to pass.

## Hygiene
- [ ] No dead/commented code; no debug leftovers; honest names.
- [ ] Docs updated if behaviour/standard changed.
- [ ] CI green.
