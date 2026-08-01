# Prompt: scaffold a new feature

> Paste to an agent, then describe the feature. Operationalises
> [`ARCHITECTURE.md`](../ARCHITECTURE.md).

---

You are building a new feature in Sherlock Scholes, bound by
`docs/ENGINEERING_CONSTITUTION.md`. Before coding, read `docs/ARCHITECTURE.md`
and the standard for anything you touch. If the requirement is ambiguous or
architecturally significant, **ask before coding**.

**Placement (Feature-Sliced Design):**
- Pure logic → `shared/lib/` (+ unit/property tests).
- Reusable dumb UI → `shared/ui/`.
- State → `shared/store/` (Zustand + immer, narrow selectors).
- The capability (hooks + `*.service.ts` / `*Api.ts`) → `features/<name>/`.
- A page → `screens/` + a route in `app/Router.tsx`.
- Respect the dependency rule (no upward imports, no cycles).

**Do:**
- Types first, zero `any`; model illegal states out (discriminated unions,
  branded ids, exhaustive switches).
- No Supabase calls from UI; go through a service. Any DB change is a migration
  with RLS considered. Any game-phase change goes through the state machine.
- All text via i18n, keys added to all 9 locales.
- Handle loading/error/empty/success; clean up effects/subscriptions/timers.

**Tests (same PR):** unit + property for logic; component (loading/error/empty/
success + `axe`) for UI; data-integrity if you touch the deck. Keep coverage &
mutation gates green; widen `mutate`/`coverage.include` if you added core logic.

**Deliverable:** a small draft PR with the PR template filled, CI green, docs/ADR
updated if you introduced a new pattern.
