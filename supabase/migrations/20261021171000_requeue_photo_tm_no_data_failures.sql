-- Jobs created by the old Transfermarkt collector classified a confirmed
-- zero-photo result as a transport failure and exhausted all attempts. The new
-- collector distinguishes permanent no-profile responses from transport loss.
-- Requeue only those terminal jobs whose audit explicitly shows both the old
-- generic error and a zero-photo Wikidata fallback.
update public.profile_backfill_jobs
   set status = 'pending',
       attempts = 0,
       last_error = null,
       verified_at = null,
       updated_at = now() - interval '61 minutes'
 where task_type = 'photo_tm'
   and status = 'failed'
   and attempts >= max_attempts
   and last_error ilike '%No player portraits were written; investigate source access or candidate selection.%'
   and last_error ilike '%Wikidata fallback attempt:%'
   and last_error ilike '%фото найдено%0%';

-- Soccer Wiki detail scraping may add a portrait after a photo_sw job already
-- returned no_data. Re-open that job immediately only when the source record's
-- detail_at is newer than the job result; unchanged bad/ambiguous URLs keep
-- their cooldown and cannot starve the queue.
alter table public.soccerwiki_player
  add column if not exists detail_at timestamptz;

create or replace function public.enqueue_profile_backfill_jobs(p_limit integer default 50000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100000 then
    raise exception 'p_limit must be between 1 and 100000' using errcode = '22023';
  end if;

  with raw_candidates as (
    select c.id card_id, 'photo_sw'::text task_type,
           c.transfermarkt_id::text transfermarkt_id,
           c.wikidata_qid::text wikidata_qid,
           coalesce(c.market_value_eur,0)::numeric + 1500000000 priority
      from cards c
      join soccerwiki_player sw on sw.card_id=c.id
     where c.category='player' and c.active is true
       and nullif(btrim(c.photo_url),'') is null
       and nullif(btrim(sw.photo_url),'') is not null
    union all
    select c.id, 'photo_tm', c.transfermarkt_id::text, c.wikidata_qid::text,
           coalesce(c.market_value_eur,0)::numeric + 1000000000
      from cards c
     where c.category='player' and c.active is true
       and nullif(btrim(c.photo_url),'') is null
       and nullif(btrim(c.transfermarkt_id::text),'') is not null
    union all
    select c.id, 'photo_qid', c.transfermarkt_id::text, c.wikidata_qid::text,
           coalesce(c.market_value_eur,0)::numeric + 500000000
      from cards c
     where c.category='player' and c.active is true
       and nullif(btrim(c.photo_url),'') is null
       and nullif(btrim(c.wikidata_qid::text),'') is not null
    union all
    select c.id, 'season_stats', c.transfermarkt_id::text, c.wikidata_qid::text,
           coalesce(c.market_value_eur,0)::numeric
      from cards c
     where c.category='player' and c.active is true
       and nullif(btrim(c.transfermarkt_id::text),'') is not null
       and not exists (
         select 1 from player_season_stat s
          where s.tm_player_id=c.transfermarkt_id::text
       )
  ), candidates as (
    select distinct on (card_id, task_type)
           card_id, task_type, transfermarkt_id, wikidata_qid, priority
      from raw_candidates
     order by card_id, task_type, priority desc
  ), eligible as (
    select c.*
      from candidates c
     where not exists (
       select 1 from profile_backfill_jobs j
        where j.card_id=c.card_id and j.task_type=c.task_type
          and (
            j.status in ('pending','running')
            or (j.status='succeeded' and j.updated_at > now()-interval '30 days')
            or (
              j.status='no_data'
              and coalesce(j.last_error,'') not like 'Transfermarkt photo collector skips cards linked to Soccer Wiki%'
              and j.updated_at > now()-interval '7 days'
              and not (
                j.task_type='photo_sw'
                and exists (
                  select 1 from public.soccerwiki_player sw
                   where sw.card_id=j.card_id
                     and nullif(btrim(sw.photo_url),'') is not null
                     and sw.detail_at > j.updated_at
                )
              )
            )
            or (
              j.status='failed'
              and j.updated_at > now()-interval '7 days'
              and not (
                j.task_type='photo_sw'
                and exists (
                  select 1 from public.soccerwiki_player sw
                   where sw.card_id=j.card_id
                     and nullif(btrim(sw.photo_url),'') is not null
                     and sw.detail_at > j.updated_at
                )
              )
            )
          )
     )
  ), limited as (
    select * from eligible
     order by priority desc, card_id, task_type
     limit p_limit
  ), inserted as (
    insert into profile_backfill_jobs(card_id,task_type,transfermarkt_id,wikidata_qid,priority)
    select card_id,task_type,transfermarkt_id,wikidata_qid,priority from limited
    on conflict(card_id,task_type) do update
      set status='pending', attempts=0, max_attempts=3,
          last_error=null, verified_at=null, priority=excluded.priority,
          transfermarkt_id=excluded.transfermarkt_id,
          wikidata_qid=excluded.wikidata_qid, updated_at=now()
      where profile_backfill_jobs.status in ('no_data','failed','succeeded')
      returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

