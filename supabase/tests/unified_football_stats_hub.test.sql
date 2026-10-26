\set ON_ERROR_STOP on
begin;
insert into public.cards(id,name,transfermarkt_id,category,active) values ('d6dc13cc-0944-4e0e-a887-93fa3747dab8','Cole Palmer','568177','player',true) on conflict (id) do nothing;
insert into public.tm_club(id,name,is_national_team) values
 ('club-a','Chelsea',false), ('nat-a','England',true);
insert into public.tm_competition(id,name,type_id,country_id) values
 ('GB1','Premier League',1,189), ('FAC','FA Cup',8,189);
insert into public.player_match_stats(
 card_id,match_date,tournament,home_team,away_team,home_score,away_score,minutes,goals,assists,source,disputed,fetched_at
) values (
 'd6dc13cc-0944-4e0e-a887-93fa3747dab8','2026-10-25','Premier League','Chelsea','Arsenal',2,1,90,1,0,'sportsru',false,now()
);
insert into public.player_season_stat(
 tm_player_id,season_id,competition_id,club_id,card_id,apps,goals,assists,minutes,fetched_at
) values
 ('568177',2019,'GB1','club-a','d6dc13cc-0944-4e0e-a887-93fa3747dab8',118,49,23,8536,now()-interval '1 day'),
 ('568177',2018,'GB1','club-a','d6dc13cc-0944-4e0e-a887-93fa3747dab8',200,80,50,14000,now()-interval '2 days'),
 ('568177',2020,'FAC','club-a','d6dc13cc-0944-4e0e-a887-93fa3747dab8',5,2,1,350,now()),
 ('568177',2021,'INT','nat-a','d6dc13cc-0944-4e0e-a887-93fa3747dab8',10,3,2,700,now());
do $$
declare v record;
begin
  select * into v from public.player_stats_freshness where tm_player_id='568177';
  if v.source_rows <> 5 then raise exception 'freshness source_rows mismatch: %', v.source_rows; end if;
  if v.latest_fetched_at < now()-interval '1 minute' then raise exception 'freshness timestamp mismatch'; end if;
  select * into v from public.football_player_competition_totals
   where tm_player_id='568177' and competition_id='GB1' and club_id='club-a';
  if v.appearances <> 118 or v.goals <> 49 or v.assists <> 23 or v.source_rows <> 2 then
    raise exception 'competition totals mismatch: %', row_to_json(v);
  end if;
  select * into v from public.football_player_stats
   where grain='match' and card_id='d6dc13cc-0944-4e0e-a887-93fa3747dab8'
     and match_date='2026-10-25';
  if v.goals <> 1 or v.appearances <> 1 or v.source <> 'sportsru' then
    raise exception 'canonical match facts mismatch: %', row_to_json(v);
  end if;
  select * into v from public.player_match_days
   where card_id='d6dc13cc-0944-4e0e-a887-93fa3747dab8' and match_date='2026-10-25';
  if v.goals <> 1 or v.home_team <> 'Chelsea' then
    raise exception 'rating/fantasy read contract mismatch: %', row_to_json(v);
  end if;
  select * into v from public.football_player_career_totals
   where tm_player_id='568177';
  if v.club_appearances <> 123 or v.club_goals <> 51 then
    raise exception 'club career totals mismatch: %', row_to_json(v);
  end if;
  if v.national_appearances_all_levels <> 10 or v.national_goals_all_levels <> 3 then
    raise exception 'national totals mismatch: %', row_to_json(v);
  end if;
end $$;
rollback;
