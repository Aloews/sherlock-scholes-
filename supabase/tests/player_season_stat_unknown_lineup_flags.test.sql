-- The migration must convert recent unsupported zero flags to NULL.
do $$
begin
  if not exists (
    select 1 from public.player_season_stat
     where tm_player_id = '102' and season_id = 2026 and competition_id = 'GB1'
       and starts is null and sub_in is null and sub_out is null
  ) then
    raise exception 'recent unsupported lineup flags must be NULL, not zero';
  end if;
end $$;

-- Refresh a player without lineup flags. Verified prior values for the same
-- season/competition/club must survive the full-history replacement.
select * from public.apply_player_season_stats(
  '101',
  '[{"season_id":2026,"competition_id":"UNLA","club_id":"3440","apps":4,"minutes":360,"goals":0,"assists":4}]'::jsonb
);

do $$
begin
  if not exists (
    select 1 from public.player_season_stat
     where tm_player_id = '101' and season_id = 2026 and competition_id = 'UNLA'
       and starts = 3 and sub_in = 1 and sub_out = 1
  ) then
    raise exception 'verified prior lineup flags were not preserved';
  end if;
end $$;

-- A new row without source lineup data must remain unknown, not become zero.
select * from public.apply_player_season_stats(
  '102',
  '[{"season_id":2026,"competition_id":"GB1","club_id":"11","apps":8,"minutes":652,"goals":2,"assists":0}]'::jsonb
);

do $$
begin
  if not exists (
    select 1 from public.player_season_stat
     where tm_player_id = '102' and season_id = 2026 and competition_id = 'GB1'
       and starts is null and sub_in is null and sub_out is null
  ) then
    raise exception 'unknown lineup flags for new rows must stay NULL';
  end if;
end $$;
