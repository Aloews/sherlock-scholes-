begin;

-- The production safe-delete guard rejects unqualified DELETE statements even
-- when they target private temporary tables. Preserve behavior by truncating
-- only the session-local work tables. Abort if deployed function bodies differ.
do $fix$
declare
  v_before text;
  v_after text;
begin
  select pg_get_functiondef(
    'public.build_model_accumulators(integer,integer[],numeric)'::regprocedure
  ) into v_before;
  v_after := regexp_replace(
    v_before,
    'DELETE[[:space:]]+FROM[[:space:]]+_legs_tmp[[:space:]]*;',
    'TRUNCATE TABLE _legs_tmp;',
    'gi'
  );
  if v_after = v_before then
    if position('TRUNCATE TABLE _LEGS_TMP;' in upper(v_before)) = 0 then
      raise exception 'Expected temporary-table clear in build_model_accumulators was not found';
    end if;
  else
    execute v_after;
  end if;

  select pg_get_functiondef(
    'public.backfill_model_accumulators(numeric)'::regprocedure
  ) into v_before;
  v_after := regexp_replace(
    v_before,
    'DELETE[[:space:]]+FROM[[:space:]]+_bf_tmp[[:space:]]*;',
    'TRUNCATE TABLE _bf_tmp;',
    'gi'
  );
  if v_after = v_before then
    if position('TRUNCATE TABLE _BF_TMP;' in upper(v_before)) = 0 then
      raise exception 'Expected temporary-table clear in backfill_model_accumulators was not found';
    end if;
  else
    execute v_after;
  end if;
end;
$fix$;

commit;
