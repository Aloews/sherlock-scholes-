\set ON_ERROR_STOP on
begin;
insert into public.cards(id,name,transfermarkt_id,category,active) values ('d6dc13cc-0944-4e0e-a887-93fa3747dab8','Cole Palmer','568177','player',true) on conflict (id) do update set transfermarkt_id=excluded.transfermarkt_id, category=excluded.category, active=excluded.active, name=excluded.name;
insert into public.tm_club(id,name,is_national_team) values
 ('club-a','Chelsea',false), ('nat-a','England',true);
insert into public.tm_competition(id,name,type_id,country_id) values
 ('GB1','Premier League',1,189), ('FAC','FA Cup',8,189);
insert into public.player_match_stats(
 card_id,match_date,tournament,home_team,away_team,home_score,away_score,minutes,goals,assists,source,disputed,fetched_at
) values
 ('d6dc13cc-0944-4e0e-a887-93fa3747dab8',current_date-2,'Premier League','Chelsea','Arsenal',2,1,90,1,0,'sportsru',false,now()),
 ('d6dc13cc-0944-4e0e-a887-93fa3747dab8',current_date-5,'Premier League','Chelsea','Brighton',3,0,90,1,0,'sportsru',false,now()),
 ('d6dc13cc-0944-4e0e-a887-93fa3747dab8',current_date-10,'Premier League','Chelsea','West Ham',2,0,90,1,0,'sportsru',false,now()),
 ('d6dc13cc-0944-4e0e-a887-93fa3747dab8',current_date-35,'Premier League','Chelsea','Arsenal',0,0,90,0,0,'sportsru',false,now()),
 ('d6dc13cc-0944-4e0e-a887-93fa3747dab8',current_date-40,'Premier League','Chelsea','Liverpool',1,1,90,0,0,'sportsru',false,now()),
 ('d6dc13cc-0944-4e0e-a887-93fa3747dab8',current_date-50,'Premier League','Chelsea','Everton',1,0,90,0,0,'sportsru',false,now());
insert into public.player_season_stat(
 tm_player_id,season_id,competition_id,club_id,card_id,apps,goals,assists,minutes,fetched_at
) values
 ('568177',2019,'GB1','club-a','d6dc13cc-0944-4e0e-a887-93fa3747dab8',118,49,23,8536,now()-interval '1 day'),
 ('568177',2018,'GB1','club-a','d6dc13cc-0944-4e0e-a887-93fa3747dab8',200,80,50,14000,now()-interval '2 days'),
 ('568177',2020,'FAC','club-a','d6dc13cc-0944-4e0e-a887-93fa3747dab8',5,2,1,350,now()),
 ('568177',2021,'INT','nat-a','d6dc13cc-0944-4e0e-a887-93fa3747dab8',10,3,2,700,now());
do $$
declare
  v record;
  v_definition text;
  v_trend record;
begin
  v_definition := pg_get_functiondef('public.player_smart_deck_trends(integer)'::regprocedure);
  if position('football_player_stats' in lower(v_definition)) = 0
     or position('player_match_stats' in lower(v_definition)) > 0 then
    raise exception 'Smart Deck trends must read the canonical football stats view';
  end if;

  v_definition := pg_get_functiondef('public.player_spotlight_scored(integer)'::regprocedure);
  if position('football_player_stats' in lower(v_definition)) = 0
     or position('player_match_stats' in lower(v_definition)) > 0 then
    raise exception 'Spotlight scoring must read the canonical football stats view';
  end if;

  v_definition := pg_get_viewdef('public.player_match_days'::regclass, true);
  if position('football_player_stats' in lower(v_definition)) = 0 then
    raise exception 'Rating/fantasy compatibility view must read the canonical football stats view';
  end if;

  select * into v from public.player_stats_freshness where tm_player_id='568177';
  if v.source_rows <> 4 then raise exception 'career freshness source_rows mismatch: %', v.source_rows; end if;
  select * into v from public.football_player_competition_totals
   where tm_player_id='568177' and competition_id='GB1' and club_id='club-a';
  if v.appearances <> 118 or v.goals <> 49 or v.assists <> 23 or v.source_rows <> 2 then
    raise exception 'competition totals mismatch: %', row_to_json(v);
  end if;
  perform 1 from public.apply_player_season_competition_stats(
    '568177',
    '[{"season_id":2025,"competition_id":"GB1","competition_name":"Premier League","apps":24,"possible_games":38,"goals":14,"assists":3,"minutes":1980,"yellow":4,"yellow_red":0,"red":0,"start_eleven_percent":91.67,"minutes_played_percent":82.5,"goals_contributed_percent":60.0,"goalkeeper":false,"source_url":"https://www.transfermarkt.com/ceapi/player/568177/performance","source_payload":{"nameSeason":"25/26"}}]'::jsonb,
    'ok'
  );
  select * into v from public.football_player_stats
   where grain='season_competition' and card_id='d6dc13cc-0944-4e0e-a887-93fa3747dab8'
     and season_id=2025 and competition_id='GB1';
  if v.goals <> 14 or v.appearances <> 24 or v.tournament <> 'Premier League' or v.start_eleven_percent <> 91.67
     or v.source <> 'transfermarkt_ceapi' then
    raise exception 'season competition facts mismatch: %', row_to_json(v);
  end if;
  select * into v from public.player_stats_freshness where tm_player_id='568177';
  if v.source_rows <> 5 or v.latest_fetched_at is null
     or v.latest_fetched_at < now()-interval '1 minute' then
    raise exception 'combined source freshness mismatch: %', row_to_json(v);
  end if;
  select * into v from public.football_player_stats
   where grain='match' and card_id='d6dc13cc-0944-4e0e-a887-93fa3747dab8'
     and match_date=current_date-2;
  if v.goals <> 1 or v.appearances <> 1 or v.source <> 'sportsru' then
    raise exception 'canonical match facts mismatch: %', row_to_json(v);
  end if;
  select * into v from public.player_match_days
   where card_id='d6dc13cc-0944-4e0e-a887-93fa3747dab8' and match_date=current_date-2;
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

  select * into v_trend from public.player_smart_deck_trends(1000)
   where card_id='d6dc13cc-0944-4e0e-a887-93fa3747dab8';
  if not found then raise exception 'canonical Smart Deck trend query returned no qualifying player'; end if;
  if v_trend.recent_matches <> 3 or v_trend.recent_goals <> 3
     or v_trend.previous_matches <> 3 or v_trend.previous_goals <> 0 then
    raise exception 'canonical Smart Deck trend aggregates mismatch: %', row_to_json(v_trend);
  end if;
end $$;
rollback;
