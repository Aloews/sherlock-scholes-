-- Read-only profile completeness and quality report.

select count(*) as active_players,
 count(*) filter(where nullif(btrim(photo_url),'') is not null) as with_photo_url,
 count(*) filter(where nullif(btrim(photo_url),'') is null) as missing_photo_url,
 count(*) filter(where nullif(btrim(transfermarkt_id::text),'') is not null) as with_transfermarkt_id,
 count(*) filter(where nullif(btrim(wikidata_qid::text),'') is not null) as with_wikidata_qid,
 count(*) filter(where career_stats is not null and career_stats <> '{}'::jsonb) as with_career_stats_json,
 count(*) filter(where born_on is not null) as with_birth_date
from public.cards where category='player' and active is true;

select count(*) filter(where nullif(btrim(c.photo_url),'') is null) as missing_photo,
 count(*) filter(where nullif(btrim(c.photo_url),'') is null and nullif(btrim(c.transfermarkt_id::text),'') is not null) as missing_photo_tm,
 count(*) filter(where nullif(btrim(c.photo_url),'') is null and nullif(btrim(c.wikidata_qid::text),'') is not null) as missing_photo_qid,
 count(*) filter(where nullif(btrim(c.photo_url),'') is null and nullif(btrim(c.transfermarkt_id::text),'') is null and nullif(btrim(c.wikidata_qid::text),'') is null) as missing_photo_without_source,
 count(*) filter(where nullif(btrim(c.transfermarkt_id::text),'') is not null and not exists(select 1 from public.player_season_stat s where s.tm_player_id=c.transfermarkt_id::text)) as missing_season_stats_with_tm,
 count(*) filter(where not exists(select 1 from public.player_match_stats s where s.card_id=c.id)) as missing_match_stats
from public.cards c where c.category='player' and c.active is true;

select count(*) as season_rows,count(distinct tm_player_id) as players,min(season_id) as first_season,
 max(season_id) as last_season,max(fetched_at) as latest_fetch from public.player_season_stat;

select source,count(*) filter(where match_date>current_date) as future_rows,
 count(*) filter(where match_date<date '2000-01-01') as pre_2000_rows,
 count(*) filter(where minutes is null and goals=0 and assists=0 and yellow=0 and red=0) as empty_stat_lines,
 count(*) as total_rows from public.player_match_stats group by source order by total_rows desc;

-- 5. Per-card report for CSV/export. Export this query as CSV to review all affected player cards.
select c.id,coalesce(nullif(c.name_en,''),c.name) as player_name,c.transfermarkt_id,c.wikidata_qid,
       c.market_value_eur,c.photo_url,c.photo_source,c.born_on,c.country,c.position_ru,
       (nullif(btrim(c.photo_url),'') is null) as missing_photo,
       (nullif(btrim(c.transfermarkt_id::text),'') is null) as missing_transfermarkt_id,
       (nullif(btrim(c.wikidata_qid::text),'') is null) as missing_wikidata_qid,
       (c.career_stats is null or c.career_stats='{}'::jsonb) as missing_career_stats_json,
       (nullif(btrim(c.transfermarkt_id::text),'') is not null and not exists
          (select 1 from public.player_season_stat s where s.tm_player_id=c.transfermarkt_id::text)) as missing_season_stats,
       (not exists(select 1 from public.player_match_stats m where m.card_id=c.id)) as missing_match_stats
from public.cards c
where c.category='player' and c.active is true
  and (nullif(btrim(c.photo_url),'') is null
       or c.career_stats is null or c.career_stats='{}'::jsonb
       or not exists(select 1 from public.player_match_stats m where m.card_id=c.id)
       or (nullif(btrim(c.transfermarkt_id::text),'') is not null
           and not exists(select 1 from public.player_season_stat s where s.tm_player_id=c.transfermarkt_id::text)))
order by c.market_value_eur desc nulls last,c.name;
-- Optional after migration 20261014140000_profile_backfill_multimarket_finetune.sql:
-- select task_type,status,count(*) as jobs,min(created_at) as oldest_job,
--        max(updated_at) as latest_update,sum(attempts) as attempts
-- from public.profile_backfill_jobs group by task_type,status order by task_type,status;
