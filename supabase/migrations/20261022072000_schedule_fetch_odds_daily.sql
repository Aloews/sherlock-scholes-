-- The odds collector rotates one core market per UTC day. A two-day cron
-- cadence skipped half the deterministic rotation sequence, so schedule daily.
-- The edge function's reservation RPC preserves the configured monthly reserve
-- and exits before requesting provider data when the budget threshold is reached.

do $migration$
declare
  v_job_id bigint;
begin
  for v_job_id in
    select jobid from cron.job where jobname = 'fetch-fixture-odds'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'fetch-fixture-odds',
    '10 6 * * *',
    'select public.fetch_fixture_odds()'
  );
end
$migration$;

notify pgrst, 'reload schema';
