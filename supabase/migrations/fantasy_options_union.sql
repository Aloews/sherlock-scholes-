-- ===========================================================================
-- Фэнтези и коллекция перестают спорить о том, кто играет
--
-- Владелец: «в фэнтези нет многих игроков, и нет синхронизации экранов
-- коллекций с фэнтези». Прав, и причина одна: экраны спрашивают РАЗНЫЕ
-- таблицы. Коллекция читает `cards` и статистику напрямую, фэнтези отбирало
-- через `card_current_club` — и у этого два изъяна, оба молчаливые.
--
-- 1. ⚠️ ОДИН ИСТОЧНИК ВМЕСТО ДВУХ. `card_current_club` выводится из
--    статистики: «за кого он играл в последних матчах». `club_squad`
--    собирается из состава: «кто в команде числится». Это РАЗНЫЕ
--    свидетельства, а не старое и новое. Замер на текущем туре (127 матчей):
--      только card_current_club   647 игроков  ← как было
--      только club_squad          747
--      ОБЪЕДИНЕНИЕ                761          ← стало
--    Заменить одно другим нельзя: замена теряет 14 настоящих игроков —
--    Гринвуд, Сёрлот, Корреа, Лемар, Балерди, Рульи (Марсель, Атлетико, Лион,
--    Страсбур, Дженоа). У них есть матчи, но собранного состава нет.
--
-- 2. ⚠️ КЛЮЧ МИМО СЛОВАРЯ ПСЕВДОНИМОВ. `club_match_key` не проходит через
--    `club_alias`, и клуб из `fixtures` (латиница, the-odds-api) не находил
--    состава, собранного по кириллическим матчам sports.ru. Та же поломка,
--    что уже чинилась в `fixture_team_rating`; здесь она осталась.
--
-- ⚠️ КАЖДАЯ ТАБЛИЦА СВОДИТСЯ СВОИМ КЛЮЧОМ. В `card_current_club` ключи
-- построены СТАРЫМ нормализатором, в `club_squad` — новым. Сверять первую
-- новым ключом значит молча терять строки: 647 своим ключом против 618
-- чужим. Поэтому у каждого источника ниже свой столбец ключа, а не общий.
--
-- ⚠️ СИГНАТУРУ НЕ ТРОГАТЬ БЕЗ DROP. У боевой функции ШЕСТЬ колонок:
-- `position_key` добавила fantasy_tactics.sql, и в fantasy.sql её нет. Правка
-- по устаревшему файлу снесла бы тактику; Postgres отказал (42P13), и это
-- единственное, что здесь помешало сломать её молча.
--
-- Позиция из состава НЕ подставляется: замер — 55 кандидатов без
-- `facts->>'position'`, и НИ У ОДНОГО нет позиции в `club_squad`. Ветка была
-- бы мёртвой, а мёртвую ветку нельзя ни проверить, ни отличить от рабочей.
-- ===========================================================================
drop function if exists public.fantasy_options(bigint);

create function public.fantasy_options(p_round_id bigint)
returns table (
  card_id uuid, name text, name_en text, club text,
  match_count integer, position_key text
)
language sql stable security definer set search_path = public as $$
  with r as (
    select fr.starts_at, fr.ends_at from fantasy_round fr where fr.id = p_round_id
  ),
  fx as (
    select f.id, f.home_team, f.away_team
      from fixtures f cross join r
     where f.commence_at >= r.starts_at and f.commence_at < r.ends_at
  ),
  -- Обе стороны каждого матча. resolve_club_key зовётся на НАЗВАНИЕ, а не на
  -- строку статистики: матчей в туре сотня. Вызов на каждую строку однажды уже
  -- не уложился в минуту и откатил весь прогон — docs/MAP.md,
  -- rebuild_football_clubs.
  fk as (
    select id, resolve_club_key(home_team) as club_key from fx
    union all
    select id, resolve_club_key(away_team) from fx
  ),
  -- Источник 1 — выведенный из статистики. Соединяется по resolved_key, а НЕ
  -- по club_key: замер показал, что новый ключ — НАДМНОЖЕСТВО старого (795
  -- против 722, объединение те же 795), поэтому вторая ветка не нужна.
  -- Ранг 2: имя клуба сырое, как пришло от источника («Atlético Madrid»).
  from_stats as (
    select cc.card_id, cc.club, fk.id as fixture_id, 2 as src_rank
      from card_current_club cc
      join fk on fk.club_key = cc.resolved_key
  ),
  -- Источник 2 — собранный состав. Ранг 1: имя идёт через club_display_name,
  -- то есть переведённое и сведённое к одной записи справочника.
  from_squad as (
    select s.card_id, club_display_name(s.club_key, 'ru') as club,
           fk.id as fixture_id, 1 as src_rank
      from club_squad s
      join fk on fk.club_key = s.club_key
     where s.left_at is null
  ),
  -- ⚠️ НЕ НАЗЫВАТЬ ЭТО `both`: зарезервированное слово (trim(both ...)),
  -- Postgres валит запрос с 42601. Третий раз в проекте после `position` и
  -- `place` — см. таблицу граблей.
  sources as (
    select * from from_stats
    union all
    select * from from_squad
  )
  select b.card_id, c.name, c.name_en,
         -- Имя клуба — у источника с МЕНЬШИМ рангом, а не min() по алфавиту:
         -- иначе «Atlético Madrid» побеждало бы «Атлетико» только потому, что
         -- латиница сортируется раньше кириллицы.
         (array_agg(b.club order by b.src_rank, b.club))[1],
         -- distinct обязателен: матч приходит сюда дважды, когда игрок найден
         -- обоими источниками. Без него число матчей удваивается — а список
         -- именно по нему и сортируется.
         count(distinct b.fixture_id)::int,
         fantasy_position_key(c.facts->>'position')
    from sources b
    join cards c on c.id = b.card_id and c.active and c.category = 'player'
   group by b.card_id, c.name, c.name_en, c.facts->>'position'
   order by count(distinct b.fixture_id) desc, c.name;
$$;

-- ---------------------------------------------------------------------------
-- my_fantasy_squad — та же рассинхронизация, вторым концом.
--
-- Клуб выбранного игрока брался ТОЛЬКО из card_current_club, поэтому у тех
-- самых 114 новых игрок в составе показывался бы без клуба вовсе: пустая
-- строка там, где на соседнем экране клуб есть. Порядок coalesce тот же, что
-- в fantasy_options, — сперва собранный состав, потом выведенный из
-- статистики; иначе два экрана назвали бы один клуб по-разному.
-- ---------------------------------------------------------------------------
drop function if exists public.my_fantasy_squad(text, bigint);

create function public.my_fantasy_squad(p_init_data text, p_round_id bigint)
returns table (
  card_id uuid, name text, club text, is_captain boolean, points integer,
  position_key text, tactic text
)
language plpgsql security definer set search_path = public as $$
declare v_me bigint := tg_validate_init_data(p_init_data);
begin
  -- ⚠️ Личность — из подписанной initData; p_player_id в аргументе был бы
  -- дырой. Отказ 28000 остаётся ИСКЛЮЧЕНИЕМ, а не пустым ответом: клиент
  -- различает «нечего показывать» и «тебе не поверили», и подменить второе
  -- первым значит молча пустить неподписанный вызов.
  if v_me is null then raise exception 'invalid init data' using errcode = '28000'; end if;
  return query
    select p.card_id, c.name,
           coalesce(
             (select club_display_name(s.club_key, 'ru') from club_squad s
               where s.card_id = p.card_id and s.left_at is null limit 1),
             cc.club
           ),
           p.is_captain,
           (coalesce(pp.points, 0) * case when p.is_captain then 2 else 1 end)::int,
           fantasy_position_key(c.facts->>'position'),
           coalesce(st.tactic, 'balanced')
      from fantasy_pick p
      join cards c on c.id = p.card_id
      left join card_current_club cc on cc.card_id = p.card_id
      left join fantasy_squad_tactic st
             on st.round_id = p.round_id and st.player_id = p.player_id
      left join fantasy_pick_points(p_round_id) pp
             on pp.card_id = p.card_id and pp.player_id = p.player_id
     where p.round_id = p_round_id and p.player_id = v_me
     order by p.is_captain desc, c.name;
end;
$$;

-- Гранты перечислены ЯВНО: политика без гранта роняла этот проект дважды.
revoke all on function public.fantasy_options(bigint)          from public;
revoke all on function public.my_fantasy_squad(text, bigint)   from public;
grant execute on function public.fantasy_options(bigint)
  to anon, authenticated, service_role;
grant execute on function public.my_fantasy_squad(text, bigint)
  to anon, authenticated, service_role;
