-- Fix the production failures confirmed in Supabase logs on 2026-10-09.
-- Safe to apply repeatedly; this migration does not run the data-refresh jobs.

create or replace function public.refresh_player_rating_cache()
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n integer;
begin
  -- Keep the full refresh atomic while satisfying safe-delete guards.
  -- card_id is NOT NULL for every row in player_rating_cache.
  delete from public.player_rating_cache
   where card_id is not null;

  insert into public.player_rating_cache
    (days, card_id, matches, minutes, goals, assists)
  select w.days, d.card_id,
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

revoke all on function public.refresh_player_rating_cache() from public, anon, authenticated;
grant execute on function public.refresh_player_rating_cache() to service_role;

-- The live Soccer Wiki RPC returns a column named "записано" (plus two
-- diagnostics columns). The verifier still selected "written", which caused
-- the nightly pg_cron job to fail every morning. Read the actual output name.
create or replace function public.verify_card_data()
returns table(step text, n integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v integer;
begin
  select created into v from public.add_clubs_from_soccerwiki();
  step := 'клубов заведено'; n := v; return next;

  select linked into v from public.link_soccerwiki_by_name();
  step := 'игроков связано'; n := v; return next;

  select written into v from public.fill_current_club_from_roster();
  step := 'клуб из заявки'; n := v; return next;

  select "записано" into v from public.fill_current_club_from_soccerwiki();
  step := 'клуб из Soccer Wiki'; n := v; return next;

  select count(*)::integer into v from public.card_club_conflicts();
  step := 'расхождений осталось'; n := v; return next;
end;
$function$;

revoke all on function public.verify_card_data() from public, anon, authenticated;
grant execute on function public.verify_card_data() to service_role;
