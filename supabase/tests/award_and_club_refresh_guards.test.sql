begin;

do $$
declare
  v_rebuild text;
  v_evaluation text;
begin
  select pg_get_functiondef('public.rebuild_club_matches()'::regprocedure)
    into v_rebuild;
  if position('current_date - 365' in v_rebuild) = 0 then
    raise exception 'club-match rebuild must be bounded to the rolling 365-day candidate window';
  end if;
  if position('from player_match_stats s' in v_rebuild) = 0
     or position('from player_match_days' in v_rebuild) > 0 then
    raise exception 'club-match rebuild must deduplicate source match rows directly, not expand the player-day view';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and indexname = 'player_match_stats_club_refresh_idx'
  ) then
    raise exception 'the bounded club-match refresh index is missing';
  end if;

  select pg_get_viewdef('public.award_candidate_evaluation'::regclass, true)
    into v_evaluation;
  if position('official_award_source_sync' in v_evaluation) = 0
     or position('announced_at' in v_evaluation) = 0 then
    raise exception 'award backtesting must exclude undated or non-official legacy winner labels';
  end if;
end $$;

rollback;
