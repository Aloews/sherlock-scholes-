-- Current candidate lists must not silently resurrect an old cup/world-cup
-- shortlist after that competition has stopped producing recent results. Historical
-- snapshots remain stored for outcome evaluation and backtesting.
create or replace function public.admin_list_team_tournament_candidates(
  p_password text,
  p_tournament text default null
)
returns table (
  tournament text,
  season_start date,
  snapshot_date date,
  team_key text,
  team_name text,
  candidate_score numeric,
  candidate_rank smallint,
  confidence text,
  data_coverage numeric,
  score_components jsonb,
  evidence jsonb,
  model_version text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_latest_snapshot date;
begin
  if not staff_check_password(p_password) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  select max(s.snapshot_date) into v_latest_snapshot
    from public.team_tournament_candidate_snapshot s;

  if v_latest_snapshot is null then
    return;
  end if;

  return query
  with latest as (
    select s.*,
           row_number() over (
             partition by s.tournament
             order by s.candidate_rank, s.team_key
           ) as candidate_position
      from public.team_tournament_candidate_snapshot s
     where s.snapshot_date = v_latest_snapshot
       and (p_tournament is null or s.tournament = p_tournament)
  )
  select ranked.tournament, ranked.season_start, ranked.snapshot_date,
         ranked.team_key, ranked.team_name, ranked.candidate_score,
         ranked.candidate_rank, ranked.confidence, ranked.data_coverage,
         ranked.score_components, ranked.evidence, ranked.model_version
    from latest ranked
   where ranked.candidate_position <= case when p_tournament is null then 3 else 100 end
   order by ranked.tournament, ranked.candidate_rank;
end;
$$;

revoke all on function public.admin_list_team_tournament_candidates(text, text) from public;
grant execute on function public.admin_list_team_tournament_candidates(text, text) to anon, authenticated;
notify pgrst, 'reload schema';
