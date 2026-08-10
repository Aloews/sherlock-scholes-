-- ============================================================================
-- Settle predictions on the hour.
--
-- WHY THIS HALF IS SCHEDULED AND THE OTHER HALF IS NOT. Settlement is pure
-- SQL: it reads finished fixtures and awards points, costs nothing, and is
-- idempotent (`settled_at is null` is both its filter and what it sets), so
-- running it hourly is free and a missed run costs nothing but an hour.
--
-- Fetching the scores is the other half, and pg_cron cannot do it: it is an
-- HTTP call to the football-fixtures Edge Function (`{"action":"scores"}`),
-- and pg_net is NOT installed on this project — checked, not assumed. So that
-- trigger has to come from outside Postgres: Supabase's own scheduled
-- functions, or a GitHub Action beside daily-enrich.yml.
--
-- Splitting them this way is not a workaround. Scores cost a credit each and
-- settlement costs nothing, so tying settlement to the fetch would make the
-- cheap half as rare as the expensive one — and a score that arrived by any
-- route would sit unsettled until the next paid run.
--
-- :20 rather than :00 so it does not land on the same minute as every other
-- hourly job on a shared instance.
-- ============================================================================

select cron.schedule(
  'settle-match-predictions',
  '20 * * * *',
  $$select public.settle_predictions()$$
);

-- To remove: select cron.unschedule('settle-match-predictions');
