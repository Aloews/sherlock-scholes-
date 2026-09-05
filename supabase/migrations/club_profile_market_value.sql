-- ===========================================================================
-- club_profile — стоимость состава рядом с самим составом.
--
-- Владелец: «стоимость клуба = сумма по составу».
--
-- ⚠️ ЧИСЛО НЕ ХРАНИТСЯ. Оно считается из `club_squad` в момент чтения —
-- иначе сумма под клубом и его же список игроков разошлись бы при первом
-- переходе, и разошлись бы МОЛЧА: оба числа выглядели бы правдоподобно.
--
-- ⚠️ СУММА ЕДЕТ ВМЕСТЕ С ТЕМ, ИЗ СКОЛЬКИХ ОНА СОБРАНА. «€412 млн» по трём
-- оценённым игрокам из двадцати восьми — не стоимость клуба. Это ровно та же
-- ошибка, что «1-е место» без размера таблицы: правда, читающаяся как
-- неправда. Поэтому колонок ДВЕ, и экран обязан показывать обе.
--
-- ⚠️ ФАЙЛ ВОССТАНАВЛИВАЕТ ОПРЕДЕЛЕНИЕ ЦЕЛИКОМ, а не «добавляет колонку»:
-- у club_profile меняется список RETURNS TABLE, `create or replace` этого не
-- умеет (42P13), и следующий, кто применит football_clubs.sql или
-- club_profile_league_size.sql, иначе молча откатит прод назад — так этот
-- проект уже терял четыре колонки.
--
-- Источник стоимости — Transfermarkt, и он назван в COMMENT колонки
-- cards.market_value_eur и на экране рядом с числом.
-- ===========================================================================
drop function if exists public.club_profile(text, text, integer);

create function public.club_profile(p_club_key text, p_lang text default 'ru',
                                    p_days integer default 365)
returns table (
  club_key text, name text, name_en text, card_id uuid,
  country text, league text, crest_url text, kind text,
  squad integer, matches integer, wins integer, draws integer, losses integer,
  goals_for integer, goals_against integer,
  first_match date, last_match date, fetched_at timestamptz,
  elo integer, level smallint, league_weight numeric,
  league_place integer, league_size integer,
  market_value_eur bigint, market_value_priced integer
)
language sql stable security definer set search_path = public as $$
  with f as (select * from football_club where club_key = p_club_key),
  played as (
    select m.match_date,
           case when m.home_key = p_club_key then m.home_score else m.away_score end as gf,
           case when m.home_key = p_club_key then m.away_score else m.home_score end as ga
      from club_match m
     where (m.home_key = p_club_key or m.away_key = p_club_key)
       and m.match_date >= current_date - greatest(coalesce(p_days, 365), 1)
       and m.home_score is not null and m.away_score is not null
  ),
  -- Таблица лиги считается ОДИН раз: и место, и размер берутся из неё же,
  -- иначе «1-е из 3» могло бы разойтись само с собой.
  tbl as (select * from league_table((select league from f), p_lang)),
  -- Стоимость — та же функция, которую зовут и снаружи. Вторая копия суммы
  -- разошлась бы с первой молча.
  mv as (select * from club_market_value(p_club_key))
  select f.club_key,
         club_display_name(f.club_key, p_lang),
         f.name_en, f.card_id, f.country, f.league, f.crest_url, f.kind,
         (select count(*)::int from club_squad q where q.club_key = f.club_key and q.left_at is null),
         (select count(*)::int from played),
         (select count(*)::int from played where gf > ga),
         (select count(*)::int from played where gf = ga),
         (select count(*)::int from played where gf < ga),
         (select coalesce(sum(gf),0)::int from played),
         (select coalesce(sum(ga),0)::int from played),
         (select min(match_date) from played),
         (select max(match_date) from played),
         f.fetched_at,
         r.elo, r.level, r.league_weight,
         (select t.place from tbl t where t.club_key = f.club_key),
         nullif((select count(*)::int from tbl), 0),
         -- NULL, а не ноль: «никого не оценили» и «состав стоит ноль» —
         -- разные ответы, и ноль читался бы как второй.
         nullif((select total_eur from mv), 0),
         (select priced from mv)
    from f
    left join club_rating r on r.club_key = f.club_key
$$;

-- Грант перечислен явно: политика без гранта роняла этот проект дважды.
grant execute on function public.club_profile(text, text, integer)
  to anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
