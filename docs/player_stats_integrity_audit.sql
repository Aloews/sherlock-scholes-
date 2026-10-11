-- Sherlock Scholes: player-stat integrity audit (READ ONLY).
-- Run against production only as SELECTs; no statements here modify data.
-- Run after the rating-cache PR migrations have been reviewed/applied.
-- Date windows deliberately exclude future fixtures.

-- 1) Cache completeness and value drift for every supported window.
with live as (
  select d.card_id, w.days,
         count(*)::int matches,
         sum(coalesce(d.minutes, 0))::int minutes,
         sum(coalesce(d.goals, 0))::int goals,
         sum(coalesce(d.assists, 0))::int assists
    from (values (7), (30), (365)) w(days)
    join public.player_match_days d
      on d.match_date between current_date - w.days and current_date
   group by d.card_id, w.days
  having sum(coalesce(d.goals, 0)) + sum(coalesce(d.assists, 0)) > 0
), joined as (
  select coalesce(l.card_id, c.card_id) card_id,
         coalesce(l.days, c.days) days,
         l.card_id is not null as live_exists,
         c.card_id is not null as cache_exists,
         (l.matches, l.minutes, l.goals, l.assists)
           is distinct from (c.matches, c.minutes, c.goals, c.assists) as differs
    from live l
    full join public.player_rating_cache c
      on c.card_id = l.card_id and c.days = l.days
   where coalesce(l.days, c.days) in (7, 30, 365)
)
select days,
       count(*) filter (where live_exists and not cache_exists) as missing_cache,
       count(*) filter (where cache_exists and not live_exists) as stale_extra,
       count(*) filter (where live_exists and cache_exists and differs) as mismatched
  from joined
 group by days
 order by days;

-- 2) All-age leaders: recent production, last match and identity/club fields.
-- This is a review queue, not a claim that every competition has equal weight.
select c.id, c.name, c.name_en, c.born_on,
       extract(year from age(current_date, c.born_on))::int as age,
       coalesce(cc.club, c.top_club) as displayed_club,
       c.transfermarkt_id,
       count(*) as match_days,
       sum(coalesce(d.minutes, 0)) as minutes,
       sum(coalesce(d.goals, 0)) as goals,
       sum(coalesce(d.assists, 0)) as assists,
       max(d.match_date) as last_match,
       sum(coalesce(d.goals, 0) + coalesce(d.assists, 0))
         filter (where d.match_date >= current_date - 7) as goal_contributions_7d
  from public.player_match_days d
  join public.cards c on c.id = d.card_id
  left join public.card_current_club cc on cc.card_id = c.id
 where c.active and c.category = 'player'
   and d.match_date between current_date - 30 and current_date
 group by c.id, c.name, c.name_en, c.born_on, cc.club, c.top_club, c.transfermarkt_id
 having sum(coalesce(d.goals, 0) + coalesce(d.assists, 0)) > 0
 order by goal_contributions_7d desc nulls last, goals desc, assists desc, minutes desc
 limit 100;

-- 3) Young players (U23 inclusive) with recent contributions.
-- Keep age, minutes and last match together so tiny samples are not mistaken
-- for established form. Review competition and source before changing a card.
select c.id, c.name, c.name_en,
       extract(year from age(current_date, c.born_on))::int as age,
       coalesce(cc.club, c.top_club) as displayed_club,
       c.transfermarkt_id,
       count(*) as match_days,
       sum(coalesce(d.minutes, 0)) as minutes,
       sum(coalesce(d.goals, 0)) as goals,
       sum(coalesce(d.assists, 0)) as assists,
       max(d.match_date) as last_match,
       sum(coalesce(d.goals, 0) + coalesce(d.assists, 0))
         filter (where d.match_date >= current_date - 7) as goal_contributions_7d,
       string_agg(distinct d.tournament, ' | ' order by d.tournament) as competitions
  from public.player_match_days d
  join public.cards c on c.id = d.card_id
  left join public.card_current_club cc on cc.card_id = c.id
 where c.active and c.category = 'player'
   and c.born_on >= current_date - interval '24 years'
   and d.match_date between current_date - 30 and current_date
 group by c.id, c.name, c.name_en, c.born_on, cc.club, c.top_club, c.transfermarkt_id
 having sum(coalesce(d.goals, 0) + coalesce(d.assists, 0)) > 0
 order by goal_contributions_7d desc nulls last, goals desc, assists desc, minutes desc
 limit 100;

-- 4) Identity collisions: duplicate external IDs are stronger evidence than
-- similar names. Do not auto-merge name-only groups; many are real namesakes.
select transfermarkt_id, count(*) as cards,
       array_agg(id order by id) as card_ids,
       array_agg(name_en order by id) as names
  from public.cards
 where active and category = 'player'
   and nullif(trim(transfermarkt_id), '') is not null
 group by transfermarkt_id
having count(*) > 1
 order by cards desc, transfermarkt_id;

-- 5) Duplicate normalized display names for human review (not auto-merge).
select lower(regexp_replace(trim(name_en), '[^[:alnum:]]', '', 'g')) as normalized_name,
       count(*) as cards,
       array_agg(id order by id) as card_ids,
       array_agg(name_en order by id) as names,
       array_agg(transfermarkt_id order by id) as external_ids
  from public.cards
 where active and category = 'player'
 group by 1
having count(*) > 1
 order by cards desc, normalized_name;

-- 6) Missing identity/club metadata among recently active cards.
select c.id, c.name, c.name_en, c.born_on, c.fame, c.market_value_eur,
       c.transfermarkt_id, coalesce(cc.club, fq.name, c.top_club) as club,
       max(d.match_date) as last_match,
       count(*) as match_days,
       sum(coalesce(d.goals, 0)) as goals_30d,
       sum(coalesce(d.assists, 0)) as assists_30d
  from public.cards c
  join public.player_match_days d on d.card_id = c.id
  left join public.card_current_club cc on cc.card_id = c.id
  left join public.club_squad q on q.card_id = c.id and q.left_at is null
  left join public.football_club fq on fq.club_key = q.club_key
 where c.active and c.category = 'player'
   and d.match_date between current_date - 30 and current_date
   and (nullif(trim(c.transfermarkt_id), '') is null
        or coalesce(cc.club, fq.name, c.top_club) is null)
 group by c.id, c.name, c.name_en, c.born_on, c.fame, c.market_value_eur,
          c.transfermarkt_id, cc.club, fq.name, c.top_club
 order by c.fame desc nulls last, c.market_value_eur desc nulls last, last_match desc
 limit 250;

-- 7) Impossible-looking or incomplete rows requiring source review.
-- ESPN minutes can be NULL by design; distinguish unknown from explicit zero.
select s.source, c.id, c.name_en, s.match_date, s.tournament,
       s.home_team, s.away_team, s.home_score, s.away_score,
       s.minutes, s.goals, s.assists, s.disputed, s.fetched_at
  from public.player_match_stats s
  join public.cards c on c.id = s.card_id
 where s.match_date > current_date
    or ((coalesce(s.goals, 0) + coalesce(s.assists, 0)) > 0 and s.minutes = 0)
    or (s.match_date >= current_date - 30 and s.minutes is null
        and coalesce(s.goals, 0) + coalesce(s.assists, 0) > 0)
 order by s.match_date desc, s.source, c.name_en
 limit 500;

-- 8) Source freshness and coverage. Freshness is based on ingestion timestamp,
-- not match_date: schedules can contain future fixtures.
select source, max(fetched_at) as last_ingested_at,
       max(match_date) as latest_match_or_fixture_date,
       count(*) filter (where match_date between current_date - 7 and current_date) as rows_7d,
       count(distinct card_id) filter (where match_date between current_date - 7 and current_date) as cards_7d,
       count(*) filter (where match_date between current_date - 30 and current_date) as rows_30d,
       count(distinct card_id) filter (where match_date between current_date - 30 and current_date) as cards_30d
  from public.player_match_stats
 group by source
 order by last_ingested_at desc;
