begin;
do $$
declare v_build text; v_backfill text;
begin
  select pg_get_functiondef('public.build_model_accumulators(integer,integer[],numeric)'::regprocedure)
    into v_build;
  select pg_get_functiondef('public.backfill_model_accumulators(numeric)'::regprocedure)
    into v_backfill;
  if position('truncate table _legs_tmp;' in lower(v_build)) = 0 then
    raise exception 'build_model_accumulators still contains unsafe temp-table DELETE';
  end if;
  if position('truncate table _bf_tmp;' in lower(v_backfill)) = 0 then
    raise exception 'backfill_model_accumulators still contains unsafe temp-table DELETE';
  end if;
end $$;
rollback;
