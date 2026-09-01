-- ============================================================================
-- Rebuild the current squads on a schedule, instead of whenever someone
-- remembers.
--
-- `card_current_clubs` is a snapshot: which club each player had not left when
-- their article was last read (current_squads.sql). It was built once, by hand,
-- on 9 August 2026 — and the lobby and the deck picker both now offer "current
-- squad of X" as a filter, with an as-of date printed under it. A snapshot
-- nobody refreshes turns that date into a slowly growing lie, and the one thing
-- the squad feature promised was not to be one.
--
-- WHY 06:10 UTC AND NOT ANY OTHER HOUR. daily-enrich.yml runs at 05:00 and is
-- what re-reads the articles this reads back out; rebuilding before it would
-- snapshot yesterday's data every single day, which is the same staleness with
-- extra steps. An hour and ten minutes is the gap between "the enrichment is
-- normally finished" and "the European evening, when people play".
--
-- WHY pg_cron AND NOT ANOTHER GITHUB ACTION. The rebuild reads and writes only
-- this database and spends no Wikimedia budget — there is nothing for a runner
-- to do that the database cannot do for itself, and a workflow that exists to
-- send one SQL statement is a workflow that will one day fail on a missing
-- secret. sweep_stale_rooms already runs this way (jobid 1).
-- ============================================================================

select cron.schedule(
  'rebuild-card-current-clubs',
  '10 6 * * *',
  $$select public.rebuild_card_current_clubs()$$
);

-- Re-running this migration must not queue a second copy. cron.schedule is
-- upsert-by-name, so the line above is already idempotent; this is the undo:
--
--   select cron.unschedule('rebuild-card-current-clubs');

-- ============================================================================
-- И весь конвейер клубов — в 06:25 UTC, ПОСЛЕ пересборки card_current_clubs
-- в 06:10.
--
-- ПОЧЕМУ ПОСЛЕ, А НЕ ВМЕСТО. rebuild_club_squads() читает card_current_club
-- как самое достоверное свидетельство состава. Запустить их одновременно
-- значит собирать составы по вчерашнему снимку — та же несвежесть, только с
-- лишним шагом. Пятнадцати минут хватает: пересборка card_current_clubs
-- укладывается в секунды.
--
-- ПОЧЕМУ ОДИН ВЫЗОВ, А НЕ ПЯТЬ ЗАДАНИЙ. Шаги зависят друг от друга по
-- порядку (см. rebuild_clubs_all в football_clubs.sql), а пять отдельных
-- заданий cron не дают никаких гарантий, что второе начнётся после первого.
-- ============================================================================

select cron.schedule(
  'rebuild-football-clubs',
  '25 6 * * *',
  $$select public.rebuild_clubs_all()$$
);

--   select cron.unschedule('rebuild-football-clubs');
