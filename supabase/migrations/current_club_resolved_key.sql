-- ===========================================================================
-- `fill_missing_clubs()` возвращала НОЛЬ. Вот механизм, а не догадка.
--
-- Это «ЗАДАЧА НОМЕР ОДИН» из передачи: у 1745 из 2918 активных игроков нет
-- текущего клуба, и 222 из них играли за последние 30 дней. Из-за этого
-- фэнтези их не предлагает, а коллекция ту же статистику показывает — «один
-- игрок, два экрана, разный ответ».
--
-- ⚠️ ПОЧЕМУ РОВНО НОЛЬ, А НЕ «МАЛО». `card_current_club.club_key` объявлен
-- NOT NULL, а `club_match_key()` вырезает всё, кроме [a-z0-9], и на кириллице
-- отдаёт NULL. sports.ru пишет команды по-русски. Значит игрока, у которого
-- все матчи русские, туда ФИЗИЧЕСКИ НЕЛЬЗЯ вставить — не «он редко проходит
-- порог», а ограничение таблицы отвергает строку.
--
-- Замер 01.09.2026 на 222 игравших без клуба:
--     старой логикой (club_match_key)    29
--     новой  (resolve_club_key)         109     ← вчетверо
--
-- ⚠️ КЛЮЧ НЕ ПЕРЕОПРЕДЕЛЁН, А ДОБАВЛЕН. `card_current_club.club_key` читают
-- больше десяти миграций и выкаченный фронтенд. Переписать его пространство
-- значило бы менять смысл колонки под всеми ними разом — а разойтись они
-- могли бы молча, каждая по-своему. Поэтому:
--
--   club_key      — КАК БЫЛО. Для латиницы побуквенно то же, что и раньше;
--                   для кириллицы, где раньше строки не было вовсе, теперь
--                   стоит транслитерированный ключ. Ни один прежний читатель
--                   не видит изменения: те строки для него и так не
--                   существовали.
--   resolved_key  — НОВОЕ. Прошло через club_alias, то есть «Зенит» и
--                   «Zenit St Petersburg» здесь один ключ. Соединяться с
--                   fixtures надо по нему.
-- ===========================================================================
alter table public.card_current_club
  add column if not exists resolved_key text;

-- Заполнение существующих строк. Названия резолвятся ОДИН РАЗ, а не построчно:
-- вызов stable-функции на каждую строку однажды уже не уложился в минуту и
-- откатил весь прогон целиком (docs/MAP.md, rebuild_football_clubs).
with names as (select distinct club from public.card_current_club),
     nk as (select club, resolve_club_key(club) as k from names)
update public.card_current_club t
   set resolved_key = nk.k
  from nk
 where nk.club = t.club
   and t.resolved_key is distinct from nk.k;

create index if not exists card_current_club_resolved_key_idx
  on public.card_current_club (resolved_key);

-- ---------------------------------------------------------------------------
-- fill_missing_clubs — та же логика, но на ключе, который у кириллицы есть.
--
-- ⚠️ ОКНО СЧЁТА И ОКНО КЛЮЧЕЙ — ОДНО МНОЖЕСТВО. Прежняя версия выбрасывала из
-- знаменателя дни без ключа, потому что иначе `seen = total` не выполнялось
-- НИКОГДА у игрока с матчами из двух источников. С resolve_club_key ключ есть
-- у всех, и костыль не нужен — но правило «клуб один и стоит во ВСЕХ матчах»
-- остаётся: в строке матча две команды, а играл он за одну, и «наверное, эта»
-- здесь означает приписать игрока чужому клубу.
-- ---------------------------------------------------------------------------
create or replace function public.fill_missing_clubs()
returns table(out_card_id uuid, out_name text, out_club text, out_key text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with played as (
    select d.card_id
      from player_match_days d
      join cards c on c.id = d.card_id and c.active and c.category = 'player'
      left join card_current_club cc on cc.card_id = d.card_id
     where cc.card_id is null and d.match_date > now() - interval '30 days'
     group by d.card_id
  ),
  m as (
    select d.card_id, d.match_date, d.home_team, d.away_team
      from player_match_days d join played p on p.card_id = d.card_id
     where d.match_date > now() - interval '120 days'
  ),
  -- Названия резолвятся ОДИН РАЗ: их полторы тысячи против пяти тысяч строк.
  names as (
    select distinct team from (
      select m.home_team as team from m union select m.away_team from m) x
  ),
  nk as (select n.team, resolve_club_key(n.team) as k from names n),
  days as (select m.card_id, count(distinct m.match_date) as total from m group by m.card_id),
  keys as (
    select t.card_id, t.k, t.team, count(distinct t.match_date) as seen
      from (select m.card_id, m.match_date, nk.k, m.home_team as team
              from m join nk on nk.team = m.home_team
            union all
            select m.card_id, m.match_date, nk.k, m.away_team
              from m join nk on nk.team = m.away_team) t
     where t.k is not null
     group by t.card_id, t.k, t.team
  ),
  cand as (
    select distinct on (k.card_id) k.card_id, k.k, k.team
      from keys k join days d on d.card_id = k.card_id
     where k.seen = d.total and d.total >= 2
     order by k.card_id, k.seen desc, k.team
  ),
  ins as (
    insert into card_current_club as t
      (card_id, club, club_key, resolved_key, apps, source, fetched_at)
    select c2.card_id, c2.team,
           -- club_key остаётся в СТАРОМ пространстве. coalesce нужен потому,
           -- что колонка NOT NULL: у кириллицы старого ключа нет, и без
           -- запасного варианта строка снова не вставится — ровно та
           -- поломка, которую эта миграция и чинит.
           coalesce(club_match_key(c2.team), club_norm_key(c2.team)),
           c2.k,
           (select count(distinct mm.match_date) from m mm where mm.card_id = c2.card_id),
           'derived:matches', now()
      from cand c2
    on conflict (card_id) do nothing
    -- ⚠️ ВОЗВРАЩАТЬ НАДО ОТСЮДА, А НЕ ПЕРЕЧИТЫВАНИЕМ ТАБЛИЦЫ. Прежняя версия
    -- дописывала `join card_current_club cc on cc.card_id = i.card_id` — и
    -- получала ноль строк ВСЕГДА, даже когда вставка проходила: снимок запроса
    -- берётся ДО его же изменений, поэтому только что вставленные строки в нём
    -- не видны. Замер 01.09.2026: функция вставила 109 строк (1252 -> 1361) и
    -- отчиталась НУЛЁМ.
    --
    -- Это ВТОРАЯ, независимая причина жалобы «fill_missing_clubs возвращает
    -- ноль», и она пережила бы починку первой: даже заработав, функция
    -- продолжала бы говорить, что не сделала ничего. Проверено откатом —
    -- 109 строк удалены и пересозданы, на второй раз функция их НАЗВАЛА.
    returning t.card_id, t.club, t.resolved_key
  )
  select i.card_id, c.name, i.club, i.resolved_key
    from ins i join cards c on c.id = i.card_id;
end;
$$;

-- Гранты перечислены ЯВНО: политика без гранта роняла этот проект дважды.
revoke all on function public.fill_missing_clubs() from public;
grant execute on function public.fill_missing_clubs() to service_role;
