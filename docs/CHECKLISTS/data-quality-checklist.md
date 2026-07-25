# Data Quality Checklist

Run on any change to `sherlock_cards.csv`, the Supabase `cards` table, or
`football_scraper/`. Pairs with [`DATA_QUALITY_STANDARD.md`](../DATA_QUALITY_STANDARD.md).

## Structure
- [ ] CSV parses with a strict reader; every row has 5 columns; header intact.

## Per-row invariants
- [ ] `category` ∈ `ALL_CATEGORIES`.
- [ ] `difficulty` ∈ `{easy,medium,hard}` and not degenerate.
- [ ] `forbidden_words` non-empty, pipe-delimited, contains `name`, no empty
      tokens.
- [ ] No junk/placeholder names.
- [ ] No byte-identical duplicate rows.

## Football correctness
- [ ] No duplicate player by `canonical_key` (or across categories).
- [ ] Position/country/appearance facts self-consistent and match the
      methodology doc.
- [ ] Difficulty consistent with pageview thresholds (novice > 19000, fan > 3000).

## Pipeline (scraper)
- [ ] Source records validated; malformed records don't become cards.
- [ ] Names normalised (`normalize_display_name`); `name_ru`/`name_en` correct.
- [ ] Fuzzy dedup run; near-matches (< 1.00) reviewed, never auto-merged.
- [ ] Preview before any live write.

## Defects
- [ ] `npm test` data-integrity suite passes.
- [ ] Any new inaccuracy is **locked with a failing test** (`it.fails`), not
      edited away silently.
- [ ] Progress on open locks (D1 difficulty, D2 dup player) noted if touched.
