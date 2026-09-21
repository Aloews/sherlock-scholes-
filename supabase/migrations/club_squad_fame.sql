-- Известность состава: памятка вместо оконной функции на каждый вызов
-- ============================================================================
--
-- ⚠️ ЭТО ПОЧИНКА КРАСНОГО ПРОДА, А НЕ УСКОРЕНИЕ РАДИ УСКОРЕНИЯ. `check-prod`
-- в прогоне выкладки №5 дал ровно одно падение, и вот оно:
--
--     ✗ RPC anon: известность состава    57014 canceling statement due to
--                                        statement timeout
--
-- 57014 — это анонимный потолок в три секунды. Замер плана в ту же минуту:
--
--     Function Scan on fixture_squad_strength  (actual rows=86 loops=1)
--       Buffers: shared hit=9427
--     Execution Time: 4317.697 ms
--
-- ⚠️ И ЭТО ВТОРОЙ ЗАХОД НА ТУ ЖЕ ФУНКЦИЮ. В её собственном комментарии
-- написано «Стало 44 мс» — тогда чинили разбор имени клуба (`fx`), и он
-- действительно перестал быть узким местом. Осталось второе, которое тогда не
-- тронули: CTE `p` строит `row_number()` по ВСЕМ карточкам игроков всех клубов
-- (4018 строк с сортировкой), и делает это ДВАЖДЫ — по разу на каждый join.
-- Отсюда 9427 буферов на 86 строк ответа.
--
-- Лечится тем же, чем уже вылечена соседняя `fixture_team_rating`: ранжирование
-- считается ночью и кладётся в маленькую таблицу, а функция её читает.
--
-- ЗАМЕР ПОСЛЕ, тот же план на той же базе:
--
--     Function Scan on fixture_squad_strength  (actual rows=86 loops=1)
--       Buffers: shared hit=3533
--     Execution Time: 19.323 ms
--
--     4317.697 мс → 19.323 мс,  9427 буферов → 3533,  строк 86 → 86
--
-- ⚠️ ОТВЕТ СВЕРЕН, А НЕ «ДОЛЖЕН СОВПАДАТЬ». Прежняя логика посчитана заново
-- рядом с новой функцией и вычтена в обе стороны:
--
--     old_rows 86 | new_rows 86 | only_old 0 | only_new 0
--
-- Ноль в обе стороны — это и есть условие, при котором ускорение можно
-- выкладывать на выкаченный фронтенд, не спрашивая никого.
--
-- ⚠️ ПОЧЕМУ ЭТУ ФУНКЦИЮ ВООБЩЕ ЛЕЧАТ, А НЕ УДАЛЯЮТ. Ни один экран её больше не
-- зовёт — `fetchSquadStrength` в `src/features/fixtures/squadStrengthApi.ts`
-- не вызывается ниоткуда, проверено поиском по `src/`. Но её зовёт УЖЕ
-- ВЫКАЧЕННЫЙ фронтенд у людей в телефонах, а удаление функции, которую зовёт
-- прод, это приложение однажды уже уронило (легаси-шим `pick_random_cards`,
-- docs/MAP.md §3). Пока старая сборка жива, её ответ обязан укладываться в три
-- секунды — и укладывается он теперь с запасом, а не «когда база не занята».
--
-- Перемежающийся отказ здесь опаснее постоянного: в спокойную минуту те же
-- вызовы отвечали за 345–516 мс, и по ним функцию считали здоровой.

-- ── 1) Памятка: одиннадцать самых известных игроков клуба ───────────────────
--
-- ⚠️ ИСТОЧНИК ВЗЯТ ТОТ ЖЕ, ЧТО У СТАРОГО ЗАПРОСА, И ЭТО НАМЕРЕННО.
-- `club_squad_level` рядом построена на `club_squad` + `player_level`, а здесь
-- `card_current_club` + `cards.fame` — таблицы разные, и числа у них разные.
-- Соблазн «заодно перевести на общий источник» означал бы менять ОТВЕТ
-- выкаченному фронтенду под видом ускорения. Ответ обязан остаться прежним
-- до последней десятой; сверка приложена ниже.
--
-- 3546 строк на 830 клубов — вся таблица меньше одной страницы плана.

create table if not exists public.club_squad_fame (
  club_key   text     not null,
  rn         smallint not null,
  fame       smallint not null,
  squad_size smallint not null,
  primary key (club_key, rn)
);

comment on table public.club_squad_fame is
  'Одиннадцать самых известных игроков клуба по cards.fame, пересобирается '
  'ночью. squad_size — ВЕСЬ состав, а не одиннадцать: это разные числа. '
  'Не путать с club_squad_level: там player_level и другой источник состава.';

alter table public.club_squad_fame enable row level security;
drop policy if exists club_squad_fame_read on public.club_squad_fame;
create policy club_squad_fame_read on public.club_squad_fame for select using (true);
grant select on public.club_squad_fame to anon, authenticated, service_role;

-- ── 2) Сборка — внутри уже существующей ночной функции ──────────────────────
--
-- ⚠️ ОТДЕЛЬНОЙ ФУНКЦИИ ЗДЕСЬ НЕТ СОЗНАТЕЛЬНО, и причина не в лени. Ночью эту
-- работу запускает pg_cron строкой `select public.rebuild_club_squad_levels()`,
-- прибитой в расписании (club_name_memo.sql §3). Вторая функция потребовала бы
-- второй записи в cron — то есть ещё одного места, которое можно забыть
-- завести. Забытый шаг сборки не падает: он молчит, а таблица просто стареет,
-- и наружу это выходит через недели неверными числами. Имя функции стало чуть
-- уже своего содержимого; это дешевле молчаливого расхождения.
--
-- ⚠️ ТЕЛО ЭТОЙ ФУНКЦИИ ЛЕЖИТ В ДВУХ ФАЙЛАХ ОДИНАКОВЫМ, И ЭТО НЕ КОПИПАСТА ПО
-- НЕВНИМАТЕЛЬНОСТИ. Её же дополняет `club_directory_fast.sql`, добавляя третью
-- памятку. Пока версии различались, порядок применения РЕШАЛ ИСХОД: по именам
-- `club_directory_fast.sql` идёт раньше `club_squad_fame.sql`, и применение
-- «по алфавиту» оставляло в базе короткую версию — та молча переставала
-- наполнять `club_directory_facts`, справочник клубов навсегда застывал на
-- числах последней удачной сборки, и НИ ОДНА ПРОВЕРКА НЕ КРАСНЕЛА: ответ
-- приходит, строки есть, просто они вчерашние. Теперь тело одинаково, и любой
-- порядок даёт полную версию. Расхождение ловит `test/rebuild_club_squad_levels.test.ts`.

create or replace function public.rebuild_club_squad_levels()
returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer;
declare v_fame  integer;
declare v_dir   integer;
begin
  -- Две отдельные команды на таблицу, а не data-modifying CTE: все CTE делят
  -- один снимок, и delete внутри insert конфликтовал бы сам с собой.
  delete from club_squad_level;

  insert into club_squad_level (club_key, rn, level, squad_size)
  select r.club_key, r.rn::smallint, r.level::smallint, r.n::smallint
    from (
      select q.club_key, l.level,
             row_number() over (partition by q.club_key order by l.level desc) as rn,
             count(*)     over (partition by q.club_key)                        as n
        from club_squad q
        join player_level l on l.card_id = q.card_id
        join cards c on c.id = q.card_id and c.active and c.category = 'player'
       where q.left_at is null
    ) r
   -- Глубже одиннадцати не считается никогда: depth ограничен сверху 11.
   where r.rn <= 11;

  get diagnostics v_count = row_count;

  -- ── известность, тот же приём (club_squad_fame.sql) ──
  delete from club_squad_fame;

  insert into club_squad_fame (club_key, rn, fame, squad_size)
  select r.club_key, r.rn::smallint, r.fame::smallint, r.n::smallint
    from (
      select cc.club_key, c.fame,
             -- `c.id` вторым ключом — против недетерминированного порядка при
             -- равной известности; на среднее не влияет, на воспроизводимость
             -- влияет.
             row_number() over (partition by cc.club_key
                                    order by c.fame desc, c.id) as rn,
             count(*)     over (partition by cc.club_key)        as n
        from card_current_club cc
        join cards c on c.id = cc.card_id
       where c.active and c.category = 'player' and c.fame is not null
    ) r
   where r.rn <= 11;

  get diagnostics v_fame = row_count;

  -- ── справочник клубов ──
  delete from club_directory_facts;

  insert into club_directory_facts (club_key, squad, squad_value)
  select f.club_key,
         coalesce(sq.n, 0),
         v.v
    from football_club f
    left join (select s.club_key, count(*)::int as n
                 from club_squad s where s.left_at is null group by s.club_key) sq
           on sq.club_key = f.club_key
    left join (select cc.club_key, sum(c.market_value_eur)::bigint as v
                 from card_current_club cc
                 join cards c on c.id = cc.card_id and c.active and c.category = 'player'
                group by cc.club_key) v
           on v.club_key = f.club_key;

  get diagnostics v_dir = row_count;

  raise notice 'club_squad_level: %, club_squad_fame: %, club_directory_facts: %',
               v_count, v_fame, v_dir;
  -- Возвращается по-прежнему число строк УРОВНЕЙ: на него смотрят расписание
  -- и старые логи.
  return v_count;
end;
$$;

revoke all on function public.rebuild_club_squad_levels() from public;
grant execute on function public.rebuild_club_squad_levels() to service_role;

-- Заполнить сразу, не дожидаясь 06:42 — иначе функция ниже до утра вернёт
-- пустоту, а это хуже медленного ответа.
select public.rebuild_club_squad_levels();

-- ── 3) Сама функция: читает памятку ─────────────────────────────────────────
--
-- Отличие от прежней ровно одно — вместо CTE `p` с оконной функцией стоит
-- `club_squad_fame`. Формула, порог, группировка, состав колонок не тронуты.

create or replace function public.fixture_squad_strength(p_min_depth int default 5)
returns table (
  fixture_id  text,
  home_fame   numeric,
  away_fame   numeric,
  depth       integer,
  home_squad  integer,
  away_squad  integer
)
language sql stable security definer set search_path = public as $$
  -- ⚠️ ЭТУ ФУНКЦИЮ НЕ ЗОВЁТ НИ ОДИН ЭКРАН — её сменил fixture_team_rating. Но
  -- её зовёт выкаченный фронтенд, а удалять такое этот проект уже пробовал:
  -- легаси-шим pick_random_cards уронил прод (docs/MAP.md §3). Поэтому она
  -- живёт и обязана укладываться в анонимные три секунды.
  --
  -- ⚠️ ДВА РАЗА НЕ УКЛАДЫВАЛАСЬ, И ОБА РАЗА ПО РАЗНОЙ ПРИЧИНЕ.
  --   1) разбор имени клуба построчно      — вылечено `fx as materialized`
  --   2) row_number() по всем карточкам    — вылечено памяткой club_squad_fame
  -- Замер второй починки: 4317 мс и 9427 буферов → см. комментарий в шапке
  -- club_squad_fame.sql, там числа «после».
  --
  -- ⚠️ КЛЮЧ КЛУБА РЕШАЕТСЯ ТАК ЖЕ, КАК ВЕЗДЕ. Раньше здесь звался
  -- `club_match_key`, который НЕ проходит через словарь псевдонимов; всюду
  -- остальное давно зовёт `resolve_club_key`. Цена честная и измерена:
  -- 113 матчей → 120.
  with fx as materialized (
    select f.id,
           coalesce(mh.club_key, resolve_club_key(f.home_team, null)) as hk,
           coalesce(ma.club_key, resolve_club_key(f.away_team, null)) as ak
      from fixtures f
      left join club_name_resolved mh on mh.team = f.home_team
      left join club_name_resolved ma on ma.team = f.away_team
     where f.commence_at >= now() and not f.completed
  ),
  sz as (
    select club_key, max(squad_size)::int as n from club_squad_fame group by club_key
  ),
  sized as (
    select fx.id, fx.hk, fx.ak, hz.n as hn, az.n as an,
           least(hz.n, az.n, 11) as depth
      from fx
      join sz hz on hz.club_key = fx.hk
      join sz az on az.club_key = fx.ak
     -- Порог обязателен. По двум карточкам «уровень состава» — это уровень
     -- двух человек, и подписать его именем клуба значит соврать.
     where least(hz.n, az.n) >= greatest(2, p_min_depth)
  )
  select s.id,
         round(avg(ph.fame)::numeric, 1),
         round(avg(pa.fame)::numeric, 1),
         s.depth, s.hn, s.an
    from sized s
    join club_squad_fame ph on ph.club_key = s.hk and ph.rn <= s.depth
    join club_squad_fame pa on pa.club_key = s.ak and pa.rn <= s.depth
   group by s.id, s.depth, s.hn, s.an
$$;

revoke all on function public.fixture_squad_strength(int) from public;
grant execute on function public.fixture_squad_strength(int) to anon, authenticated, service_role;
