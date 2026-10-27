begin;

insert into public.cards (id, category, active, name_en, top_league) values
  ('00000000-0000-0000-0000-000000000001', 'player', true, 'Arsenal player one', 'Premier League'),
  ('00000000-0000-0000-0000-000000000002', 'player', true, 'Arsenal player two', 'Premier League'),
  ('00000000-0000-0000-0000-000000000003', 'player', true, 'Barcelona player', 'La Liga'),
  ('00000000-0000-0000-0000-000000000101', 'club', true, 'Arsenal', null),
  ('00000000-0000-0000-0000-000000000102', 'club', true, 'Barcelona', null);

insert into public.card_current_club (card_id, club, club_key) values
  ('00000000-0000-0000-0000-000000000001', 'Arsenal', 'arsenal'),
  ('00000000-0000-0000-0000-000000000002', 'Arsenal', 'arsenal'),
  ('00000000-0000-0000-0000-000000000003', 'Barcelona', 'barcelona');

do $$
declare
  v_count integer;
  v_league text;
begin
  select count(*) into v_count
    from public.deck_squad_filters(1)
   where league = 'Premier League';
  if v_count <> 1 then
    raise exception 'Expected Arsenal to be the only Premier League squad, got %', v_count;
  end if;

  select league into v_league
    from public.deck_squad_filters(1)
   where club_key = 'barcelona';
  if v_league is distinct from 'La Liga' then
    raise exception 'Expected Barcelona league La Liga, got %', v_league;
  end if;

  select count(*) into v_count
    from public.deck_squad_filters(2)
   where club_key = 'barcelona';
  if v_count <> 0 then
    raise exception 'Minimum squad threshold was not applied';
  end if;
end $$;

rollback;
