# Architecture Standard

> Part of the [Engineering Constitution](./ENGINEERING_CONSTITUTION.md). Rules
> for layers, dependencies, and code organisation. Prohibitions are **MUST NOT**.

## 1. The shape of the system

```
Telegram client
   │ initData (signed)
   ▼
React Mini App (src/)  ──PostgREST/RPC──►  Supabase (Postgres + RLS + Realtime + Edge)
   │                                             ▲
   └── offline: football_scraper/ (Python) ──────┘   (writes the deck; not shipped in the app)
```

There is **no custom backend service**. The client speaks to Supabase directly.
The security perimeter is therefore RLS + the `tg-pay` edge function + `initData`
verification — see [`SECURITY_STANDARD.md`](./SECURITY_STANDARD.md).

## 2. Feature-Sliced Design (FSD)

The frontend follows FSD. Layers, from lowest to highest:

```
src/
├── shared/     # framework-agnostic building blocks, no business logic
│   ├── ui/        # dumb presentational components (Button, Avatar, PlayerCard…)
│   ├── lib/       # pure helpers (tier, flag, countryName, telegram, device…)
│   ├── store/     # Zustand stores (game, auth, settings, pro)
│   ├── types/     # shared types (database, game)
│   ├── data/      # static data (quotes)
│   └── i18n/      # localisation (9 locales)
├── features/   # business capabilities (game, room, lobby, auth, pro, admin, reports)
├── screens/    # route-level pages composed from features + shared
└── app/        # Router, providers, app shell
```

### The dependency rule (MUST)

Imports may only point **downward** (higher layer → lower layer):

```
app → screens → features → shared
```

- `shared/**` **MUST NOT** import from `features/**`, `screens/**`, or `app/**`.
- `features/**` **MUST NOT** import from `screens/**` or `app/**`.
- A feature **MUST NOT** import another feature's internals. Cross-feature reuse
  goes through `shared`, or is lifted up to the composing `screen`.
- No import cycles anywhere. Enforced by `madge --circular` /
  `dependency-cruiser` in CI (see [`CI_CD_STANDARD.md`](./CI_CD_STANDARD.md)).

Use the `@/` alias (configured in `vite.config.ts` and `tsconfig.json`) for all
cross-directory imports; relative `../../..` chains that cross a layer are a
smell.

## 3. Where things go

| You are adding… | It belongs in… |
| --- | --- |
| A pure function with no React/Supabase | `shared/lib/` (+ a unit test) |
| A reusable dumb component | `shared/ui/` |
| Global/game state | `shared/store/` (Zustand + immer) |
| A user-facing capability (hooks + services) | `features/<name>/` |
| A route/page | `screens/` + a route in `app/Router.tsx` |
| A Supabase call | a `*Service`/`*Api` module inside the owning feature |
| A card-data rule | `football_scraper/` + a data-integrity test |

## 4. State management (Zustand)

- Stores live in `shared/store/`, created with `create()(immer(...))`.
- Components read **narrow selectors**, never the whole store, to avoid needless
  re-renders (see [`REACT_STANDARD.md`](./REACT_STANDARD.md) § performance).
- **Game phase is owned by the state machine.** Never call `setPhase` directly
  from a component or feature — go through `features/game/stateMachine.ts`
  (`transition`, `forceTransition`, `GameGuards`). This is the single point where
  legal transitions are enforced.
- Side effects (network, timers, realtime subscriptions) live in feature
  **hooks/services**, not in the store or in UI components.

## 5. Data flow

- **Reads:** feature hook → service → Supabase RPC/PostgREST → typed result →
  store/state → component.
- **Realtime:** subscriptions are owned by the room feature; every subscription
  MUST be cleaned up on unmount (no dangling channels — see the memory-leak
  checklist in [`CHECKLISTS/architecture-audit.md`](./CHECKLISTS/architecture-audit.md)).
- **Errors:** services return typed results/throw typed errors; hooks translate
  them into user-facing state; UI shows an explicit error state (never a blank
  screen). Graceful degradation (e.g. the RPC-parameter fallbacks in
  `cardRandomizer.ts`) is a first-class pattern, but MUST be covered by tests.

## 6. Conventions

- **Files:** components `PascalCase.tsx`; hooks `useXxx.ts`; services
  `xxx.service.ts` / `xxxApi.ts`; pure libs `camelCase.ts`.
- **One responsibility per module.** A file that mixes UI, data-fetching, and
  business rules must be split.
- **Comments explain _why_**, not _what_. The existing codebase has a high, useful
  comment density on non-obvious logic (see `cardRandomizer.ts`) — match it.
- **No dead code.** Unreferenced exports/files are removed, not commented out.
  `git` is the history.

## 7. Prohibitions (MUST NOT)

- MUST NOT mutate game phase outside the state machine.
- MUST NOT put business logic in `shared/ui/` components.
- MUST NOT import upward across layers or create import cycles.
- MUST NOT call Supabase from a UI component directly (go through a service).
- MUST NOT disable RLS, TypeScript strict, or a CI gate to make code pass.
- MUST NOT hardcode user-facing strings (use i18n) or secrets (use `.env`).
- MUST NOT introduce a second state-management or data-fetching paradigm without
  an ADR — one way to do a thing.

## 8. Adding a new module — checklist

1. Pick the correct layer (§ 3).
2. Define types first (`shared/types` or local), no `any`.
3. Keep pure logic pure and separately testable.
4. Add tests (unit + property/data-integrity as applicable) in the same PR.
5. Wire i18n keys for any text.
6. Update this document or add an ADR if you introduced a new pattern.
