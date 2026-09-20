-- Рейтинг игроков падал у двух из трёх: агрегат выливался во временные файлы
-- ===========================================================================
--
-- Владелец: «статистика всё равно иногда не загружается в рейтинге
-- футболистов». Замер 20.09.2026, три вызова подряд анонимным ключом:
--
--     500  3.902s
--     500  3.805s
--     200  1.217s
--
-- Это `player_ratings` за анонимным потолком в три секунды. Под сервисным
-- ключом таймаута нет вовсе, поэтому ни psql, ни MCP поломки не показывали.
--
-- ПРИЧИНА — ШИРОКИЙ КЛЮЧ ГРУППИРОВКИ. Функция группировала сразу по всем
-- показываемым колонкам: `photo_url`, названия обоих клубов, уровень, основа.
-- Агрегат такого размера в память не помещался и уходил на диск — 77 752
-- буфера и `temp read=344 written=345`.
--
-- СТАЛО: сумма берётся по ОДНОМУ `card_id`, а имена, фото и клубы
-- присоединяются уже к готовым строкам. 10 286 буферов вместо 77 752, без
-- временных файлов. После правки одиннадцать вызовов подряд: все 200, от
-- 0.32 до 1.31 с.
--
-- Ответ совпадает с прежним СТРОКА В СТРОКУ — сверено через EXCEPT в обе
-- стороны на боевых данных, 50 из 50, ноль расхождений.
--
-- ⚠️ ОТБОРЫ ПЕРЕЕХАЛИ ПОСЛЕ АГРЕГАТА, И ЭТО БЕЗОПАСНО. Клуб, лига и страна
-- смотрят только на свойства карточки, а не на строки матчей, поэтому сумма
-- по игроку от переноса не меняется. Будь среди них отбор по самим матчам —
-- переносить было бы нельзя.

create or replace function public.player_ratings(
  p_days integer default 7, p_limit integer default 50,
  p_club_key text default null, p_league text default null,
  p_country text default null)
returns table(card_id uuid, name text, name_en text, photo_url text, country text,
              club text, club_key text, level smallint, basis text,
              matches integer, minutes integer, goals integer, assists integer,
              points integer)
language sql stable security definer set search_path to 'public'
as $function$
  with agg as (
    select d.card_id,
           count(*)::int                    as matches,
           sum(coalesce(d.minutes, 0))::int as minutes,
           sum(coalesce(d.goals, 0))::int   as goals,
           sum(coalesce(d.assists, 0))::int as assists
      from player_match_days d
     where d.match_date >= current_date - greatest(coalesce(p_days, 7), 1)
     group by d.card_id
    having sum(coalesce(d.goals, 0)) + sum(coalesce(d.assists, 0)) > 0
  )
  select c.id, c.name, c.name_en, c.photo_url, c.country,
         coalesce(f.name, fq.name), coalesce(f.club_key, fq.club_key),
         l.level, l.basis,
         a.matches, nullif(a.minutes, 0), a.goals, a.assists,
         (a.goals * 4 + a.assists * 3)::int
    from agg a
    join cards c on c.id = a.card_id and c.active and c.category = 'player'
    left join card_current_club cc on cc.card_id = c.id
    left join football_club f on f.club_key = cc.club_key
    left join club_squad q on q.card_id = c.id and q.left_at is null
    left join football_club fq on fq.club_key = q.club_key
    left join player_level l on l.card_id = c.id
   where (p_club_key is null or p_club_key = ''
          or coalesce(cc.club_key, q.club_key) = p_club_key)
     and (p_league is null or p_league = '' or coalesce(f.league, fq.league) = p_league)
     and (p_country is null or p_country = '' or c.country = p_country)
   order by (a.goals * 4 + a.assists * 3) desc, a.goals desc,
            a.minutes asc nulls last, c.name
   limit greatest(coalesce(p_limit, 50), 1);
$function$;
