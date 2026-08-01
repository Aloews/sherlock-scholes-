# Data Quality Standard

> Part of the [Engineering Constitution](./ENGINEERING_CONSTITUTION.md). The card
> deck is **production content** — a wrong card is seen by every player. It gets
> the same rigour as code. Related: `sherlock_cards.csv`, `football_scraper/`,
> `test/data-integrity/`, `football_scraper/CONTEXT.md`,
> `docs/players-db-methodology.md`.

## 1. Principle

Data is code's equal. Every row in the deck MUST satisfy invariants that are
**tested in CI**. A deck change that fails the data-integrity suite does not
merge. Found defects are handled **regression-first**, exactly like code bugs.

## 2. The deck schema

`sherlock_cards.csv`: `category, category_ru, name, difficulty, forbidden_words`.
Supabase `cards` mirrors this plus enrichment (`pageviews`, `tier`, `continent`,
`name_en`, `tags`, `photo_url`, …).

## 3. Invariants (enforced by `test/data-integrity/`)

Structural:
- Parses with a strict CSV reader — no unterminated quotes, no ragged rows, every
  row has exactly 5 columns.
- Header is exactly the 5 expected columns.

Per row:
- `category` ∈ the known set and matches `ALL_CATEGORIES` in
  `src/shared/types/database.ts` (`player, club, club_nickname, coach,
  commentator, position, referee, stadium, term, woman, derby, trophy, era`).
- `difficulty` ∈ `{easy, medium, hard}` **and** the distribution is not
  degenerate (see § 5, defect D1).
- `forbidden_words` is non-empty, pipe-delimited, contains the `name`, has no
  empty tokens.
- No junk/placeholder cards (names containing meta words like *дубликат,
  вставляю, неполн, заглушк, placeholder*).
- No byte-for-byte duplicate rows.

Football correctness (grow these — this is where the "many inaccuracies" live):
- A player appears **once** — no same person under two spellings
  (`canonical_key`, see § 4) or two categories (see defect D2).
- Career/nationality plausibility: `position` from a valid set; country valid;
  claimed appearances (clubs, national team, "played at World Cup") not
  self-contradictory. Cross-check against `docs/players-db-methodology.md`.
- Difficulty is consistent with fame: pageview thresholds from `CONTEXT.md`
  (novice > 19000, fan > 3000) map to the difficulty tiers.

## 4. Deduplication (MUST)

- The canonical identity of a player is `scraper/dedup.canonical_key(name)` —
  alphabet-, case-, spacing-, punctuation- and word-order-invariant. Two rows
  with the same key are the same person.
- Insertion into the deck MUST run the fuzzy dedup (`find_duplicate_pairs`);
  exact-key collisions are rejected, near matches (< 1.00) are reviewed by a
  human, **never auto-merged** (different people can be close).
- `canonical_key` is guarded by property tests
  (`football_scraper/tests/test_property_canonical.py`). Changing it requires
  re-running dedup over the whole deck.

## 5. Source validation

Data enters via `football_scraper` (API-Football, Wikidata, Wikipedia
pageviews). The pipeline MUST:
- validate every source record's shape (missing/renamed fields don't silently
  become cards);
- localise names correctly (`name_ru`/`name_en`), applying `normalize_display_name`
  ("Surname, Given" → "Given Surname", drop patronymics/parentheticals);
- never write a card that fails the § 3 invariants;
- keep decisions reproducible (preview scripts before a live write — the
  `docs/*_preview.py` pattern).

## 6. Known defects (locked, must be driven to zero)

Tracked as `it.fails()` locks in `test/data-integrity/cards.test.ts` — each
asserts the defect still exists and flips to failing (demanding a fix) once the
data is corrected. **Do not delete a lock; fix the data and convert it to a
normal assertion.**

| ID | Defect | Fix path |
| --- | --- | --- |
| D0 | Junk placeholder card leaked into the deck | **Fixed** (row removed; regression test in place) |
| D1 | `difficulty` degenerate — every card is `medium`; the difficulty system is dead in shipped data | Regenerate difficulty from `pageviews` per `CONTEXT.md` thresholds; then convert the lock |
| D2 | A player duplicated across categories (e.g. Владимир Маслаченко: player + commentator) | Product decision on canonical category; dedup pass; convert the lock |

Add a lock (or an issue) for every new inaccuracy found — never fix data silently
without a test that pins it.

## 7. Search quality

Player search MUST tolerate: typos (fuzzy/trigram), transliteration (Latin↔
Cyrillic), diacritics, and multiple input languages, and MUST stay index-backed
and fast at tens–hundreds of thousands of players (bench locally, never against
live free-tier Supabase). See [`PERFORMANCE_STANDARD.md`](./PERFORMANCE_STANDARD.md).

## 8. Prohibitions (MUST NOT)

- MUST NOT ship a deck change without passing the data-integrity suite.
- MUST NOT auto-merge fuzzy-duplicate players below ratio 1.00.
- MUST NOT fix a data defect without a test that locks it.
- MUST NOT run load/fuzz data collection against the live free-tier APIs (rate
  limits; see the testing non-goals).
