# Player profile data gap report

Snapshot taken 14 October 2026 from the connected Supabase project using read-only SQL. This report describes field coverage, not successful HTTP retrieval or visual identity validation.

## Coverage

| Metric | Count |
|---|---:|
| Active player cards | 25,508 |
| Cards with a non-empty photo URL | 14,059 (55.1%) |
| Cards without a photo URL | 11,449 (44.9%) |
| Missing photo, Transfermarkt ID present | 11,355 |
| Missing photo, Wikidata QID present | 6,314 |
| Missing photo, neither external ID present | 84 |
| Cards with at least one season-stat row | 10,756 (42.2%) |
| Cards without any season-stat row | 14,752 (57.8%) |
| Season-stat rows | 179,640 |
| Cards with at least one player-match-stat row | 14,279 (56.0%) |
| Cards with non-empty career_stats JSON | 3,625 (14.2%) |

The photo-source and identifier counts overlap: a card may have both a Transfermarkt ID and a Wikidata QID. They must not be added together.

## Gaps by market-value band

| Market value | Players | Missing photo | Missing season stats |
|---|---:|---:|---:|
| €10m+ | 1,189 | 65 | 1 |
| €1m–€10m | 5,374 | 1,398 | 0 |
| €100k–€1m | 12,236 | 6,126 | 8,042 |
| Under €100k | 1,916 | 1,233 | 1,916 |
| Unvalued | 4,793 | 2,627 | 4,793 |

Season-stat gaps are concentrated among lower-value and unvalued players. The existing collector must keep unvalued players eligible; the queue prioritizes by market value but does not exclude them.

## Data-quality flags

- 230,170 player-match-stat rows were observed in the previous audit.
- 48,536 rows had null/zero values across minutes, goals, assists and card counts. This is a review flag, not proof that every row is wrong.
- 18 match-stat rows were dated after the audit date; 12 were dated before 2000 in the previous snapshot. Future fixtures must not be treated as completed player performances.
- 179,640 season-stat rows have non-null minutes, goals and assists fields; non-null does not mean a value is non-zero or that every competition/season is covered.
- No missing Wikimedia Commons photo-credit row was found in the targeted audit query. This does not verify licenses for sources other than Wikimedia.

## Collection and verification policy

1. Queue a separate idempotent task per card and data source.
2. Distinguish network/provider failure (retryable) from a successful response with no usable record (no_data).
3. Never overwrite a non-empty photo URL during backfill.
4. Mark a write succeeded only after reading the persisted field/rows back from Supabase.
5. Keep attempts, result counts, source, last error and timestamps for every task.
6. Re-audit after each batch; do not report a batch as complete solely because the scraper process exited with code zero.

## Reproduce the audit

With read access to the project's Supabase REST API:

    python docs/player_data_audit.py --output-dir artifacts/player-data-audit

The full audit scans the match-stat table and can take time. For a quicker profile/season coverage report:

    python docs/player_data_audit.py --skip-match-scan --output-dir artifacts/player-data-audit

The script is read-only. It writes a JSON summary and a CSV with one row per active player card.
