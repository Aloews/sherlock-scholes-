begin;

do $$
declare
  v_player_id bigint;
  v_attempt integer;
begin
  select coalesce(max(id) + 1, 1) into v_player_id from public.players;
  insert into public.players (id, first_name) values (v_player_id, 'quota-test');

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
