-- The old collector used the competition aggregate route as if its rows were
-- season rows. Replace the complete player history atomically on every valid
-- match-level snapshot so obsolete aggregate-as-season records cannot survive.
create or replace function public.apply_player_season_stats(p_tm_id text, p_rows jsonb)
returns table(written integer, linked integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_written integer := 0;
  v_card uuid;
begin
  select id into v_card
    from public.cards
   where transfermarkt_id = p_tm_id
     and active
     and category in ('player', 'woman')
   limit 1;

  if v_card is null then
    return query select 0, 0;
    return;
  end if;

  delete from public.player_season_stat
   where tm_player_id = p_tm_id;

  with src as (
    select distinct on (r->>'season_id', r->>'competition_id', r->>'club_id')
           (r->>'season_id')::smallint as season_id,
           r->>'competition_id' as competition_id,
           r->>'club_id' as club_id,
           coalesce((r->>'apps')::smallint, 0) as apps,
           coalesce((r->>'starts')::smallint, 0) as starts,
           coalesce((r->>'sub_in')::smallint, 0) as sub_in,
           coalesce((r->>'sub_out')::smallint, 0) as sub_out,
           coalesce((r->>'minutes')::integer, 0) as minutes,
           coalesce((r->>'goals')::smallint, 0) as goals,
           coalesce((r->>'assists')::smallint, 0) as assists,
           coalesce((r->>'own_goals')::smallint, 0) as own_goals,
           coalesce((r->>'penalty_goals')::smallint, 0) as penalty_goals,
           coalesce((r->>'yellow')::smallint, 0) as yellow,
           coalesce((r->>'yellow_red')::smallint, 0) as yellow_red,
           coalesce((r->>'red')::smallint, 0) as red,
           coalesce((r->>'team_goals')::smallint, 0) as team_goals,
           coalesce((r->>'opponent_goals')::smallint, 0) as opponent_goals
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
     where coalesce(r->>'season_id', '') <> ''
       and coalesce(r->>'competition_id', '') <> ''
       and coalesce(r->>'club_id', '') <> ''
     order by r->>'season_id', r->>'competition_id', r->>'club_id'
  ),
  ins as (
    insert into public.player_season_stat (
      tm_player_id, season_id, competition_id, club_id, card_id,
      apps, starts, sub_in, sub_out, minutes, goals, assists, own_goals,
      penalty_goals, yellow, yellow_red, red, team_goals, opponent_goals, fetched_at
    )
    select p_tm_id, season_id, competition_id, club_id, v_card,
           apps, starts, sub_in, sub_out, minutes, goals, assists, own_goals,
           penalty_goals, yellow, yellow_red, red, team_goals, opponent_goals, now()
      from src
    returning 1
  )
  select count(*) into v_written from ins;

  return query select v_written, 1;
end;
$function$;
