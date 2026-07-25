# Performance Standard

> Part of the [Engineering Constitution](./ENGINEERING_CONSTITUTION.md). A Mini
> App runs on mid-range phones on mobile networks inside Telegram's webview.
> Performance is a feature.

## 1. Budgets (enforced)

| Budget | Limit | Target |
| --- | --- | --- |
| Initial JS (gzip) | ≤ 250 KB | ≤ 180 KB |
| Largest Contentful Paint (mobile, 4G) | ≤ 2.5 s | ≤ 1.8 s |
| Interaction to Next Paint | ≤ 200 ms | ≤ 100 ms |
| Cumulative Layout Shift | ≤ 0.1 | ≤ 0.05 |
| Round loop frame rate | 60 fps | 60 fps |
| Player-search response (local bench) | ≤ 100 ms @ 100k rows | ≤ 50 ms |

A PR that regresses a budget MUST justify it or fix it. Budgets are checked in CI
(Lighthouse CI + a bundle-size check).

## 2. Web Vitals

- Measure LCP, INP, CLS in the field (`@vercel/analytics` is already a dep) and
  in CI (Lighthouse). Track regressions per release.
- The **live round** path (timer tick, card advance, scoring, guess) is the
  hottest path — it MUST stay at 60fps and MUST NOT do layout-thrashing work per
  tick.

## 3. Bundle

- Route-level **code splitting** (`React.lazy` + Suspense) for heavy screens
  (Admin, Pro, Tutorial) so the game path stays small.
- Audit the bundle (`vite build` + a visualizer) before adding a heavy dep.
  Prefer a small focused lib over a large one; question every new dependency.
- Tree-shakeable imports only (`import { X } from 'lib'`, not the whole lib).
  `@tabler/icons-react` and `framer-motion` MUST be imported granularly.
- Images: preload player photos (`preloadPhotos.ts`), serve sized/optimised
  assets, lazy-load below the fold.

## 4. React runtime performance

See [`REACT_STANDARD.md`](./REACT_STANDARD.md) § 4. In short: narrow Zustand
selectors; memoise against a **measurement**; virtualise/paginate large lists;
no inline props to memoised children; keep effects cheap.

Profile with the **React Profiler** and Chrome performance panel; attach the
before/after to any perf PR.

## 5. Data & network

- Warm the free-tier DB (`wakeSupabase`) and retry with backoff — already the
  pattern; keep critical reads on it.
- Select only needed columns; paginate; keep hot queries index-backed
  (see [`SUPABASE_STANDARD.md`](./SUPABASE_STANDARD.md) § 4).
- Cache static content (deck, photos) and revalidate; don't refetch the deck per
  render.

## 6. Search at scale

Player search must stay fast as the deck grows to tens/hundreds of thousands:
trigram/index-backed queries, debounced input, server-side limit, virtualised
result list. **Benchmark locally** (seeded local Supabase or an in-memory index)
— never load-test the live free-tier DB (see the testing non-goals).

## 7. Prohibitions (MUST NOT)

- MUST NOT ship a bundle over budget without justification.
- MUST NOT do heavy sync work on the round-loop path.
- MUST NOT render unbounded lists.
- MUST NOT add a heavy dependency without a bundle-impact note.
- MUST NOT micro-optimise without a measurement (premature optimisation is a
  smell too).
