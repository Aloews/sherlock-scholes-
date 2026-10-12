begin;

do $$
declare
  v_player_id bigint;
  v_attempt integer;
begin
  select id into v_player_id from public.players order by id limit 1;
  if v_player_id is null then
    raise exception 'smart deck quota test requires a player fixture';
  end if;

  delete from public.smart_deck_builder_usage where player_id = v_player_id;

  for v_attempt in 1..10 loop
    if public.consume_smart_deck_builder_quota(v_player_id) is not true then
      raise exception 'quota rejected allowed request %', v_attempt;
    end if;
  end loop;

  if public.consume_smart_deck_builder_quota(v_player_id) is not false then
    raise exception 'quota accepted request 11';
  end if;
end;
$$;

rollback;
