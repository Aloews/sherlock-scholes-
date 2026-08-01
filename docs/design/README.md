# Handoff: Collection Screen + Icon Rarity Tier

## Overview
Adds two things to the shipped Sherlock Scholes Telegram Mini App (repo `Aloews/sherlock-scholes-`):
1. A new **Collection** screen — browse the full card catalog, filter by category, search by name, see rarity tier, see an empty-search state.
2. A 5th rarity tier, **Icon**, above `legendary`, for the game's most iconic cards.

## About the design files
The bundled HTML (`reference-prototype.dc.html`) is a **design reference**, not production code — a static/interactive mock built outside your stack. Recreate its look and behavior using the repo's existing React + TypeScript + Tailwind + Zustand + Supabase patterns (see Files below for the exact existing files to extend), not by embedding or copying the HTML.

## Fidelity
**High-fidelity.** Colors, radii, type, and spacing below are exact — taken from the repo's own `tailwind.config.ts` / `src/index.css` tokens, not invented. Match them exactly; where the reference HTML's inline styles disagree with the repo's real tokens, **the repo's tokens win**.

## ⚠ Data-model decision needed before building Collection
The current schema (`src/shared/types/database.ts`, `supabase/schema.sql`) has a global `cards` table but **no concept of a per-player unlocked/collected card**. Before implementing, pick one:
- **v1 (recommended, no migration):** Collection shows the *entire active card catalog* (`cards` where `active = true`), always "unlocked" — no lock icon, no per-user state. Search/filter/tiers still fully apply.
- **v2 (needs migration):** Add a `player_cards (player_id, card_id, unlocked_at)` table, populate it from `round_cards` where `status = 'correct'` (a card the player has successfully explained/guessed becomes "collected"), and gate the grid on it (locked cards shown greyed with a lock icon and `???` name, matching `mode="hidden"` treatment in `PlayerCard.tsx`).

This README assumes **v1** for the initial cut, with v2 called out as a fast-follow (its grid/empty-state code is identical either way — only the locked/unlocked source of truth changes).

## Screens / Views

### Collection (`/collection`)
**Purpose:** browse and search the card catalog; entry point from `HomeScreen` (add a nav item / button consistent with existing Home affordances — see `HomeScreen.tsx` for the existing button patterns to copy, e.g. its `Играть`/mode buttons).

**Layout:**
- Full-height screen, same shell as `TrainingScreen`/`LobbyScreen` (header + scrollable body), `max-w-sm mx-auto`, safe-area padding top/bottom per existing screens.
- Header: `Playfair Display` 700 20px "Коллекция" (ru) / "Collection" (en, via `react-i18next` — add `collection.*` keys to `src/shared/i18n/locales/ru.json` and `en.json`).
- Search input: full-width, 44px tall, `rounded-2xl`, `bg-brand-surface`, `border border-brand-border`, left-aligned magnifier icon (`IconSearch` from `@tabler/icons-react`, size 16, `text-brand-muted`), placeholder `"Ищи улики среди легенд…"`. On focus, border → `border-brand-accent` (matches existing input focus rule).
- Category filter row: horizontal scroll of pill buttons, one per `CardCategory` (`ALL_CATEGORIES` from `database.ts`) plus an "Все"/"All" pill. Active pill: `bg-brand-accent/10 border border-brand-accent/50 text-brand-accent`; inactive: `bg-transparent border border-brand-border text-brand-muted`. `rounded-full`, `text-[11.5px] font-semibold`, `gap-1.5` icon+label (reuse `CategoryIcon` already exported conceptually inside `PlayerCard.tsx` — extract it to a shared `CategoryIcon.tsx` in `src/shared/ui/` so both `PlayerCard` and the new filter row import the same component instead of duplicating the category→icon map).
- Grid: `grid grid-cols-2 gap-3`. Each cell is a compact card: `rounded-2xl bg-brand-surface border border-brand-border`, tier-styled border/glow via `tierCardStyle(card.tier)` (already exists in `tier.ts` — just reuse it), min-height ~150px, centered category icon, card name (`Playfair Display` 13px 700, 2-line clamp), tier label beneath in `TIER_COLOR[tier]` at 9px uppercase wide-tracking (`TIER_LABEL_RU`/new `TIER_LABEL_EN` map — the latter doesn't exist yet, add it next to `TIER_LABEL_RU`).
- **Empty-search state:** when the filtered+searched result set is empty, replace the grid with a centered block: search-off icon (`IconSearchOff`, 34px, `text-brand-muted`), heading "Улики не найдены" / "No clues found" (`Playfair Display` 16px), one line of muted 12px body copy suggesting a different query/category. No grid, no skeleton — just this block.
- **Loading state:** while the initial `cards` fetch is in flight, render 10 skeleton cells (same grid geometry) with `animate-pulse bg-brand-border/40 rounded-2xl` — no text/icon.
- **Error state:** if the fetch throws, replace the grid with the same empty-state layout but `IconAlertTriangle` (danger color `#EF4444`), heading "Не удалось загрузить карты" / "Couldn't load cards", and a retry button (reuse the existing `Button` component from `src/shared/ui/Button.tsx`, secondary variant).

## Interactions & Behavior
- Typing in search filters client-side over the already-fetched card list (debounce not required unless the catalog is large — if `cards` count is in the thousands, prefer a Postgres `ilike` query via Supabase on keystroke with a 250ms debounce instead of client filtering).
- Tapping a category pill sets `catFilter` state and re-filters instantly (no fetch needed if already loaded).
- Tapping an unlocked card navigates to a card detail view — reuse `PlayerCard` in a modal/sheet or push a `/collection/:cardId` route; minimum viable: open the same `PlayerCard` component (mode="explainer") in a `Dialog`/bottom-sheet pattern if one exists in the codebase, otherwise a simple centered modal with a backdrop (`bg-black/60 backdrop-blur-sm` per the repo's existing overlay convention noted in the design system — countdown/round-summary screens use this same treatment).
- Tapping a locked card (v2 only) does nothing / shows a toast "Собери эту карту в игре, чтобы открыть" — no navigation.
- All buttons: `whileTap={{ scale: 0.94 }}` via `framer-motion`, consistent with every other button in the app.

## State Management
- New local state in `CollectionScreen.tsx`: `cards: Card[]`, `loading: boolean`, `error: string | null`, `catFilter: CardCategory | 'all'`, `searchQuery: string`.
- Fetch on mount: `supabase.from('cards').select('*').eq('active', true)` (add `.order('pageviews', {ascending:false, nullsLast:true})` for a sensible default order). Use the existing `src/shared/lib/supabase.ts` client — don't create a new one.
- No global store changes needed for v1. For v2, add `unlockedCardIds: Set<string>` either to a new `useCollection` hook (`src/features/collection/useCollection.ts`, mirroring the existing `useGame.ts`/`useTraining.ts` hook pattern) or a new Zustand slice if the set needs to persist across screens.

## Design Tokens (exact repo values — do not invent new ones)
- Background: `#0A0E1A` · Surface: `#13182A` · Border: `#1F2740` · Muted text: `#7A8499` · Primary text: `#FFFFFF`
- Accent (brand-accent): `#FF6300`
- Category colors: player `#FF6300`, club/club_nickname `#4A9EFF`, stadium `#00C97D`, term/position `#B47AFF`, referee/coach `#FFD24A`, commentator `#7A8499`, woman `#FF6BA8`, derby `#F43F5E`, trophy `#FFD24A`, era `#22D3EE`
- Tier colors (existing, `TIER_COLOR` in `database.ts`): legendary `#FFD24A`, epic `#B47AFF`, rare `#4A9EFF`, common `#7A8499`
- **New tier — Icon:** add to `Tier` union and `TIERS` array in `database.ts`, ordered above legendary: `export type Tier = 'icon' | 'legendary' | 'epic' | 'rare' | 'common';` `TIER_COLOR.icon = '#F4EEE6'` (near-white). `TIER_LABEL_RU.icon = 'Икона'`. Add matching `TIER_LABEL_EN.icon = 'Icon'` (create this map, English labels don't exist yet — reuse `CATEGORY_LABEL_EN` as the pattern).
- **Icon tier glow** — extend `tierCardStyle`/`tierRingStyle` in `tier.ts`: icon tier gets the strongest, whitest glow, e.g. `boxShadow: inset 0 0 0 2px #F4EEE6, 0 0 24px rgba(244,238,230,.35)` (vs. legendary's `0 0 18px ${c}66`) — keep the function's existing early-return-for-common behavior unchanged.
- Radius: `rounded-2xl` = 16px (cards/buttons/inputs), `rounded-xl` = 12px (chips), `rounded-full` (pills/avatars/dots)
- Spacing: 4px base — 16–20px card padding, 12px stacked-control gaps (Tailwind default scale, no new values)
- Type: Inter 400–900 for UI, Playfair Display 500–900 for names/headings/display numbers
- Motion: tap scale 0.94 (0.1s), fade-in 0.2s, slide-up 0.3s ease-out — all via existing `framer-motion` usage, no new easing curves

## Assets
No new image assets. Icons are all `@tabler/icons-react` (already a dependency) — outline style, stroke-width 1.5–1.75, matching every other icon in the app. New icons needed: `IconSearch`, `IconSearchOff`, `IconAlertTriangle` (all exist in the Tabler set already used elsewhere in the repo).

## Screenshots
`screenshots/01-flow.png`–`04-flow.png`: Home → Collection grid (Icon tier visible on Messi) → search-in-progress → Messi dossier (Icon-tier frame, white/prismatic glow).

## Files
- Reference prototype (this conversation's mock): `reference-prototype.dc.html` in this folder — Collection tab + empty-search state + Icon-tier card (Messi) live in its `isCollections` section and `RAR.icon` entry. Note: this copy references project-root assets (`support.js`, `image-slot.js`, `assets/logo-orange-square.jpg`) that aren't bundled alongside it — open it from the original project to view live, or treat the screenshots as the visual reference.
- Real repo files to **read before changing anything** (ground truth for conventions):
  - `src/shared/types/database.ts` — extend `Tier`/`TIERS`/`TIER_COLOR`/`TIER_LABEL_RU`, add `TIER_LABEL_EN`
  - `src/shared/lib/tier.ts` — extend `tierCardStyle`/`tierRingStyle` for the `icon` case
  - `src/shared/ui/PlayerCard.tsx` — extract `CategoryIcon`/`CATEGORY_COLOR` to a shared module; reuse `tierCardStyle`
  - `src/app/Router.tsx` — add the `/collection` route (lazy-loaded like `TrainingScreen`, not eager like `HomeScreen`)
  - `src/screens/TrainingScreen.tsx` — closest existing screen for layout/shell conventions to copy
  - `src/shared/lib/supabase.ts` — the Supabase client to reuse for the catalog fetch
  - `src/shared/i18n/locales/ru.json` / `en.json` — add `collection.*` copy keys here, follow existing key naming
  - `src/shared/ui/Button.tsx` — reuse for the error-state retry button
