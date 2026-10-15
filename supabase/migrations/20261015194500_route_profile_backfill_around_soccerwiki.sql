-- Route photo backfill away from Transfermarkt profiles that the collector
-- intentionally skips because Soccer Wiki already owns that card.
-- The existing Soccer Wiki enrichment path remains the source of record.
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

  with candidates as (
    select c.id card_id, 'photo_tm'::text task_type,
           c.transfermarkt_id::text transfermarkt_id,
           c.wikidata_qid::text wikidata_qid,
           coalesce(c.market_value_eur,0)::numeric + 1000000000 priority
      from cards c
     where c.category='player' and c.active is true
       and nullif(btrim(c.photo_url),'') is null
       and nullif(btrim(c.transfermarkt_id::text),'') is not null
       and not exists (
         select 1 from soccerwiki_player sw where sw.card_id=c.id
       )
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
  ), eligible as (
    select c.*
      from candidates c
     where not exists (
       select 1 from profile_backfill_jobs j
        where j.card_id=c.card_id and j.task_type=c.task_type
     )
  ), limited as (
    select * from eligible
     order by priority desc, card_id, task_type
     limit p_limit
  ), inserted as (
    insert into profile_backfill_jobs(card_id,task_type,transfermarkt_id,wikidata_qid,priority)
    select card_id,task_type,transfermarkt_id,wikidata_qid,priority from limited
    on conflict(card_id,task_type) do nothing
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted;
end;
$$;

revoke all on function public.enqueue_profile_backfill_jobs(integer) from public, anon, authenticated;
grant execute on function public.enqueue_profile_backfill_jobs(integer) to service_role;

create or replace function public.claim_profile_backfill_jobs(
  p_limit integer default 20,
  p_lease_minutes integer default 45
)
returns setof profile_backfill_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100
     or p_lease_minutes is null or p_lease_minutes < 5 or p_lease_minutes > 240 then
    raise exception 'invalid claim limits' using errcode = '22023';
  end if;

  update profile_backfill_jobs j
     set status='no_data',
         last_error='Transfermarkt photo collector skips cards linked to Soccer Wiki; deferred to the Soccer Wiki enrichment path.',
         updated_at=now(),
         verified_at=now()
   where j.task_type='photo_tm'
     and j.status='pending'
     and exists (select 1 from soccerwiki_player sw where sw.card_id=j.card_id);

  return query
  with candidates as (
    select j.id
      from profile_backfill_jobs j
     where j.attempts < j.max_attempts
       and (j.status='pending' or (j.status='running' and j.updated_at < now()-make_interval(mins=>p_lease_minutes)))
       and not (
         j.task_type='photo_tm'
         and exists (select 1 from soccerwiki_player sw where sw.card_id=j.card_id)
       )
     order by j.priority desc,j.created_at,j.id
     for update skip locked
     limit p_limit
  )
  update profile_backfill_jobs j
     set status='running',attempts=j.attempts+1,updated_at=now(),last_error=null
    from candidates c
   where j.id=c.id
  returning j.*;
end;
$$;

revoke all on function public.claim_profile_backfill_jobs(integer,integer) from public, anon, authenticated;
grant execute on function public.claim_profile_backfill_jobs(integer,integer) to service_role;
