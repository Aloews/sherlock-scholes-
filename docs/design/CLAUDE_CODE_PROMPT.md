Implement the design in `design_handoff_collection_and_rarity/README.md` (in this repo checkout) directly in the codebase. Read that README fully first — it is the spec. Do not copy the bundled `reference-prototype.dc.html` or its inline styles as code; it is a visual reference only. Use the screenshots in `screenshots/` for visual ground truth.

Repo: Aloews/sherlock-scholes- (React + TypeScript + Vite + Tailwind + Zustand + Supabase + react-router-dom + framer-motion + @tabler/icons-react + react-i18next).

Do these steps, in order, editing existing files in place and following existing conventions exactly (naming, formatting, i18n key style, Tailwind class patterns, Zustand slice shape):

1. **Rarity tier**: in `src/shared/types/database.ts`, add `'icon'` to the `Tier` union and to the front of `TIERS`. Add `TIER_COLOR.icon = '#F4EEE6'` and `TIER_LABEL_RU.icon = 'Икона'`. Create a new `TIER_LABEL_EN` record (mirroring `CATEGORY_LABEL_EN`'s pattern) with English labels for all five tiers.
2. **Tier styling**: in `src/shared/lib/tier.ts`, extend `tierCardStyle` and `tierRingStyle` so `'icon'` gets the strongest glow (near-white), per the README's Design Tokens section. Keep the existing `common`/unknown → `undefined` short-circuit unchanged.
3. **Shared category icon**: extract `CategoryIcon` and `CATEGORY_COLOR` out of `src/shared/ui/PlayerCard.tsx` into a new `src/shared/ui/CategoryIcon.tsx`, export both, and update `PlayerCard.tsx` to import from there instead of defining them locally. No visual change to `PlayerCard`.
4. **i18n**: add a `collection` key section to both `src/shared/i18n/locales/ru.json` and the English locale file, with keys for the screen title, search placeholder, empty-search heading/body, error heading, and retry button label — follow the existing nesting/naming style in those files exactly.
5. **New screen**: create `src/screens/CollectionScreen.tsx` implementing the Collection screen exactly as specified in the README (layout, search, category filter pills, grid, loading/empty/error states) for the **v1 data-model** (whole active catalog, no per-user lock/unlock — skip the v2 migration entirely, but leave a short `// TODO(collection-v2):` comment where the locked/unlocked branch would later plug in). Fetch via the existing `src/shared/lib/supabase.ts` client. Match `src/screens/TrainingScreen.tsx` for the screen shell/safe-area/layout conventions.
6. **Routing**: in `src/app/Router.tsx`, lazy-load `CollectionScreen` the same way as `TrainingScreen` and add a `/collection` route (not wrapped in `RequireRoom`).
7. **Entry point**: in `src/screens/HomeScreen.tsx`, add a button/nav affordance to `/collection`, matching the visual style and placement conventions of Home's existing buttons (see README's Screens section for suggested framing, but follow whatever Home's actual button component/pattern already is).
8. Run the project's existing lint/typecheck (`tsconfig.json`/CI config in `.github/workflows/ci.yml` shows the commands) and fix any errors before finishing.

After implementing, list every file you changed or created and give a one-paragraph summary of any deviations from the README and why.
