-- Regression: the RPL table must combine ESPN and sports.ru labels, without foreign clubs.
begin;

do $$
declare
  v_teams integer;
  v_max_played integer;
  v_foreign integer;
begin
  select count(*), coalesce(max(played), 0)
    into v_teams, v_max_played
    from public.league_table('Russian Premier League', 'ru');

  if v_teams < 14 then
    raise exception 'RPL table is incomplete: only % clubs returned', v_teams;
  end if;
  if v_max_played < 8 then
    raise exception 'RPL table did not combine source labels: max played=%', v_max_played;
  end if;

  select count(*) into v_foreign
    from public.league_table('Russian Premier League', 'ru')
   where club_key = 'tianjin jinmen tiger';
  if v_foreign <> 0 then
    raise exception 'Chinese club leaked into RPL standings';
  end if;
end;
$$;

rollback;
