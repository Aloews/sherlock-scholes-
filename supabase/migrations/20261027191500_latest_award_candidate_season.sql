-- Admin candidate analytics shows the newest season for each award by default.
-- Older snapshots remain stored for retrospective evaluation; they must not be mixed
-- into the current contender list after a new season becomes available.
create or replace function public.admin_list_award_candidates(
  p_password text,
  p_award_key text default null,
  p_competition_id text default null
)
returns table (
  award_key text,
  season_id smallint,
  snapshot_date date,
  card_id uuid,
  competition_id text,
  card_name text,
  photo_url text,
  category text,
  position_ru text,
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
  select s.award_key, s.season_id, s.snapshot_date, s.card_id, s.competition_id,
         c.name, c.photo_url, c.category, c.position_ru, s.candidate_score,
         s.candidate_rank, s.confidence, s.data_coverage, s.score_components,
         s.evidence, s.model_version
    from public.award_candidate_snapshot s
    join public.cards c on c.id = s.card_id
   where s.season_id = (
     select max(latest_season.season_id)
       from public.award_candidate_snapshot latest_season
      where latest_season.award_key = s.award_key
   )
     and s.snapshot_date = (
       select max(latest.snapshot_date)
         from public.award_candidate_snapshot latest
        where latest.award_key = s.award_key
          and latest.season_id = s.season_id
     )
     and (p_award_key is null or s.award_key = p_award_key)
     and (p_competition_id is null or s.competition_id = p_competition_id)
     and (s.award_key <> 'golden_boot' or p_competition_id is not null or s.candidate_rank <= 5)
   order by s.award_key, s.competition_id, s.candidate_rank
   limit 2500;
end;
$$;

revoke all on function public.admin_list_award_candidates(text, text, text) from public;
grant execute on function public.admin_list_award_candidates(text, text, text) to anon, authenticated;
notify pgrst, 'reload schema';
