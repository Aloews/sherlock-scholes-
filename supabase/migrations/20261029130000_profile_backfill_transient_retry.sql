-- Keep queue refill bounded and index-friendly. The previous implementation built
-- every photo/stat candidate, deduplicated the union, then filtered and sorted it.
-- On the production catalogue this exceeded Supabase's statement timeout before
-- the worker could claim any jobs. Select a bounded, priority-ordered slice per
-- task type, using the existing cards/jobs/player-season indexes.
create index if not exists profile_backfill_pending_task_idx
  on public.profile_backfill_jobs (task_type, status)
  where status in ('pending', 'running');

create index if not exists profile_backfill_retry_task_idx
  on public.profile_backfill_jobs (task_type, updated_at, priority desc, id)
  where status = 'failed';

create or replace function public.enqueue_profile_backfill_jobs(p_limit integer default 1000)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_inserted integer := 0;
  v_requeued integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'p_limit must be between 1 and 1000' using errcode = '22023';
  end if;

  -- Retry transient source failures after a short cooldown even when the main
  -- pending queue is large. Permanent failures retain a seven-day cooldown.
  with retry_candidates as (
    select j.id
      from public.profile_backfill_jobs j
     where j.task_type in ('photo_qid', 'photo_tm', 'season_stats')
       and j.status = 'failed'
       and j.updated_at <= now() - case
         when coalesce(j.last_error, '') ~* '(transient|timeout|http 5[0-9][0-9]|profile fetches were lost|temporarily unavailable|connection reset|transient_empty_response)'
           then interval '1 hour'
         else interval '7 days'
       end
     order by j.priority desc, j.updated_at asc, j.id
     limit least(p_limit, 100)
  ),
  requeued as (
    update public.profile_backfill_jobs j
       set status = 'pending', attempts = 0, max_attempts = 3,
           last_error = null, verified_at = null, updated_at = now()
      from retry_candidates r
     where j.id = r.id
    returning 1
  )
  select count(*) into v_requeued from requeued;

  with qid_candidates as (
    select c.id as card_id, 'photo_qid'::text as task_type,
           c.transfermarkt_id::text as transfermarkt_id,
           c.wikidata_qid::text as wikidata_qid,
           coalesce(c.market_value_eur, 0)::numeric + 1500000000 as priority
      from public.cards c
     where c.category = 'player' and c.active is true
       and nullif(btrim(c.photo_url), '') is null
       and nullif(btrim(c.wikidata_qid::text), '') is not null
       -- Do not scan the catalogue while this task type already has a backlog.
       and (select count(*) from public.profile_backfill_jobs backlog where backlog.task_type = 'photo_qid' and backlog.status in ('pending', 'running')) < 500
       and not exists (
         select 1 from public.profile_backfill_jobs j
          where j.card_id = c.id and j.task_type = 'photo_qid'
            and (
              j.status in ('pending', 'running')
              or (j.status = 'succeeded' and j.updated_at > now() - interval '30 days')
              or (j.status = 'no_data'
                  and coalesce(j.last_error, '') not like 'Transfermarkt photo collector skips cards linked to Soccer Wiki%'
                  and j.updated_at > now() - interval '7 days')
              or (j.status = 'failed' and j.updated_at > now() - interval '7 days')
            )
       )
     order by c.market_value_eur desc nulls last, c.id
     limit p_limit
  ),
  tm_candidates as (
    select c.id as card_id, 'photo_tm'::text as task_type,
           c.transfermarkt_id::text as transfermarkt_id,
           c.wikidata_qid::text as wikidata_qid,
           coalesce(c.market_value_eur, 0)::numeric + 1000000000 as priority
      from public.cards c
     where c.category = 'player' and c.active is true
       and nullif(btrim(c.photo_url), '') is null
       and nullif(btrim(c.transfermarkt_id::text), '') is not null
       -- Refill this source only after its existing queue has drained.
       and (select count(*) from public.profile_backfill_jobs backlog where backlog.task_type = 'photo_tm' and backlog.status in ('pending', 'running')) < 500
       and not exists (
         select 1 from public.profile_backfill_jobs j
          where j.card_id = c.id and j.task_type = 'photo_tm'
            and (
              j.status in ('pending', 'running')
              or (j.status = 'succeeded' and j.updated_at > now() - interval '30 days')
              or (j.status = 'no_data'
                  and coalesce(j.last_error, '') not like 'Transfermarkt photo collector skips cards linked to Soccer Wiki%'
                  and j.updated_at > now() - interval '7 days')
              or (j.status = 'failed' and j.updated_at > now() - interval '7 days')
            )
       )
     order by c.market_value_eur desc nulls last, c.id
     limit p_limit
  ),
  stats_candidates as (
    select c.id as card_id, 'season_stats'::text as task_type,
           c.transfermarkt_id::text as transfermarkt_id,
           c.wikidata_qid::text as wikidata_qid,
           coalesce(c.market_value_eur, 0)::numeric as priority
      from public.cards c
     where c.category = 'player' and c.active is true
       and nullif(btrim(c.transfermarkt_id::text), '') is not null
       -- The scheduled season-stat batch is separate; avoid scanning 500k stats
       -- while the queue already contains unprocessed season-stat tasks.
       and (select count(*) from public.profile_backfill_jobs backlog where backlog.task_type = 'season_stats' and backlog.status in ('pending', 'running')) < 500
       and not exists (
         select 1 from public.player_season_stat s
          where s.tm_player_id = c.transfermarkt_id::text
       )
       and not exists (
         select 1 from public.profile_backfill_jobs j
          where j.card_id = c.id and j.task_type = 'season_stats'
            and (
              j.status in ('pending', 'running')
              or (j.status = 'succeeded' and j.updated_at > now() - interval '30 days')
              or (j.status = 'no_data'
                  and coalesce(j.last_error, '') not like 'Transfermarkt photo collector skips cards linked to Soccer Wiki%'
                  and j.updated_at > now() - interval '7 days')
              or (j.status = 'failed' and j.updated_at > now() - interval '7 days')
            )
       )
     order by c.market_value_eur desc nulls last, c.id
     limit p_limit
  ),
  limited as (
    select * from (
      select * from qid_candidates
      union all select * from tm_candidates
      union all select * from stats_candidates
    ) candidates
    order by priority desc, card_id, task_type
    limit p_limit
  ),
  inserted as (
    insert into public.profile_backfill_jobs
      (card_id, task_type, transfermarkt_id, wikidata_qid, priority)
    select card_id, task_type, transfermarkt_id, wikidata_qid, priority from limited
    on conflict (card_id, task_type) do update
      set status = 'pending', attempts = 0, max_attempts = 3,
          last_error = null, verified_at = null, priority = excluded.priority,
          transfermarkt_id = excluded.transfermarkt_id,
          wikidata_qid = excluded.wikidata_qid, updated_at = now()
      where profile_backfill_jobs.status in ('no_data', 'failed', 'succeeded')
    returning 1
  )
  select count(*) into v_inserted from inserted;

  return v_inserted + v_requeued;
end;
$function$;

comment on function public.enqueue_profile_backfill_jobs(integer) is
  'Enqueue a bounded, priority-ordered batch of photo and missing-season-stat tasks.';
