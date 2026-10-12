-- Regression: a Russian alias must not map a Chinese club into RPL standings.
begin;

do $$
declare
  v_bad_alias integer;
  v_bad_club integer;
  v_bad_standing integer;
  v_bad_match integer;
  v_krasnodar_place integer;
begin
  select count(*) into v_bad_alias
    from public.club_name_seen
   where team = 'Краснодар' and scope = 'Россия'
     and club_key is distinct from 'krasnodar';
  if v_bad_alias <> 0 then
    raise exception 'RPL alias regression: Краснодар maps to % wrong keys', v_bad_alias;
  end if;

  select count(*) into v_bad_club
    from public.football_club
   where club_key = 'tianjin jinmen tiger'
     and (country is distinct from 'Китай' or league is distinct from 'Китай. Суперлига');
  if v_bad_club <> 0 then
    raise exception 'Tianjin metadata regression: club is not classified as China';
  end if;

  select count(*) into v_bad_standing
    from public.league_table('Russian Premier League', 'ru')
   where club_key = 'tianjin jinmen tiger';
  if v_bad_standing <> 0 then
    raise exception 'RPL standings regression: Chinese club appears in the table';
  end if;

  select count(*) into v_bad_match
    from public.club_match
   where (home_key = 'tianjin jinmen tiger' or away_key = 'tianjin jinmen tiger')
     and (
       tournament ilike 'Россия.%'
       or tournament ilike 'Russian Premier League%'
       or tournament ilike 'Russian Cup%'
     );
  if v_bad_match <> 0 then
    raise exception 'RPL source regression: % Russian matches still use Tianjin key', v_bad_match;
  end if;

  select place into v_krasnodar_place
    from public.league_table('Russian Premier League', 'ru')
   where club_key = 'krasnodar';
  if v_krasnodar_place is null then
    raise exception 'RPL standings regression: Krasnodar is missing';
  end if;
end;
$$;

rollback;
