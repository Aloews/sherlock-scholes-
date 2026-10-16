-- Disposable stand-ins for the deployed accumulator RPC signatures.
-- The migration must replace unqualified DELETEs of private temp work tables.
create or replace function public.build_model_accumulators(integer, integer[], numeric)
returns void language plpgsql as $$
begin
  delete from _legs_tmp;
end;
$$;

create or replace function public.backfill_model_accumulators(numeric)
returns void language plpgsql as $$
begin
  delete from _bf_tmp;
end;
$$;
