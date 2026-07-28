# Design system

Two layers so far: the colours, and the controls. Both are real — every
screen can use them — but only the deck picker has been built on them yet.
Bringing the rest of the app over is the work that remains; see "What is
still missing".

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

## The controls

```
src/shared/ui/ScreenFrame.tsx   ScreenFrame · ScreenHeader · ScreenBody
                                StickyFooter · StepBar
src/shared/ui/OptionRow.tsx     one row = one choice
src/shared/ui/Chip.tsx          one chip = one toggle
src/shared/ui/SelectRow.tsx     a native <select> in OptionRow's clothes
src/shared/ui/Section.tsx       heading + hint + content
src/shared/ui/Button.tsx        the primary action
```

**The frame has three parts and only the middle one scrolls.** Header and
footer stay put, so the title and the primary action are always where the
player left them. The picker used to live inside HomeScreen's hero, which
is how its options ended up under the fold with the Play button below
them, off screen on a phone.

**A row that toggles ends in a check circle. A row that acts ends in a
chevron.** That check circle is the app's only "this is on" signal — if a
screen needs to show selection, it uses `OptionRow` or `Chip`, it does not
invent a fifth treatment. Before the picker rework there were four:
filled chips, outlined chips, bordered cards and bare selects.

**Chips tint, they don't fill.** A group with a dozen chips on by default
would otherwise be a block of orange, and the accent belongs to the
primary action alone.

**When to use which.** One choice with an explanation → `OptionRow`. Many
short choices → `Chip`. More options than fit on a screen → `SelectRow`.
A whole flow → the frame.

## What is still missing

* **The other screens.** 49 raw `<button>` against 20 `<Button>`, and the
  "surface card" pattern written out inline about 40 times. Next:
  `TrainingScreen` (26 hex literals and 13 raw buttons before the token
  pass, and the screen players spend almost all their time in), then
  `EndScreen`, `ProScreen`, lobby and game, tutorial; `AdminScreen` last,
  since only the owner sees it.
* **Type and spacing scales.** Sizes are still chosen per screen.
* **States other than "selected".** Loading, empty and error are still
  written by hand each time.
