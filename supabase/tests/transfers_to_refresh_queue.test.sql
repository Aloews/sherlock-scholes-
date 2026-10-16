do $$
declare
  v_count integer;
begin
  select count(*) into v_count
    from public.transfers_to_refresh(600000, 0, 100);

  if v_count <> 1 or not exists (
    select 1
      from public.transfers_to_refresh(600000, 0, 100)
     where card_id = '10000000-0000-0000-0000-000000000001'::uuid
  ) then
    raise exception 'new-history queue must return only eligible players without history; got % rows', v_count;
  end if;

  select count(*) into v_count
    from public.transfers_to_refresh(600000, 90, 100);

  if v_count <> 1 or not exists (
    select 1
      from public.transfers_to_refresh(600000, 90, 100)
     where card_id = '10000000-0000-0000-0000-000000000002'::uuid
  ) then
    raise exception 'stale-history queue must return only existing history older than 90 days; got % rows', v_count;
  end if;

  if exists (
    select 1
      from public.transfers_to_refresh(600000, 90, 100)
     where card_id in (
       '10000000-0000-0000-0000-000000000001'::uuid,
       '10000000-0000-0000-0000-000000000003'::uuid
     )
  ) then
    raise exception 'stale-history queue incorrectly returned a player without history or with fresh history';
  end if;
end;
$$;
