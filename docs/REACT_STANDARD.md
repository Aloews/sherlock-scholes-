# React Standard

> Part of the [Engineering Constitution](./ENGINEERING_CONSTITUTION.md).
> React 18 + Vite (CSR only — this is a Telegram Mini App, no SSR).

## 1. Components

- **Function components only.** No classes except a single Error Boundary (§ 6).
- **One component per file** (plus tightly-coupled small subcomponents).
- **Presentational vs. container.** `shared/ui/` components are dumb: props in,
  JSX out, no data-fetching, no store access, no business rules. Data and logic
  live in feature components/hooks that compose them.
- **Props are typed and minimal.** No `any`, no "god props". If a component takes
  more than ~6 props, consider splitting or grouping.
- **No business logic in JSX.** Compute in the component body (or a hook), render
  the result.
- **Keys** MUST be stable domain ids (`card.id`), never array index for dynamic
  lists.

## 2. Hooks

- Custom hooks (`useXxx`) own side effects, subscriptions, and derived state.
  Feature logic lives here, not in components.
- **Rules of Hooks** are absolute: top-level only, no conditional hooks.
- **`useEffect` discipline:**
  - Exhaustive, correct dependency arrays. Don't lie to the linter; if a dep
    causes a loop, fix the cause (memoise it), don't remove it.
  - Every subscription/timer/listener MUST return a cleanup. Realtime channels,
    `setTimeout`/`setInterval` (see `useTimer.ts`), and Telegram event listeners
    all get torn down on unmount.
  - No `async` effect body directly; define and call an inner async function, and
    guard against setting state after unmount.
- **Derive, don't duplicate.** Don't copy store/props into local state and let it
  drift; compute during render or with `useMemo` when measured necessary.

## 3. Zustand usage

- Read with **narrow selectors**:

  ```ts
  const phase = useGameStore((s) => s.phase);          // good
  const store = useGameStore();                         // bad: re-renders on any change
  ```

- Select the minimum; for multiple fields use separate selectors or a shallow
  equality selector. Don't return a fresh object/array from a selector without
  shallow compare (it re-renders every time).
- Mutations go through store actions (immer). Components never reach into store
  internals.
- **Never** transition game phase from a component — call the state machine.

## 4. Performance

- Default to correctness; optimise against a **measurement** (React Profiler /
  a Web Vital regression), not a hunch. Note the measurement in the PR.
- Tools, when justified: `React.memo` for pure leaf components that re-render
  hot; `useMemo`/`useCallback` to stabilise deps that drive effects or memoised
  children — not sprinkled everywhere.
- Avoid inline object/array/function props to memoised children.
- Large lists (e.g. player search over tens of thousands) MUST virtualise or
  paginate — never render all rows. See
  [`PERFORMANCE_STANDARD.md`](./PERFORMANCE_STANDARD.md).
- Animation (framer-motion) MUST not run layout-thrashing effects during a live
  round; keep the timer/scoring path cheap.

## 5. Rendering & anti-patterns (MUST NOT)

- MUST NOT cause **infinite re-render** loops: no `setState` in render, no effect
  whose dependency it unconditionally updates.
- MUST NOT leak: no subscription/timer without cleanup; no state set after unmount.
- MUST NOT fetch in `shared/ui/`; MUST NOT read the whole store; MUST NOT use
  array index as a key for reorderable lists.
- MUST NOT block the main thread with heavy sync work in an event handler during
  a round.

## 6. Error boundaries & loading/empty/error states

- The app MUST have a top-level **Error Boundary** (in `app/`) that catches render
  errors and shows a recoverable fallback — never a white screen inside Telegram.
- Every async view MUST render four states explicitly: **loading**, **error**,
  **empty**, **success**. "No cards" is surfaced only after retries (see
  `cardRandomizer.ts`), never as a flash.

## 7. Accessibility (baseline; full rules in the testing/a11y sections)

- Interactive elements are real buttons/links or have correct `role` + keyboard
  handlers. Tap targets ≥ 44px (mobile).
- Images/avatars have `alt`; icon-only controls have `aria-label`.
- Respect `prefers-reduced-motion` for framer-motion animations.
- RTL layout must work for `ar` locale.

## 8. Testing components (summary)

Component tests (Vitest + Testing Library) MUST cover render, loading, error,
empty, success, primary interaction (click/keyboard), and an a11y assertion
(`axe`). Details in [`TESTING_STANDARD.md`](./TESTING_STANDARD.md).

## 9. Review checklist (React)

- [ ] Dumb components stay dumb; logic is in hooks.
- [ ] Selectors are narrow; no whole-store reads.
- [ ] Effects have correct deps and cleanups; no leaks, no loops.
- [ ] Phase changes go through the state machine.
- [ ] Loading/error/empty/success all handled; Error Boundary covers the tree.
- [ ] Any memoisation is justified by a measurement.
