do $$
declare
  v_backfilled timestamptz;
  v_unchecked timestamptz;
  v_index_exists boolean;
begin
  select player_stats_checked_at into v_backfilled
    from public.cards where id='00000000-0000-0000-0000-000000000101';
  if v_backfilled is not null then
    raise exception 'legacy season rows are not trustworthy attempt checkpoints';
  end if;

  select player_stats_checked_at into v_unchecked
    from public.cards where id='00000000-0000-0000-0000-000000000102';
  if v_unchecked is not null then
    raise exception 'never-checked player must remain first in the queue';
  end if;

  select exists (
    select 1 from pg_indexes
    where schemaname='public' and indexname='cards_player_stats_refresh_queue_idx'
  ) into v_index_exists;
  if not v_index_exists then
    raise exception 'stats refresh queue index must exist';
  end if;

  perform * from public.apply_player_season_stats('101', jsonb_build_array(
    jsonb_build_object(
      'season_id', 2026, 'competition_id', 'GB1', 'club_id', '11',
      'apps', 8, 'minutes', 647, 'goals', 2, 'assists', 0
    )
  ));
  if exists (
    select 1 from public.player_season_stat
     where tm_player_id='101' and season_id=2020 and competition_id='GB1'
  ) then
    raise exception 'obsolete aggregate-as-season rows must be deleted by a full match-feed refresh';
  end if;
  if not exists (
    select 1 from public.player_season_stat
     where tm_player_id='101' and season_id=2026 and competition_id='GB1'
       and apps=8 and minutes=647 and goals=2 and assists=0
  ) then
    raise exception 'current-season totals must replace stale aggregate rows';
  end if;

  perform * from public.apply_player_season_stats('101', '[]'::jsonb);
  if exists (select 1 from public.player_season_stat where tm_player_id='101') then
    raise exception 'a valid empty history snapshot must clear obsolete season rows';
  end if;
end $;
