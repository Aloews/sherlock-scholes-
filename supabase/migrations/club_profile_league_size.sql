-- ===========================================================================
-- club_profile — место в лиге показывается ВМЕСТЕ С РАЗМЕРОМ ТАБЛИЦЫ.
--
-- Владелец: «в экране „команды и статистика“ много первых мест».
--
-- ⚠️ ЭТО НЕ ОШИБКА РАСЧЁТА, А ОШИБКА ПОДПИСИ. Место считается внутри СВОЕЙ
-- лиги, и лиг в справочнике 62 — значит первых мест ровно 62, по одному на
-- лигу. Замер 03.09.2026:
--
--   лиг всего                    62
--   клубов с подписью «1-е»      62
--   таблиц из 2–4 клубов          9
--   таблиц из 5 и больше         53
--
-- «1-е место» у клуба, в таблице которого три команды, — правда, читающаяся
-- как неправда. Лечится не порогом и не сокрытием, а знаменателем: «1-е из 3»
-- honest сам по себе, и решение, важно это или нет, остаётся за читателем.
-- Прятать данные там, где достаточно их дописать, — худший из двух ходов.
--
-- ⚠️ ФАЙЛ ВОССТАНАВЛИВАЕТ ИСТОЧНИК ПРАВДЫ. В проде функция уже возвращала
-- elo, level, league_weight и league_place, но НИ ОДНА миграция репозитория
-- такой версии не содержала: её накатили мимо файлов. Поэтому здесь выписано
-- определение целиком, а не «добавить колонку» — иначе следующий, кто
-- применит football_clubs.sql, молча откатит прод на четыре колонки назад.
--
-- DROP перед CREATE обязателен: у функции меняется список колонок
-- RETURNS TABLE, а `create or replace` этого не умеет (42P13). Обе команды
-- идут одной миграцией, то есть одной транзакцией.
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
  league_place integer, league_size integer
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
  tbl as (select * from league_table((select league from f), p_lang))
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
         -- Место в таблице своей лиги. NULL, если лиги нет или таблица для
         -- неё не строится: прочерк честнее выдуманного номера.
         (select t.place from tbl t where t.club_key = f.club_key),
         -- Размер той же таблицы. Без него «1-е место» читается как титул.
         nullif((select count(*)::int from tbl), 0)
    from f
    left join club_rating r on r.club_key = f.club_key
$$;

-- Грант перечислен явно: политика без гранта роняла этот проект дважды.
grant execute on function public.club_profile(text, text, integer)
  to anon, authenticated, service_role;
