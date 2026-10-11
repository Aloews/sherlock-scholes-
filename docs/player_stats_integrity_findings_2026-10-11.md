# Player statistics integrity — read-only snapshot

**Snapshot date:** 2026-10-11  
**Environment:** production Supabase, SELECT-only checks. No production rows or functions were changed during this audit.  
**Scope:** all active player-category cards, cache windows (7/30/365 days), recent player-match rows, identity metadata, and U23 coverage.

## Findings

### 1. Rating cache is materially out of sync

A comparison of `player_rating_cache` against `player_match_days`, using only dates from the rolling window through today (future fixtures excluded), found:

| Window | Live players with no cache row | Cached rows with no live scoring row | Rows with different values |
|---|---:|---:|---:|
| 7 days | 242 | 1,002 | 55 |
| 30 days | 646 | 1,619 | 1,747 |
| 365 days | 1,186 | 33 | 3,896 |

These are player-card/window keys, not unique people. The already-prepared PR fixes the per-card fallback and cache refresh guard; the new change also excludes future-dated fixture rows from both cache refresh and live fallback. A cache refresh has **not** been run against production.

### 2. Coverage gaps affect notable and young cards

- Active player-category cards: **25,508**.
- `fame >= 70` cards without a match-day row in the last 30 days: **883 of 1,656**.
- Cards with market value at least €10m and no match-day row in the last 30 days: **237 of 1,189**.
- Cards aged 23 or younger with no match-day row in the last 30 days: **6,602 of 9,378**.

These counts identify review queues, not confirmed missing-match defects. The `active` and `player` fields also cover historical/legacy cards and may include players outside currently covered competitions. Coverage must be assessed against competition, club, status and source before deactivating or merging any card.

### 3. Source freshness is a separate risk

The latest ingested rows at audit time were timestamped **2026-10-10 12:28 UTC** for ESPN and **2026-10-10 12:27 UTC** for sports.ru. The latest ESPN match date was 10 October. This means post-ingestion fixtures/results need a fresh scrape before the current-day leaderboard can be considered complete.

The sports.ru source also contained **18 future fixture rows** dated 21–22 October, fetched in September. They had no goals or assists, but can still inflate appearance counts unless future dates are filtered out.

### 4. Young-player leaders need competition-aware review

The recent U23 list includes domestic league/cup matches and U21 international qualifiers in the same aggregate. For example, Mathys Tel's 30-day total includes France U21 qualifying matches as well as Tottenham matches. That can be useful for an all-competition form view, but it must not be described as a club-only or senior-league ranking.

Some recent goal-contribution rows have unknown/zero minutes. ESPN's `minutes = NULL` is documented as unknown, not zero playing time; it should remain distinct from an explicit zero in data quality reports. A small number of sports.ru contribution rows have explicit zero minutes and require source-level review.

### 5. Identity collisions

The active-card scan found **no duplicate Transfermarkt IDs**. The normalized-name scan found **298 name groups with 321 additional cards**. Similar names are not sufficient evidence for merging: real namesakes and transliteration variants coexist. The audit SQL provides card IDs, names and external IDs for manual review.

## Work prepared in the PR

- Exclude future fixtures from `refresh_player_rating_cache()` and `player_ratings()` live fallback.
- Extend the rollback-only SQL regression test so a future fixture cannot inflate matches/minutes.
- Add `docs/player_stats_integrity_audit.sql`, a read-only query pack for cache drift, all-age recent leaders, U23 leaders, identity collisions, missing identity/club metadata, suspicious contribution rows and source freshness.

## Recommended order of remediation

1. Run and pass the SQL regression test in a disposable/staging database.
2. Review CI and merge the PR only after the SQL changes are validated.
3. Apply the migration through the normal deployment path, then explicitly refresh the production cache and compare all three windows.
4. Fix source freshness/failed scheduled ingestion, then re-run the audit.
5. Resolve high-priority identity and club cases using external IDs and match/team evidence; do not auto-merge by name.
6. Decide whether the displayed form rating should include youth internationals and friendlies. If not, add an explicit competition scope rather than silently dropping rows.

## Reproducibility

Run the SELECT-only checks in `docs/player_stats_integrity_audit.sql`. The SQL regression test is separate and intentionally performs fixture writes inside a transaction, so it must only run on a disposable/test database.
