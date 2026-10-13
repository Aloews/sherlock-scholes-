-- Admin-only portfolio of distinct football accumulators.
-- Prices are aggregated from the latest pre-kickoff 1X2 snapshots across all
-- collected bookmakers. No bookmaker data is exposed to player-facing screens.

create or replace function public.admin_diverse_accumulators(
  p_password text,
  p_hours integer default 168
)
returns table (
  profile text,
  leg_count integer,
  fair_probability numeric,
  combined_odds numeric,
  expected_return numeric,
  historical_tickets integer,
  historical_wins integer,
  historical_hit_rate numeric,
  legs jsonb
)
language plpgsql
stable
security definer
set search_path = public
set statement_timeout = '8s'
as $$
begin
  if p_password is null or not public.admin_check_password(p_password) then
    raise exception 'нет доступа' using errcode = '42501';
  end if;

  return query
  with best_prices as (
    select o.fixture_id, o.taken_at,
           max(o.home_price) as home_price,
           max(o.draw_price) as draw_price,
           max(o.away_price) as away_price
      from public.fixture_odds o
     group by o.fixture_id, o.taken_at
  ),
  market as (
    select c.fixture_id, f.commence_at, f.sport_key, f.home_team, f.away_team,
           f.home_score, f.away_score, f.completed, c.taken_at, c.books,
           v.pick, v.fair_prob, v.best_price,
           case
             when f.completed and f.home_score is not null and f.away_score is not null
               then case when f.home_score > f.away_score then 'H'
                         when f.home_score = f.away_score then 'D' else 'A' end
             else null
           end as actual
      from public.fixture_odds_consensus c
      join public.fixtures f on f.id = c.fixture_id
      join best_prices b on b.fixture_id = c.fixture_id and b.taken_at = c.taken_at
      cross join lateral (values
        ('H'::text, c.p_home, b.home_price),
        ('D'::text, c.p_draw, b.draw_price),
        ('A'::text, c.p_away, b.away_price)
      ) as v(pick, fair_prob, best_price)
     where v.best_price > 1
       and c.taken_at < f.commence_at
  ),
  top_market as (
    select m.*,
           row_number() over (
             partition by m.fixture_id order by m.fair_prob desc, m.pick
           ) as fixture_rank
      from market m
  ),
  historical_market as (
    select m.*,
           date_trunc('week', m.commence_at at time zone 'UTC')::date as week_start
      from top_market m
     where m.fixture_rank = 1
       and m.completed
       and m.actual is not null
       and m.commence_at < now()
  ),
  hist_safe_sport as (
    select h.*,
           row_number() over (
             partition by h.week_start, h.sport_key
             order by h.fair_prob desc, h.fixture_id
           ) as sport_rank
      from historical_market h
  ),
  hist_safe as (
    select 'safe'::text as profile, h.*,
           row_number() over (
             partition by h.week_start order by h.fair_prob desc, h.fixture_id
           ) as ticket_rank
      from hist_safe_sport h
     where h.sport_rank = 1
  ),
  hist_diverse_pick as (
    select h.*,
           row_number() over (
             partition by h.week_start, h.pick order by h.fair_prob desc, h.fixture_id
           ) as pick_rank
      from historical_market h
  ),
  hist_diverse_sport as (
    select h.*,
           row_number() over (
             partition by h.week_start, h.sport_key
             order by h.fair_prob desc, h.fixture_id
           ) as sport_rank
      from hist_diverse_pick h
     where h.pick_rank = 1
  ),
  hist_diverse as (
    select 'diverse'::text as profile, h.*,
           row_number() over (
             partition by h.week_start order by h.fair_prob desc, h.fixture_id
           ) as ticket_rank
      from hist_diverse_sport h
     where h.sport_rank = 1
  ),
  hist_value_candidates as (
    select h.*,
           date_trunc('week', h.commence_at at time zone 'UTC')::date as week_start,
           public.calibrated_confidence(fp.confidence, 'llm') as model_prob,
           public.calibrated_confidence(fp.confidence, 'llm') - h.fair_prob as edge
      from market h
      join public.forecast_pick fp
        on fp.fixture_id = h.fixture_id
       and fp.model = 'llm'
       and fp.pick = h.pick
       and not fp.backfilled
       and fp.made_at < fp.commence_at
     where h.completed
       and h.actual is not null
       and h.commence_at < now()
       and public.calibrated_confidence(fp.confidence, 'llm') >= h.fair_prob + 0.02
  ),
  hist_value_sport as (
    select h.*,
           row_number() over (
             partition by h.week_start, h.sport_key
             order by h.edge desc, h.fair_prob desc, h.fixture_id
           ) as sport_rank
      from hist_value_candidates h
  ),
  hist_value as (
    select 'value'::text as profile, h.*,
           row_number() over (
             partition by h.week_start order by h.edge desc, h.fair_prob desc, h.fixture_id
           ) as ticket_rank
      from hist_value_sport h
     where h.sport_rank = 1
  ),
  hist_legs as (
    select profile, week_start, fixture_id, (actual = pick) as won
      from hist_safe where ticket_rank <= 3
    union all
    select profile, week_start, fixture_id, (actual = pick)
      from hist_diverse where ticket_rank <= 3
    union all
    select profile, week_start, fixture_id, (actual = pick)
      from hist_value where ticket_rank <= 3
  ),
  hist_tickets as (
    select profile, week_start, count(*) as legs, bool_and(won) as won
      from hist_legs
     group by profile, week_start
    having count(*) = 3
  ),
  hist_summary as (
    select profile,
           count(*)::integer as historical_tickets,
           count(*) filter (where won)::integer as historical_wins,
           case when count(*) >= 10
                then round(100.0 * count(*) filter (where won) / nullif(count(*), 0), 2)
                else null end as historical_hit_rate
      from hist_tickets
     group by profile
  ),
  upcoming_market as (
    select m.*
      from top_market m
     where m.fixture_rank = 1
       and m.commence_at > now()
       and m.commence_at < now() + make_interval(hours => greatest(24, least(coalesce(p_hours, 168), 720)))
  ),
  safe_sport as (
    select u.*,
           row_number() over (
             partition by u.sport_key order by u.fair_prob desc, u.commence_at, u.fixture_id
           ) as sport_rank
      from upcoming_market u
     where u.fair_prob >= 0.55
  ),
  safe_candidates as (
    select 'safe'::text as profile, s.*,
           s.fair_prob as edge,
           row_number() over (
             order by s.fair_prob desc, s.commence_at, s.fixture_id
           ) as ticket_rank
      from safe_sport s
     where s.sport_rank = 1
  ),
  diverse_pick as (
    select u.*,
           row_number() over (
             partition by u.pick order by u.fair_prob desc, u.commence_at, u.fixture_id
           ) as pick_rank
      from upcoming_market u
  ),
  diverse_sport as (
    select d.*,
           row_number() over (
             partition by d.sport_key order by d.fair_prob desc, d.commence_at, d.fixture_id
           ) as sport_rank
      from diverse_pick d
     where d.pick_rank = 1
  ),
  diverse_candidates as (
    select 'diverse'::text as profile, d.*,
           d.fair_prob as edge,
           row_number() over (
             order by d.fair_prob desc, d.commence_at, d.fixture_id
           ) as ticket_rank
      from diverse_sport d
     where d.sport_rank = 1
  ),
  value_base as (
    select u.*, public.calibrated_confidence(fp.confidence, 'llm') as model_prob,
           public.calibrated_confidence(fp.confidence, 'llm') - u.fair_prob as edge
      from market u
      join public.forecast_pick fp
        on fp.fixture_id = u.fixture_id
       and fp.model = 'llm'
       and fp.pick = u.pick
       and not fp.backfilled
       and fp.made_at < fp.commence_at
     where u.commence_at > now()
       and u.commence_at < now() + make_interval(hours => greatest(24, least(coalesce(p_hours, 168), 720)))
       and public.calibrated_confidence(fp.confidence, 'llm') >= u.fair_prob + 0.02
  ),
  value_sport as (
    select v.*,
           row_number() over (
             partition by v.sport_key order by v.edge desc, v.fair_prob desc, v.commence_at
           ) as sport_rank
      from value_base v
  ),
  value_candidates as (
    select 'value'::text as profile, v.*,
           row_number() over (
             order by v.edge desc, v.fair_prob desc, v.commence_at, v.fixture_id
           ) as ticket_rank
      from value_sport v
     where v.sport_rank = 1
  ),
  current_legs as (
    select profile, fixture_id, commence_at, sport_key, home_team, away_team,
           pick, best_price, fair_prob, books, edge, ticket_rank
      from safe_candidates where ticket_rank <= 3
    union all
    select profile, fixture_id, commence_at, sport_key, home_team, away_team,
           pick, best_price, fair_prob, books, edge, ticket_rank
      from diverse_candidates where ticket_rank <= 3
    union all
    select profile, fixture_id, commence_at, sport_key, home_team, away_team,
           pick, best_price, fair_prob, books, edge, ticket_rank
      from value_candidates where ticket_rank <= 3
  ),
  bundles as (
    select l.profile,
           count(*)::integer as leg_count,
           round(exp(sum(ln(l.fair_prob)))::numeric, 6) as fair_probability,
           round(exp(sum(ln(l.best_price)))::numeric, 3) as combined_odds,
           round(exp(sum(ln(l.fair_prob * l.best_price)))::numeric, 4) as expected_return,
           jsonb_agg(jsonb_build_object(
             'fixture_id', l.fixture_id,
             'commence_at', l.commence_at,
             'sport_key', l.sport_key,
             'home_team', l.home_team,
             'away_team', l.away_team,
             'pick', l.pick,
             'price', l.best_price,
             'fair_prob', l.fair_prob,
             'books', l.books,
             'edge', l.edge
           ) order by l.commence_at, l.fixture_id) as legs
      from current_legs l
     group by l.profile
    )
  select b.profile, b.leg_count, b.fair_probability, b.combined_odds,
         b.expected_return,
         coalesce(h.historical_tickets, 0),
         coalesce(h.historical_wins, 0),
         h.historical_hit_rate,
         b.legs
    from bundles b
    left join hist_summary h using (profile)
   where b.leg_count = 3
   order by h.historical_hit_rate desc nulls last,
            h.historical_tickets desc,
            b.expected_return desc;
end;
$$;

revoke all on function public.admin_diverse_accumulators(text, integer) from public;
grant execute on function public.admin_diverse_accumulators(text, integer)
  to anon, authenticated, service_role;
