create or replace function public.admin_list_award_candidates(p_password text)
returns table (
  award_key text,
  season_id smallint,
  snapshot_date date,
  card_id uuid,
  card_name text,
  category text,
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
  select s.award_key, s.season_id, s.snapshot_date, s.card_id, c.name, c.category,
         s.candidate_score, s.candidate_rank, s.confidence, s.data_coverage,
         s.score_components, s.evidence, s.model_version
    from public.award_candidate_snapshot s
    join public.cards c on c.id = s.card_id
   where s.snapshot_date = (
     select max(latest.snapshot_date)
       from public.award_candidate_snapshot latest
      where latest.award_key = s.award_key and latest.season_id = s.season_id
   )
   order by s.award_key, s.candidate_rank
   limit 300;
end;
$$;
revoke all on function public.admin_list_award_candidates(text) from public;
grant execute on function public.admin_list_award_candidates(text) to anon, authenticated;
notify pgrst, 'reload schema';
