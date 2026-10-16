# Player profile data gap report — 2026-10-16

Source: read-only queries against the connected production Supabase database. Counts describe stored fields and rows; they do not prove that a portrait URL resolves or depicts the correct person.

## Coverage

| Measure | Count |
|---|---:|
| Active player cards | 25,508 |
| Cards with a non-empty photo URL | 14,063 |
| Cards without a photo URL | 11,445 |
| Missing-photo cards with Transfermarkt ID | 11,351 |
| Missing-photo cards with Wikidata QID | 6,310 |
| Missing-photo cards without either source ID | 84 |
| Players with at least one seasonal-stat row | 12,356 |
| Rows in `player_season_stat` | 201,451 |
| Active players with a Transfermarkt ID but no seasonal-stat row | 12,274 |
| Players with at least one match-stat row | 14,380 |
| Active players with no match-stat rows | 11,128 |
| Rows in `player_match_stats` | 236,168 |
| Players with non-empty `career_stats` | 3,625 |

The Transfermarkt and Wikidata counts overlap and must not be summed. The 84 missing-photo cards without either identifier need identity resolution rather than blind name matching.

## Quality findings

- 21 match-stat rows have a date after the current database date; 18 are future placeholder rows with zero scores, goals and assists. They remain in the database and should be reviewed separately rather than deleted as part of enrichment.
- 50,183 match-stat rows have null minutes and zero goals, assists, yellow cards and red cards. Some may be legitimate non-appearances; validate against the source and fixture before changing data.
- 12 match-stat rows predate 2000. They may be valid historical matches; inspect source and identity rather than deleting them.
- Seasonal-stat coverage is not equivalent to complete season history; it only confirms that at least one row exists for a player.

## Queue state

| Task type | Status | Jobs |
|---|---|---:|
| `photo_tm` | `pending` | 5 |
| `photo_tm` | `no_data` | 47 |

No worker run has been verified against a live source with read-after-write confirmation. The production database currently has the core profile-backfill queue and its enqueue-starvation fix, but the `photo_sw` task-type migration `20261015203000_add_soccerwiki_photo_backfill.sql` is not recorded as applied. Consequently, the Soccer Wiki photo-fallback path must not be treated as active in production yet.

## Next priorities

1. Verify the bounded worker's source fetch, write, and read-after-write behavior before starting a larger batch.
2. Apply the Soccer Wiki photo-fallback migration only after its schema compatibility and queue constraint are confirmed.
3. Continue prioritizing missing portraits without overwriting existing values or accepting placeholders.
4. Enrich seasonal statistics for players with a Transfermarkt ID and no season rows.
5. Keep match-stat cleanup separate from profile enrichment; do not delete future or ambiguous rows without source-level validation.
6. Keep fine-tuning blocked until enough verified, chronological examples exist. No external provider job has been submitted.
