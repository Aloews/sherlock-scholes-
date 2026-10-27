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
begin
  if not staff_check_password(p_password) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  return query
  select s.tournament, s.season_start, s.snapshot_date, s.team_key, s.team_name,
         s.candidate_score, s.candidate_rank, s.confidence, s.data_coverage,
         s.score_components, s.evidence, s.model_version
    from public.team_tournament_candidate_snapshot s
   where s.snapshot_date = (
     select max(latest.snapshot_date)
       from public.team_tournament_candidate_snapshot latest
      where latest.tournament = s.tournament
   )
     and (p_tournament is null or s.tournament = p_tournament)
   order by s.tournament, s.candidate_rank
   limit 2500;
end;
$$;

revoke all on function public.admin_list_team_tournament_candidates(text, text) from public;
grant execute on function public.admin_list_team_tournament_candidates(text, text) to anon, authenticated;
notify pgrst, 'reload schema';
