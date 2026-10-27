-- Build rolling, evidence-backed candidates for individual awards and team tournaments.
-- Scores are ranking indices (0-100), not calibrated win probabilities.
-- Inputs are the project's current season-stat and completed-match stores.

create index if not exists player_season_stat_award_lookup_idx
  on public.player_season_stat (season_id, card_id, competition_id);

create index if not exists club_match_candidate_lookup_idx
  on public.club_match (tournament, match_date desc)
  where home_score is not null and away_score is not null;

create or replace function public.refresh_award_candidate_snapshots(
  p_season smallint default extract(year from current_date)::smallint
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  with player_totals as (
    select
      c.id as card_id,
      c.name as card_name,
      c.category,
      c.born_on,
      sum(pss.apps)::integer as apps,
      sum(pss.goals)::integer as goals,
      sum(pss.assists)::integer as assists,
      sum(pss.minutes)::integer as minutes,
      count(distinct pss.competition_id)::integer as competitions,
      count(*)::integer as stat_rows,
      max(pss.fetched_at) as source_fetched_at
    from public.player_season_stat pss
    join public.cards c on c.id = pss.card_id
    where pss.season_id = p_season
      and c.active is true
      and c.category in ('player', 'woman')
    group by c.id, c.name, c.category, c.born_on
  ),
  candidates as (
    select
      a.award_key,
      p_season as season_id,
      p.card_id,
      p.card_name,
      p.category,
      p.apps,
      p.goals,
      p.assists,
      p.minutes,
      p.competitions,
      p.stat_rows,
      p.source_fetched_at,
      a.raw_score
    from player_totals p
    cross join lateral (
      values
        ('ballon_dor'::text, 'player'::text,
          p.goals * 3.0 + p.assists * 2.0 + p.apps * 0.20 + p.minutes / 90.0 * 0.10),
        ('ballon_dor_feminin'::text, 'woman'::text,
          p.goals * 3.0 + p.assists * 2.0 + p.apps * 0.20 + p.minutes / 90.0 * 0.10),
        ('the_best'::text, 'player'::text,
          p.goals * 2.5 + p.assists * 2.5 + p.apps * 0.35 + p.minutes / 90.0 * 0.15),
        ('the_best_female'::text, 'woman'::text,
          p.goals * 2.5 + p.assists * 2.5 + p.apps * 0.35 + p.minutes / 90.0 * 0.15),
        ('golden_boy'::text, 'player'::text,
          p.goals * 3.0 + p.assists * 2.0 + p.apps * 0.25 + p.minutes / 90.0 * 0.10),
        ('golden_boot'::text, 'player'::text,
          p.goals * 10.0 + p.assists * 0.10)
    ) as a(award_key, eligible_category, raw_score)
    where p.category = a.eligible_category
      and p.apps > 0
      and p.minutes > 0
      and p.raw_score is not null
      and p.raw_score > 0
      and (
        a.award_key <> 'golden_boy'
        or p.born_on > make_date(p_season::integer - 21, 1, 1)
      )
  ),
  normalized as (
    select
      c.*,
      greatest(0, least(100, 100.0 * c.raw_score / nullif(max(c.raw_score) over (partition by c.award_key), 0))) as normalized_score,
      least(1.0, c.apps::numeric / nullif(max(c.apps) over (partition by c.award_key), 0)) as coverage,
      row_number() over (partition by c.award_key order by c.raw_score desc, c.goals desc, c.assists desc, c.minutes desc, c.card_name) as candidate_rank
    from candidates c
  ),
  ranked as (
    select
      n.*,
      case
        when n.coverage >= 0.80 and n.apps >= 20 then 'high'
        when n.coverage >= 0.45 and n.apps >= 8 then 'medium'
        else 'low'
      end as confidence
    from normalized n
    where n.candidate_rank <= 50
  )
  insert into public.award_candidate_snapshot (
    award_key, season_id, snapshot_date, card_id, candidate_score,
    candidate_rank, confidence, data_coverage, score_components,
    evidence, source_fetched_at, model_version
  )
  select
    r.award_key,
    r.season_id,
    current_date,
    r.card_id,
    round(r.normalized_score::numeric, 2),
    r.candidate_rank::smallint,
    r.confidence,
    round(r.coverage::numeric, 4),
    jsonb_build_object(
      'goals', r.goals,
      'assists', r.assists,
      'appearances', r.apps,
      'minutes', r.minutes,
      'competitions', r.competitions,
      'stat_rows', r.stat_rows,
      'raw_score', round(r.raw_score::numeric, 3),
      'score_is_probability', false
    ),
    jsonb_build_object(
      'source_tables', jsonb_build_array('player_season_stat', 'cards'),
      'season_id', r.season_id,
      'card_name', r.card_name,
      'category', r.category,
      'coverage_basis', 'appearances relative to the leading candidate; not source completeness',
      'model_limits', jsonb_build_array(
        'ranking proxy only; not a calibrated probability',
        'does not yet include voting, defensive metrics, goalkeeper metrics or team trophies'
      )
    ),
    r.source_fetched_at,
    'stats-proxy-v1'
  from ranked r
  on conflict (award_key, season_id, snapshot_date, card_id) do update set
    candidate_score = excluded.candidate_score,
    candidate_rank = excluded.candidate_rank,
    confidence = excluded.confidence,
    data_coverage = excluded.data_coverage,
    score_components = excluded.score_components,
    evidence = excluded.evidence,
    source_fetched_at = excluded.source_fetched_at,
    model_version = excluded.model_version;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create or replace function public.refresh_team_tournament_candidate_snapshots()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows integer := 0;
begin
  with match_history as (
    select
      cm.*,
      lag(cm.match_date) over (partition by cm.tournament order by cm.match_date, cm.home_key, cm.away_key) as previous_date
    from public.club_match cm
    where cm.match_date >= current_date - 730
      and cm.home_score is not null
      and cm.away_score is not null
      and cm.home_key is not null
      and cm.away_key is not null
      and cm.tournament is not null
      and cm.tournament !~* '(товарищес|friendly)'
  ),
  match_clusters as (
    select
      mh.*,
      sum(case when mh.previous_date is null or mh.match_date - mh.previous_date > 75 then 1 else 0 end)
        over (partition by mh.tournament order by mh.match_date, mh.home_key, mh.away_key rows unbounded preceding) as season_cluster
    from match_history mh
  ),
  latest_cluster as (
    select tournament, max(season_cluster) as season_cluster, max(match_date) as latest_match
    from match_clusters
    group by tournament
    having max(match_date) >= current_date - 45
  ),
  current_matches as (
    select mc.*
    from match_clusters mc
    join latest_cluster lc using (tournament, season_cluster)
    where mc.match_date >= current_date - 730
  ),
  team_match_rows as (
    select
      tournament, season_cluster, match_date, home_key as team_key, home_team as team_name,
      case when home_score > away_score then 3 when home_score = away_score then 1 else 0 end as points,
      case when home_score > away_score then 1 else 0 end as wins,
      case when home_score = away_score then 1 else 0 end as draws,
      case when home_score < away_score then 1 else 0 end as losses,
      home_score::integer as goals_for, away_score::integer as goals_against
    from current_matches
    union all
    select
      tournament, season_cluster, match_date, away_key, away_team,
      case when away_score > home_score then 3 when away_score = home_score then 1 else 0 end,
      case when away_score > home_score then 1 else 0 end,
      case when away_score = home_score then 1 else 0 end,
      case when away_score < home_score then 1 else 0 end,
      away_score::integer, home_score::integer
    from current_matches
  ),
  team_totals as (
    select
      tmr.tournament,
      min(tmr.match_date) as season_start,
      max(tmr.match_date) as latest_match,
      tmr.team_key,
      max(tmr.team_name) as team_name,
      count(*)::integer as played,
      sum(tmr.points)::integer as points,
      sum(tmr.wins)::integer as wins,
      sum(tmr.draws)::integer as draws,
      sum(tmr.losses)::integer as losses,
      sum(tmr.goals_for)::integer as goals_for,
      sum(tmr.goals_against)::integer as goals_against,
      coalesce(max(cr.elo), 1500)::numeric as elo
    from team_match_rows tmr
    left join public.club_rating cr on cr.club_key = tmr.team_key
    group by tmr.tournament, tmr.season_cluster, tmr.team_key
    having count(*) >= 2
  ),
  with_rates as (
    select
      tt.*,
      tt.points::numeric / nullif(tt.played, 0) as points_per_game,
      (tt.goals_for - tt.goals_against)::numeric / nullif(tt.played, 0) as goal_difference_per_game,
      max(tt.played) over (partition by tt.tournament, tt.season_start) as max_played,
      min(tt.points::numeric / nullif(tt.played, 0)) over (partition by tt.tournament, tt.season_start) as min_ppg,
      max(tt.points::numeric / nullif(tt.played, 0)) over (partition by tt.tournament, tt.season_start) as max_ppg,
      min((tt.goals_for - tt.goals_against)::numeric / nullif(tt.played, 0)) over (partition by tt.tournament, tt.season_start) as min_gd,
      max((tt.goals_for - tt.goals_against)::numeric / nullif(tt.played, 0)) over (partition by tt.tournament, tt.season_start) as max_gd,
      min(tt.elo) over (partition by tt.tournament, tt.season_start) as min_elo,
      max(tt.elo) over (partition by tt.tournament, tt.season_start) as max_elo,
      bool_or(tt.tournament ~* '(кубок|cup|champions league|europa league|conference league)') over (partition by tt.tournament, tt.season_start) as knockout_or_cup
    from team_totals tt
  ),
  scored as (
    select
      wr.*,
      least(100.0, greatest(0.0,
        50.0 * coalesce(wr.points_per_game / nullif(wr.max_ppg, 0), 0)
        + 20.0 * coalesce((wr.goal_difference_per_game - wr.min_gd) / nullif(wr.max_gd - wr.min_gd, 0), 0.5)
        + 30.0 * coalesce((wr.elo - wr.min_elo) / nullif(wr.max_elo - wr.min_elo, 0), 0.5)
      )) as raw_score,
      least(1.0, wr.played::numeric / nullif(wr.max_played, 0)) as coverage
    from with_rates wr
    where wr.played >= 3
      and wr.latest_match >= current_date - 45
      and (select count(distinct other.team_key) from team_totals other where other.tournament = wr.tournament and other.season_start = wr.season_start) >= 3
  ),
  ranked as (
    select
      s.*,
      row_number() over (partition by s.tournament, s.season_start order by s.raw_score desc, s.points desc, s.goals_for desc, s.team_name) as candidate_rank,
      case
        when s.played >= 12 and s.coverage >= 0.80 and not s.knockout_or_cup then 'high'
        when s.played >= 6 and s.coverage >= 0.50 then 'medium'
        else 'low'
      end as confidence
    from scored s
  )
  insert into public.team_tournament_candidate_snapshot (
    tournament, season_start, snapshot_date, team_key, team_name,
    candidate_score, candidate_rank, confidence, data_coverage,
    score_components, evidence, source_fetched_at, model_version
  )
  select
    r.tournament, r.season_start, current_date, r.team_key, r.team_name,
    round(r.raw_score::numeric, 2), r.candidate_rank::smallint, r.confidence,
    round(r.coverage::numeric, 4),
    jsonb_build_object(
      'played', r.played, 'points', r.points, 'wins', r.wins, 'draws', r.draws,
      'losses', r.losses, 'goals_for', r.goals_for, 'goals_against', r.goals_against,
      'points_per_game', round(r.points_per_game, 3),
      'goal_difference_per_game', round(r.goal_difference_per_game, 3),
      'elo', r.elo, 'knockout_or_cup', r.knockout_or_cup,
      'score_is_probability', false
    ),
    jsonb_build_object(
      'source_table', 'club_match',
      'season_detection', 'current match cluster after a gap greater than 75 days',
      'latest_match', r.latest_match,
      'coverage_basis', 'matches played relative to the most active candidate',
      'model_limits', case when r.knockout_or_cup
        then jsonb_build_array('ranking proxy only; cup bracket and next-round draw are not available')
        else jsonb_build_array('ranking proxy only; no remaining fixtures or title-race simulation yet')
      end
    ),
    r.latest_match::timestamptz,
    'standings-elo-proxy-v1'
  from ranked r
  where r.candidate_rank <= 100
  on conflict (tournament, season_start, snapshot_date, team_key) do update set
    team_name = excluded.team_name,
    candidate_score = excluded.candidate_score,
    candidate_rank = excluded.candidate_rank,
    confidence = excluded.confidence,
    data_coverage = excluded.data_coverage,
    score_components = excluded.score_components,
    evidence = excluded.evidence,
    source_fetched_at = excluded.source_fetched_at,
    model_version = excluded.model_version;

  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;

create or replace function public.refresh_prediction_candidates(
  p_season smallint default extract(year from current_date)::smallint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_awards integer;
  v_teams integer;
begin
  v_awards := public.refresh_award_candidate_snapshots(p_season);
  v_teams := public.refresh_team_tournament_candidate_snapshots();
  return jsonb_build_object(
    'season_id', p_season,
    'snapshot_date', current_date,
    'award_candidate_rows_upserted', v_awards,
    'team_tournament_candidate_rows_upserted', v_teams,
    'model_versions', jsonb_build_object(
      'awards', 'stats-proxy-v1',
      'team_tournaments', 'standings-elo-proxy-v1'
    ),
    'note', 'Scores rank candidates; they are not calibrated probabilities or confirmed outcomes.'
  );
end;
$$;

revoke all on function public.refresh_award_candidate_snapshots(smallint) from public, anon, authenticated;
revoke all on function public.refresh_team_tournament_candidate_snapshots() from public, anon, authenticated;
revoke all on function public.refresh_prediction_candidates(smallint) from public, anon, authenticated;
grant execute on function public.refresh_prediction_candidates(smallint) to service_role;

notify pgrst, 'reload schema';
