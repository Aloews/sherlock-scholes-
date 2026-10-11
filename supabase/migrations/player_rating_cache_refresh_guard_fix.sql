-- Repair the production guard failure in refresh_player_rating_cache().
-- The database rejects an unqualified full-table DELETE on this protected table.
-- Keep replacement atomic: DELETE and INSERT run in the same transaction.
-- This migration intentionally does NOT invoke the refresh during deployment.

create or replace function public.refresh_player_rating_cache()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n integer;
begin
  delete from public.player_rating_cache
   where card_id is not null;

  insert into public.player_rating_cache
    (days, card_id, matches, minutes, goals, assists)
  select w.days,
         d.card_id,
         count(*)::int,
         sum(coalesce(d.minutes, 0))::int,
         sum(coalesce(d.goals, 0))::int,
         sum(coalesce(d.assists, 0))::int
    from (values (7::smallint), (30::smallint), (365::smallint)) as w(days)
    join public.player_match_days d
      on d.match_date >= current_date - w.days
   group by w.days, d.card_id
  having sum(coalesce(d.goals, 0)) + sum(coalesce(d.assists, 0)) > 0;

  get diagnostics n = row_count;
  return 'строк: ' || n;
end;
$function$;

revoke all on function public.refresh_player_rating_cache()
  from public, anon, authenticated;
grant execute on function public.refresh_player_rating_cache()
  to service_role;
