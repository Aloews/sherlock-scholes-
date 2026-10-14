# Player profile data gap report — 2026-10-14

Source: read-only SQL queries against the connected Supabase project. Counts reflect database fields; they do not prove that an image URL resolves or depicts the correct person.

## Coverage

| Measure | Count |
|---|---:|
| Active player cards | 25,508 |
| Cards with a non-empty photo URL | 14,059 |
| Cards without a photo URL | 11,449 |
| Missing-photo cards with Transfermarkt ID | 11,355 |
| Missing-photo cards with Wikidata QID | 6,314 |
| Missing-photo cards without either source ID | 84 |
| Cards with at least one seasonal-stat row | 10,756 |
| Cards with no seasonal-stat rows | 14,752 |
| Missing-season cards with Transfermarkt ID | 13,874 |
| Cards with no match-stat rows | 11,229 |
| Cards with non-empty career_stats JSON | 3,625 |
| Rows in player_season_stat | 179,640 |
| Rows in player_match_stats | 230,170 |
| Distinct cards in player_match_stats | 14,279 |

Photo source coverage overlaps; the TM and QID counts must not be summed. The 84 cards without either identifier need identity resolution rather than blind name matching.

## Quality findings

- 18 match-stat rows are dated after the audit date; sample rows show scheduled future matches with all-zero event statistics. Exclude these from historical performance/training.
- 48,536 match-stat rows have null minutes and zero goals, assists, yellow cards and red cards. Some may be legitimate non-appearances; validate against source and fixture before changing data.
- 12 rows predate 2000. They may be valid historical matches; inspect source and identity rather than deleting them.
- No seasonal rows were found with a null card link where a matching Transfermarkt ID exists.

## Queue priorities

1. TM portraits for missing-photo cards with Transfermarkt IDs; never overwrite existing portraits and reject placeholders.
2. Wikidata P18/pageimage fallback for missing-photo cards with QIDs; a separate fallback task remains available if TM has no portrait.
3. Seasonal competition/club statistics for players with a Transfermarkt ID and no season rows.
4. Mark a task succeeded only after read-after-write verification. A clean source response with no usable record is no_data, not success; transport/parse failures are retryable.
5. Keep match-stat cleanup separate from enrichment.

## Status

The SQL report is read-only. The queue migration is not applied to production. The queue workflow is manual-only until migration approval and application. Fine-tuning remains blocked until enough verified chronological examples exist. No external provider job is submitted automatically.
