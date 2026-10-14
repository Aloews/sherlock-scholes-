# Player data-gap baseline — 2026-10-14

Read-only snapshot of Supabase production data. No rows were inserted, updated or deleted by this audit.

## Coverage

| Metric | Count | Coverage / note |
|---|---:|---|
| Active player cards | 25,508 | Baseline |
| Photo URL present | 14,059 | 55.1% |
| Photo URL missing | 11,449 | 44.9% |
| Transfermarkt ID present | 24,630 | 96.6% |
| Wikidata QID present | 18,319 | 71.8% |
| Season-stat rows | 179,640 | All rows linked to a card |
| Players with at least one season-stat row | 10,756 | 42.2% |
| Players with no season-stat rows | 14,752 | 13,874 have Transfermarkt ID; 878 do not |
| Non-empty `career_stats` JSON | 3,625 | 14.2% |
| Match-stat rows | 230,170 | 14,279 distinct players |
| Match-stat rows dated in the future | 18 | Must not be treated as completed appearances |
| Match-stat rows with no minutes and zero goals/assists/cards | 48,536 | Needs source-level validation |

Latest recorded fetches:
- Season statistics: 2026-10-13 18:15:50 UTC
- Match statistics: 2026-10-13 13:58:53 UTC

## Photo source distribution

| Source | Cards |
|---|---:|
| Wikimedia Commons | 8,548 |
| Transfermarkt | 5,081 |
| Soccer Wiki | 429 |
| Local Wikipedia source | 1 |
| **Total with a URL** | **14,059** |

Of the 11,449 players missing a photo URL:
- 11,355 already have a Transfermarkt ID.
- 6,314 have a Wikidata QID.
- 6,371 have a linked `soccerwiki_player` row.

These groups overlap. The queue should route by available source identifiers and not add their counts together.

## Data integrity checks

- Season-stat rows with missing season/competition/club keys: **0**.
- Season-stat rows with negative appearances, minutes, goals or assists: **0**.
- Unlinked season-stat rows: **0**.
- Future-dated match rows: **18**.
- Match rows with all detail fields zero or missing: **48,536**.

The absence of negative values and missing season keys does not establish completeness. The next validation should compare per-player seasons with the provider response and verify photo URLs over HTTP with an image content type.

## Initial prioritization

1. **High-value photo gaps with provider IDs.** Examples from the current catalogue:
   - Саид Эль-Мала — Transfermarkt 1168219, €45m, Wikidata Q125549770.
   - Максимилиано Араухо — Transfermarkt 572675, €40m, Wikidata Q58011167.
   - Уэсли Франса — Transfermarkt 964580, €40m, Wikidata Q110882542.
   - Эстебан Леполь — Transfermarkt 461607, €35m, Wikidata Q124357777.
   - Джованни Леони — Transfermarkt 1086619, €25m, Wikidata Q126361834.
2. **Season-stat gaps with Transfermarkt IDs.** 13,874 players can be targeted directly by ID; prioritize high-value active players first, then process the rest in bounded batches.
3. **Identity gaps.** 878 players have no Transfermarkt ID and need alternate-source identity resolution before a season-stat request can be issued.
4. **Historical match data.** Quarantine the 18 future-dated records and inspect the 48,536 zero-detail records before training.
5. **Career summaries.** Build `career_stats` from verified season aggregates rather than treating the JSON field as the sole canonical source.

## Implementation status

The report generator and queue worker are in the draft PR. Queue writes require the new migration to be applied first. The worker marks a job successful only after reading the persisted row back and validating it; source timeouts are retried rather than classified as missing data. No backfill job has been run as part of this baseline audit.
