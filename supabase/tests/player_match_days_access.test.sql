begin;

do $$
declare
  v_options text[];
begin
  if not has_table_privilege('anon', 'public.player_match_days', 'select') then
    raise exception 'anon cannot select canonical player_match_days';
  end if;
  if not has_table_privilege('authenticated', 'public.player_match_days', 'select') then
    raise exception 'authenticated cannot select canonical player_match_days';
  end if;

  select reloptions into v_options
  from pg_class
  where oid = 'public.player_match_days'::regclass;
  if not coalesce(v_options @> array['security_invoker=true'], false) then
    raise exception 'player_match_days must execute with invoker privileges';
  end if;
end;
$$;

insert into public.cards (id, name, category, active)
values ('10000000-0000-0000-0000-000000000091', 'Match Day Access Test', 'player', true)
on conflict (id) do nothing;

insert into public.player_match_stats (
  card_id, match_date, tournament, home_team, away_team,
  minutes, goals, assists, source, disputed
) values
  ('10000000-0000-0000-0000-000000000091', current_date - 1, 'League A', 'Test Club', 'Opponent', 90, 1, 0, 'source-a', false),
  ('10000000-0000-0000-0000-000000000091', current_date - 1, 'League A', 'Test Club', 'Opponent', null, 7, 0, 'source-b', false),
  ('10000000-0000-0000-0000-000000000091', current_date - 2, 'League A', 'Test Club', 'Opponent', 90, 2, 0, 'source-a', true);

set local role anon;
do $$
declare
  v_rows integer;
  v_goals integer;
begin
  select count(*), coalesce(sum(goals), 0)::integer
    into v_rows, v_goals
  from public.player_match_days
  where card_id = '10000000-0000-0000-0000-000000000091';
  if v_rows <> 1 or v_goals <> 1 then
    raise exception 'canonical view must expose one non-disputed row per player/day; got rows %, goals %', v_rows, v_goals;
  end if;
end;
$$;
reset role;

rollback;
