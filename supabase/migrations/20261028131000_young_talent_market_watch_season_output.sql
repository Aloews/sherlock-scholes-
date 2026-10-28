-- Expose the season-output fields already stored in the daily youth snapshots.
-- Keep the existing view column order intact and append new fields for PostgREST.
create or replace view public.young_talent_market_watch as
with movement as (
  select s.*,
         lag(s.market_value_eur) over (
           partition by s.card_id order by s.snapshot_date
         ) as previous_market_value_eur,
         lag(s.snapshot_date) over (
           partition by s.card_id order by s.snapshot_date
         ) as previous_snapshot_date,
         count(*) over (
           partition by s.card_id order by s.snapshot_date
           rows between unbounded preceding and current row
         ) as snapshots_seen
    from public.young_talent_market_snapshot s
), scored as (
  select m.*,
         case
           when previous_market_value_eur is null or previous_market_value_eur <= 0 then null
           else round(100.0 * (market_value_eur - previous_market_value_eur)
                      / previous_market_value_eur, 2)
         end as price_change_pct
    from movement m
)
select snapshot_date, card_id, player_name, age, market_value_eur, market_value_at,
       verified_honours_count, verified_award_wins,
       previous_market_value_eur, previous_snapshot_date, price_change_pct,
       base_score,
       greatest(0::numeric, least(100::numeric,
         base_score + greatest(-10::numeric, least(20::numeric,
           coalesce(price_change_pct, 0) * 0.5
         ))
       ))::numeric(6,3) as score,
       case
         when snapshots_seen >= 3
          and market_value_at >= snapshot_date - 45
          and verified_honours_count > 0
          and season_stats_fetched_at >= (snapshot_date - 14)::timestamptz
           then 'high'
         when snapshots_seen >= 2 and market_value_at >= snapshot_date - 90 then 'medium'
         else 'low'
       end as confidence,
       score_components || jsonb_build_object(
         'market_value_age_days', snapshot_date - market_value_at,
         'price_change_pct', price_change_pct,
         'momentum_score', greatest(-10::numeric, least(20::numeric,
           coalesce(price_change_pct, 0) * 0.5
         )),
         'previous_market_value_eur', previous_market_value_eur,
         'snapshots_seen', snapshots_seen
       ) as score_components,
       source_url, model_version, source_fetched_at,
       season_apps, season_goals, season_assists, season_minutes, season_stats_fetched_at
  from scored;

revoke all on public.young_talent_market_watch from anon, authenticated;
grant select on public.young_talent_market_watch to service_role;
notify pgrst, 'reload schema';
