create or replace view public.award_candidate_evaluation
with (security_invoker = true)
as
select
  o.award_key,
  o.award_year,
  o.card_id,
  o.result,
  o.announced_at,
  o.source_url,
  p.snapshot_date as last_pre_award_snapshot,
  p.candidate_rank as winner_rank_before_award,
  p.candidate_score as winner_score_before_award,
  p.data_coverage as winner_data_coverage,
  case when p.candidate_rank is null then null else p.candidate_rank = 1 end as predicted_top_1,
  case when p.candidate_rank is null then null else p.candidate_rank <= 5 end as predicted_top_5
from public.award_outcome o
left join lateral (
  select s.snapshot_date, s.candidate_rank, s.candidate_score, s.data_coverage
  from public.award_candidate_snapshot s
  where s.award_key = o.award_key
    and s.card_id = o.card_id
    and o.announced_at is not null
    and s.snapshot_date < (o.announced_at at time zone 'UTC')::date
  order by s.snapshot_date desc, s.candidate_rank
  limit 1
) p on true
where o.result = 'winner';

grant select on public.award_candidate_evaluation to anon, authenticated, service_role;
comment on view public.award_candidate_evaluation is
  'Out-of-time check: ranks the verified winner using the latest snapshot dated before the announcement date. NULL rank means no valid pre-award snapshot exists.';
