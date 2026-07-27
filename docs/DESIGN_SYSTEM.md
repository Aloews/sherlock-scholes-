# Design systems (switchable)

> **Scope note.** What ships today is a *token-level* switch: palette, type,
> button fill, backdrop and rarity glows. Screen **layouts** are shared by both
> designs and still follow the original structure — the reference prototype's
> app shell (bottom tab bar, its Home/Game/Results/dossier layouts) is not
> ported. See `docs/DESIGN_V2_HANDOFF.md` for the inventory of what's missing
> and the plan to finish it.

The app ships **two complete visual languages**, switched at runtime by the
palette button in the Home header. The choice is stored per device and
survives a reload.

| id | name | look |
|----|------|------|
| `master` *(default)* | «Новый дизайн» / "New design" | Sherlock Scholes master design system: gradient accent (`#FFE0C2 → #FF8A3D → #FF6300 → #C24A00`), Playfair Display headings, lit page background, uppercase CTAs, heavier rarity glows |
| `classic` | «Классический дизайн» / "Classic design" | the original shipped look: flat `#FF6300`, Inter everywhere, no page glow |

## How it works

1. **Tokens are CSS variables.** `src/index.css` defines two full token sets —
   `:root, [data-design='classic']` and `[data-design='master']`. Colours are
   stored as raw `R G B` channels, not hex.
2. **Tailwind resolves through them.** `tailwind.config.ts` maps every
   `brand-*` colour to `rgb(var(--brand-…) / <alpha-value>)`, so all ~200
   existing `bg-brand-surface` / `text-brand-muted/70` usages retint on a
   switch, with opacity modifiers intact. No component knows a design
   system exists.
3. **Switching is one attribute.** `applyDesign()` sets
   `<html data-design="…">` (`src/shared/design/designs.ts`). `useDesignSync()`
   in `App.tsx` keeps it on the persisted value; an inline script in
   `index.html` sets it before first paint so the other design never flashes.
4. **Persistence** lives in `settingsStore` (`sherlock_settings`, v5) — the
   same key the pre-paint script reads.

## Beyond colour

Things a variable can't express alone get a component class in `index.css`:

| class | what it does |
|-------|--------------|
| `.ds-screen` | page backdrop — the master radial glow, `none` in classic. Pair with `bg-brand-bg` on screen roots (they paint over `<body>`) |
| `.ds-display` | display face — Playfair Display in master, Inter in classic. Card names, screen headings, big numbers |
| `.ds-panel` | raised surface — flat in classic, warm-lit with depth in master |
| `.ds-btn-primary` | primary fill — solid accent in classic, brand gradient + uppercase tracking in master (drives `Button variant="primary"`) |
| `.ds-accent-text` | accent-filled text; in classic the "gradient" is a flat colour, so it renders plain orange |

Rarity frames (`src/shared/lib/tier.ts`) take the design as an argument: the
tier **colours** stay fixed (`TIER_COLOR`), only the ring width and glow
spread change. Components that render them call `useDesign()` and pass it, so
the frame restyles the instant the player flips designs.

## Adding a token

Add it to **both** blocks in `src/index.css`. If it's a colour meant to be
used through Tailwind, store `R G B` channels and expose it in
`tailwind.config.ts` via the `brand()` helper.

## What is *not* design-dependent

Card data colours stay fixed in both designs, because they encode meaning
rather than style: `CATEGORY_COLOR` (player orange, club blue, …),
`TIER_COLOR`, team colours (orange/blue), and status colours.
