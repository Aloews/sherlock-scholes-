-- Признаки матча БЕЗ УТЕЧКИ — для опыта «кто удачнее обучается».
--
-- Окно каждой команды кончается за СУТКИ до матча, поэтому ни одна строка не
-- видит ни себя, ни одноклубников того же дня. На этом представлении считался
-- docs/experiments/duel_learning.py — линейная голова против резервуара.
--
-- Анониму не отдаётся: это служебный срез, а не экран.
create or replace view public.duel_features as
  with games as (
    select m.match_date, m.home_key, m.away_key,
           m.home_score::numeric hs, m.away_score::numeric as_,
           (m.home_score + m.away_score)::numeric total
      from club_match m
     where m.home_score is not null and m.away_score is not null
       and m.home_key <> m.away_key and m.match_date >= current_date - 400),
  sides as (
    select match_date, home_key club, hs gf, as_ ga from games
    union all
    select match_date, away_key, as_, hs from games),
  roll as (
    select club, match_date,
           avg(gf) over w gf_pm, avg(ga) over w ga_pm,
           count(*) over w n, stddev_samp(gf + ga) over w sd
      from sides
    window w as (partition by club order by match_date
                 range between interval '400 days' preceding
                           and interval '1 day' preceding))
  select g.match_date, g.total,
         round(rh.gf_pm, 4) as h_gf, round(rh.ga_pm, 4) as h_ga,
         round(ra.gf_pm, 4) as a_gf, round(ra.ga_pm, 4) as a_ga,
         rh.n as h_n, ra.n as a_n,
         round(coalesce(rh.sd, 0), 4) as h_sd, round(coalesce(ra.sd, 0), 4) as a_sd
    from games g
    join roll rh on rh.club = g.home_key and rh.match_date = g.match_date
    join roll ra on ra.club = g.away_key and ra.match_date = g.match_date
   where rh.n >= 10 and ra.n >= 10;

comment on view public.duel_features is
  'Признаки матча без утечки — для опыта «линейная голова против резервуара».';

revoke all on public.duel_features from public, anon, authenticated;
grant select on public.duel_features to service_role;
