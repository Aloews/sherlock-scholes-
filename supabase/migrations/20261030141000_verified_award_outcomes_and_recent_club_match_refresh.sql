-- Only event-specific, dated official award evidence is eligible for backtesting.
-- Biography pages and undated career-title strings are not event outcomes.
create or replace view public.award_candidate_evaluation as
select o.award_key, o.award_year, o.card_id, o.result, o.announced_at, o.source_url,
       p.snapshot_date as last_pre_award_snapshot,
       p.candidate_rank as winner_rank_before_award,
       p.candidate_score as winner_score_before_award,
       p.data_coverage as winner_data_coverage,
       case when p.candidate_rank is null then null else p.candidate_rank = 1 end as predicted_top_1,
       case when p.candidate_rank is null then null else p.candidate_rank <= 5 end as predicted_top_5,
       o.competition_id
  from public.award_outcome o
  left join lateral (
    select s.snapshot_date, s.candidate_rank, s.candidate_score, s.data_coverage
      from public.award_candidate_snapshot s
     where s.award_key = o.award_key
       and s.card_id = o.card_id
       and s.competition_id = o.competition_id
       and s.season_id = case when o.award_key = 'golden_boot' then o.award_year else o.award_year - 1 end
       and s.snapshot_date < (o.announced_at at time zone 'UTC')::date
     order by s.snapshot_date desc
     limit 1
  ) p on true
 where o.result = 'winner'
   and o.verified_by = 'official_award_source_sync'
   and o.announced_at is not null;

-- The team-candidate model consumes a rolling 365-day result window. Rebuilding
-- every historical player row on every daily run caused the 3-second PostgREST
-- statement timeout and blocked downstream rating/candidate refreshes.
create index if not exists player_match_stats_club_refresh_idx
  on public.player_match_stats
    (match_date, tournament, home_team, away_team, fetched_at desc)
  include (home_score, away_score)
  where not disputed and home_score is not null and away_score is not null;

create or replace function public.rebuild_club_matches()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into club_match (match_date, home_key, away_key, tournament,
                          home_team, away_team, home_score, away_score, fetched_at)
  select distinct on (m.match_date, m.home_key, m.away_key)
         m.match_date, m.home_key, m.away_key, m.tournament,
         m.home_team, m.away_team, m.home_score, m.away_score, now()
    from (
      select d.match_date, d.tournament, d.home_team, d.away_team,
             d.home_score, d.away_score,
             sh.club_key as home_key, sa.club_key as away_key
        from (
          select distinct on (s.match_date, s.tournament, s.home_team, s.away_team)
                 s.match_date, s.tournament, s.home_team, s.away_team,
                 s.home_score, s.away_score
            from player_match_stats s
           where not s.disputed
             and s.home_score is not null
             and s.away_score is not null
             and s.match_date >= current_date - 365
           order by s.match_date, s.tournament, s.home_team, s.away_team,
                    s.fetched_at desc nulls last,
                    s.home_score desc nulls last,
                    s.away_score desc nulls last
        ) d
        join club_name_seen sh
          on sh.team = d.home_team and sh.scope = coalesce(tournament_scope(d.tournament), '')
        join club_name_seen sa
          on sa.team = d.away_team and sa.scope = coalesce(tournament_scope(d.tournament), '')
       where sh.club_key is not null and sa.club_key is not null
    ) m
   where m.home_key is not null and m.away_key is not null
     and m.home_key <> m.away_key
     and (
       tournament_scope(m.tournament) is distinct from 'Россия'
       or (
         exists (select 1 from football_club f
                  where f.club_key = m.home_key and f.country = 'Россия')
         and
         exists (select 1 from football_club f
                  where f.club_key = m.away_key and f.country = 'Россия')
       )
     )
   order by m.match_date, m.home_key, m.away_key, m.home_score desc nulls last
  on conflict (match_date, home_key, away_key) do update set
    tournament = excluded.tournament,
    home_team  = excluded.home_team,
    away_team  = excluded.away_team,
    home_score = excluded.home_score,
    away_score = excluded.away_score,
    fetched_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

notify pgrst, 'reload schema';
