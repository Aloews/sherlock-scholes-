begin;

do $$
declare
  v_config text[];
begin
  select proconfig into v_config
    from pg_proc
   where oid = 'public.rebuild_club_matches()'::regprocedure;
  if not exists (
    select 1 from unnest(coalesce(v_config, '{}'::text[])) setting
     where setting = 'statement_timeout=30s'
  ) then
    raise exception 'club-match maintenance function must override PostgREST statement timeout with a 30s ceiling';
  end if;
  if not exists (
    select 1 from unnest(coalesce(v_config, '{}'::text[])) setting
     where setting = 'work_mem=64MB'
  ) then
    raise exception 'club-match maintenance function must use bounded 64MB work_mem for its batch sort';
  end if;
end $$;

rollback;
