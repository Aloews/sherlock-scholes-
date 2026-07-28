# Design system — the colour layer

This is step one of a design system, and it is deliberately only the colour
layer: tokens and the rules for using them. The component vocabulary
(`OptionRow`, `PickChip`, `SelectRow`, the screen frame) still lives inside
`src/screens/DeckPickerScreen.tsx` and has not been extracted yet — see
"What is still missing" at the bottom.

## Where colours live

```
src/shared/ui/palette.ts   every colour value, once. No imports.
src/shared/ui/tokens.ts    the palette applied to product concepts
tailwind.config.ts         imports the palette → bg-brand-*, text-brand-*
```

`palette.ts` has no imports on purpose: `tailwind.config.ts` reads it, so
the utility classes and the inline styles that need a raw string (SVG
strokes, per-card accents, the Telegram chrome colour) come from the same
numbers.

## The rules

**1. No hex in a component.** Not in `style={{}}`, not in `text-[#FF6300]`.
If a screen needs a shade that is not in `palette.ts`, that is the signal
to reuse one that is. There are currently zero hex literals outside
`palette.ts`, and it is worth keeping that number at zero — it is easy to
check and it is what stops the drift.

**2. Ask for the meaning, not the hue.** `SUCCESS`, `WARNING`, `DANGER`,
`INFO`, `PRO` exist so a screen says what it means. Reach for `GREEN` only
when the greenness itself is the point (a category accent), never for "this
worked".

**3. Product concepts live in `tokens.ts`, not in the screen.**
`CATEGORY_COLOR`, `TIER_COLOR`, `TEAM_COLOR`, `FRAME_COLOR`,
`AVATAR_COLORS`. `CATEGORY_COLOR` used to exist twice — byte for byte in
`TrainingScreen` and `PlayerCard` — so one screen could start painting a
card differently from the other the moment a copy changed.

**4. One accent.** `ACCENT` (`#FF6300`) carries the primary action and
nothing else competes with it. The other hues exist to tell things apart —
categories, tiers, teams, avatars — not to decorate.

## What this replaced

~40 hex literals across 14 files, next to a token layer that already
existed and was being ignored. Two palettes had grown into each other: the
brand set plus eight Tailwind defaults, which produced a second green for
success (`#22c55e` beside `#00C97D`) and a second blue for a team
(`#3b82f6` beside `#4A9EFF`).

Three deliberate colour changes came out of the merge:

* avatars now use the brand hues instead of the Tailwind defaults;
* the lobby's "ready" tick uses the same green as every other success;
* the blue team is the same blue in the lobby and in the game.

Everything else is byte-identical — verified by screenshotting the app
before and after.

## What is still missing

* **The component vocabulary.** 49 raw `<button>` across the screens
  against 20 `<Button>`, and the "surface card" pattern
  (`bg-brand-surface` + `border-brand-border` + rounded) is written out
  inline about 40 times. That is the next step: lift the picker's
  vocabulary into `shared/ui` and apply it screen by screen, heaviest
  traffic first (`TrainingScreen`).
* **Type and spacing scales.** Sizes are still chosen per screen.
* **One "selected" state.** The picker has one; the rest of the app has
  not been brought onto it yet.
