do $$
declare
  v_backfilled timestamptz;
  v_unchecked timestamptz;
  v_index_exists boolean;
begin
  select player_stats_checked_at into v_backfilled
    from public.cards where id='00000000-0000-0000-0000-000000000001';
  if v_backfilled is distinct from '2026-10-25T12:00:00Z'::timestamptz then
    raise exception 'existing current-season row must backfill the stats attempt checkpoint';
  end if;

  select player_stats_checked_at into v_unchecked
    from public.cards where id='00000000-0000-0000-0000-000000000002';
  if v_unchecked is not null then
    raise exception 'player without current-season rows must remain first in the queue';
  end if;

  select exists (
    select 1 from pg_indexes
    where schemaname='public' and indexname='cards_player_stats_refresh_queue_idx'
  ) into v_index_exists;
  if not v_index_exists then
    raise exception 'stats refresh queue index must exist';
  end if;
end $$;
