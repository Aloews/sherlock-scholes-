alter table public.profile_backfill_jobs
  drop constraint if exists profile_backfill_jobs_task_type_check;

alter table public.profile_backfill_jobs
  add constraint profile_backfill_jobs_task_type_check
  check (task_type = any (array['photo_tm'::text,'photo_qid'::text,'photo_sw'::text,'season_stats'::text]));

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
