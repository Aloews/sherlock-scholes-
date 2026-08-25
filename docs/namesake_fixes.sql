-- Namesake-collision remediation — the corrupted rows docs/cards_audit.py's
-- IMPOSSIBLE_AGE/ABSURD_BIRTH_YEAR detector found in #107 (24.08.2026 report)
-- but never applied. This is that cleanup.
--
-- One-time operational script, not a migration — same status as
-- docs/dups_exact.sql. APPLIED TO PROD 24.08.2026, verified by direct query
-- immediately after (see each block). Re-running is harmless: the UPDATEs
-- are idempotent (removing an already-absent jsonb key is a no-op) and the
-- DELETEs target rows that no longer exist after the first run.

-- ============ facts.birth_year contaminated by a namesake ============
-- Adam Smith the footballer's card carried the ECONOMIST's birth year
-- (1723). Only `facts.birth_year` was dirty — `position` stays, career_stats
-- was already null (never resolved).
UPDATE cards SET facts = facts - 'birth_year'
 WHERE id = '35612f9d-713b-44bd-a8b6-1b823284e82f';  -- «Адам Смит»

-- James Garner the Everton midfielder's card carried the ACTOR's birth year
-- (1928, "Maverick").
UPDATE cards SET facts = facts - 'birth_year'
 WHERE id = 'a81f5acd-42fa-4cd9-b672-2da0db0c401a';  -- «Джеймс Гарнер»

-- birth_year 1921 (105yo) on a card with a live 2026 match — IMPOSSIBLE_AGE,
-- not ABSURD_BIRTH_YEAR (1921 sits above the 1850 floor, but a match this
-- year rules out an early-20th-century birth all the same).
UPDATE cards SET facts = facts - 'birth_year'
 WHERE id = '91204aec-d38e-489e-8c65-a8c33bdbbd32';  -- «Николай Рассказов»

-- ============ Ronaldo (legend, b.1976, retired ~2011) ============
-- career_stats itself was fine (closed correctly on 2011) — the corruption
-- was in player_match_stats and sports_ru_player, from TWO independent
-- pipelines separately matching a currently-active same-named player onto
-- this card by name alone: sports_ru_player's slug pointed to an active FC
-- Rostov player (found in #107); ESPN's own name-based match separately
-- picked up a current Brazilian Serie A player. Both wrote real, recent
-- match rows under Ronaldo's card_id.
--
-- sports_ru_player: the structural fix is in sports_ru_stats.py
-- (active_cards_by_key) — a retired legend's bare-name card no longer enters
-- squad-page matching at all, so this mapping will not reappear. ESPN's own
-- name-based matcher (espn_stats.py — scraper/espn.py is pure parsing and
-- does no matching itself) now carries the same guard, added 24.08.2026: its
-- cards_by_key is built by the sibling active_cards_by_key in espn_stats.py,
-- so a bare-name legend with no card_current_club row is excluded there too.
DELETE FROM player_match_stats WHERE card_id = '1670defe-f8ff-4b96-8fa9-8064ca2c4c79';
DELETE FROM sports_ru_player   WHERE card_id = '1670defe-f8ff-4b96-8fa9-8064ca2c4c79';

-- Verified immediately after, on prod:
--   facts: {"position": "Защитник"} / {"clubs_count": 1, "position": "Защитник"} / {}
--   player_match_stats / sports_ru_player rows for Ronaldo's card_id: 0, 0
