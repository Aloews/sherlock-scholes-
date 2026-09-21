-- Справочник клубов: считать дорогое ПОСЛЕ limit, а не до него
-- ============================================================================
--
-- ⚠️ ВТОРАЯ ФУНКЦИЯ, НЕ УКЛАДЫВАВШАЯСЯ В АНОНИМНЫЕ ТРИ СЕКУНДЫ. Первая —
-- `fixture_squad_strength` (club_squad_fame.sql). Эта попалась следом, и
-- попалась ИМЕННО ТАК, КАК И ОПИСАНО ТАМ: в прогоне выкладки №5 она была
-- зелёной, а через двадцать минут на том же боевом адресе дала
--
--     ✗ Эмблемы клубов    57014 canceling statement due to statement timeout
--
-- ⚠️ ЭТУ ЗОВЁТ ЭКРАН. Не легаси-шим: справочник клубов открывают из игры, и
-- «иногда не грузится» у владельца — это вот оно.
--
-- ЗАМЕР ДО:
--
--     Function Scan on club_directory  (actual rows=60 loops=1)
--       Buffers: shared hit=82210
--     Execution Time: 2249.811 ms
--
-- 82210 буферов ради шестидесяти строк. Причина видна в теле: два `left join
-- lateral` считались для КАЖДОГО клуба (их 3491) ещё ДО `limit 60`, и
-- `club_display_name` звался тоже 3491 раз вместо шестидесяти.
--
-- 2249 мс — это «прошло» на спокойной базе. Потолок anon — 3000 мс, а
-- инстанс на бесплатном тарифе режет процессор под нагрузкой (замерено в этом
-- проекте: один и тот же план, одни и те же буферы — 179 мс против 6297 мс).
-- То есть функция жила в полушаге от отказа и падала через раз.
--
-- ── ЧТО ИЗМЕНЕНО ───────────────────────────────────────────────────────────
--
-- 1. Счёт матчей (`club_match` за 400 дней) НЕ участвует в сортировке — он
--    только в ответе. Значит его можно посчитать после `limit`, для шестидесяти
--    строк вместо трёх с половиной тысяч.
-- 2. Счёт состава и стоимость состава в сортировке УЧАСТВУЮТ, поэтому после
--    `limit` их не унести — они переехали в ночную памятку
--    `club_directory_facts` (3491 строка, собирается вместе с уровнями
--    составов в 06:42).
-- 3. `club_display_name` зовётся после `limit`: шестьдесят раз вместо 3491.
--
-- ⚠️ ПОЧЕМУ ДВА ЗАХОДА, А НЕ ОДИН. Первая правка убрала два `lateral` и дала
-- 2249 → 84.6 мс на спокойной базе. Этого оказалось МАЛО: `check-prod` всё
-- равно поймал 57014, потому что под собственной нагрузкой проверки инстанс
-- режет процессор, а в запросе оставались два полных прохода — по 24 818
-- строкам `card_current_club` (сумма стоимостей) и 25 096 строкам
-- `club_squad` (размер состава), на КАЖДЫЙ вызов. Замер по сети без нагрузки
-- показывал 0.7–1.0 с при потолке 3 с — то есть «починено» означало «падает
-- реже». Второй заход убрал и их: 84.6 → 26.5 мс, 10601 → 5563 буфера.
--
-- ⚠️ ПОРЯДОК СТРОК СОХРАНЁН ДОСЛОВНО. Ключи сортировки (`стоимость, elo,
-- состав, имя`) вынесены сквозь подзапрос и применены второй раз после
-- `limit` — иначе `limit` отдал бы правильные шестьдесят клубов в
-- произвольном порядке. `elo` и `f.name` тянутся наверх только ради этого: в
-- ответе их нет и не было.
--
-- ЗАМЕР ПОСЛЕ и сверка ответа — в конце файла.

-- ── 1) Памятка: состав и стоимость состава по клубам ───────────────────────
--
-- ⚠️ ЭТИ ДВА ЧИСЛА УЧАСТВУЮТ В СОРТИРОВКЕ, поэтому унести их за `limit`, как
-- счёт матчей, нельзя: чтобы отобрать шестьдесят, надо знать стоимость у всех
-- 3491. Значит остаётся второй приём — посчитать ночью.
--
-- Счёт матчей сюда НЕ кладётся намеренно: он нужен только отобранным
-- шестидесяти, и лишняя колонка в памятке означала бы лишний проход по
-- `club_match` каждую ночь ради числа, которое и так дёшево посчитать после
-- `limit`.

create table if not exists public.club_directory_facts (
  club_key    text primary key,
  squad       integer not null,
  squad_value bigint
);

comment on table public.club_directory_facts is
  'Состав и стоимость состава по клубам для справочника. Пересобирается '
  'ночью вместе с уровнями составов (06:42). Счёт матчей сюда НЕ кладётся: '
  'он нужен только шестидесяти отобранным и считается после limit.';

alter table public.club_directory_facts enable row level security;
drop policy if exists club_directory_facts_read on public.club_directory_facts;
create policy club_directory_facts_read on public.club_directory_facts for select using (true);
grant select on public.club_directory_facts to anon, authenticated, service_role;

-- ⚠️ ИНДЕКСА ПО `squad_value` ЗДЕСЬ НЕТ, И ЭТО ПРОВЕРЕНО, А НЕ ЗАБЫТО. Он был
-- заведён сразу («сортируем по стоимости — значит нужен индекс») и через
-- полчаса попал в советник Supabase как НИ РАЗУ НЕ ИСПОЛЬЗОВАННЫЙ. Так и
-- должно быть: в таблице 3760 строк, соединение идёт от `football_club`, и
-- планировщик всегда предпочтёт хеш-соединение с сортировкой. Замер после
-- удаления: 36.2 мс при тех же 5546 буферах — то есть индекс не давал ничего,
-- а платить за него пришлось бы каждую ночь при пересборке.

-- ── 2) Сборка — в той же ночной функции, что и составы ─────────────────────
--
-- ⚠️ ТРЕТЬЯ ТАБЛИЦА В ФУНКЦИИ С ИМЕНЕМ ПРО УРОВНИ — СОЗНАТЕЛЬНО, и причина та
-- же, что в club_squad_fame.sql: ночью эту работу запускает pg_cron строкой
-- `select public.rebuild_club_squad_levels()`, прибитой в расписании. Каждая
-- новая функция здесь требовала бы новой записи в cron — то есть ещё одного
-- места, которое можно забыть завести. Забытый шаг сборки не падает: он
-- молчит, а таблица просто стареет.

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

-- Заполнить сразу, не дожидаясь 06:42: пустая памятка означала бы пустой
-- справочник клубов до утра.
select public.rebuild_club_squad_levels();

-- ── 3) Сама функция ────────────────────────────────────────────────────────

create or replace function public.club_directory(
  p_lang  text default 'ru',
  p_query text default null,
  p_limit int  default 60,
  p_kind  text default 'club'
)
returns table (
  club_key     text,
  name         text,
  country      text,
  league       text,
  crest_url    text,
  squad        integer,
  matches      integer,
  level        integer,
  squad_value  bigint
)
language sql stable security definer set search_path = public as $$
  -- ⚠️ ПОРЯДОК — ПО СТОИМОСТИ СОСТАВА. Владелец: «давай пока сделаем основным
  -- рейтингом всего для всех экранов именно стоимость. А с набором данных
  -- сможем понять и проверим, какой лучше показатель отображает силу игрока».
  --
  -- Прежде сортировал elo. Он остаётся вторым ключом — там, где стоимость
  -- неизвестна (у клуба нет ни одной оценённой карточки), порядок всё равно
  -- нужен, и сыгранные матчи знают о команде больше, чем ничего.
  --
  -- ⚠️ elo НЕ ВЫБРОШЕН И level ПО-ПРЕЖНЕМУ ОТДАЁТСЯ: владелец хочет позже
  -- сравнить, какой показатель вернее. Выбросить сейчас — значит нечего будет
  -- сравнивать.
  --
  -- ⚠️ ПОРЯДОК СТРОК СОХРАНЁН ДОСЛОВНО. Ключи сортировки (стоимость, elo,
  -- состав, имя) вынесены сквозь подзапрос и применены второй раз после
  -- `limit` — иначе `limit` отдал бы правильные шестьдесят клубов в
  -- произвольном порядке. `ord_elo` и `raw_name` тянутся наверх только ради
  -- этого: в ответе их нет и не было.
  with top as (
    select f.club_key, f.name as raw_name, f.country, f.league, f.crest_url,
           coalesce(d.squad, 0) as squad,
           r.level::int as level, d.squad_value,
           r.elo as ord_elo
      from football_club f
      left join club_directory_facts d on d.club_key = f.club_key
      left join club_rating r on r.club_key = f.club_key
     where f.kind = case when coalesce(p_kind, 'club') = 'national' then 'national' else 'club' end
       and (p_query is null or btrim(p_query) = ''
         or f.name ilike '%' || btrim(p_query) || '%'
         or f.name_en ilike '%' || btrim(p_query) || '%'
         or f.club_key like club_norm_key(btrim(p_query)) || '%'
         or exists (select 1 from club_alias a
                     where a.club_key = f.club_key
                       and a.alias_key like club_norm_key(btrim(p_query)) || '%'))
     order by d.squad_value desc nulls last,
              r.elo desc nulls last,
              coalesce(d.squad, 0) desc,
              f.name
     limit greatest(coalesce(p_limit, 60), 1)
  )
  select t.club_key,
         club_display_name(t.club_key, p_lang),
         t.country, t.league, t.crest_url,
         t.squad,
         coalesce(m.n, 0)::int,
         t.level, t.squad_value
    from top t
    -- Счёт матчей — только здесь, по шестидесяти клубам. В сортировке его нет
    -- и не было, поэтому перенос за `limit` ответ не меняет.
    left join lateral (select count(*) n from club_match c
                        where (c.home_key = t.club_key or c.away_key = t.club_key)
                          and c.match_date >= current_date - 400) m on true
   order by t.squad_value desc nulls last,
            t.ord_elo desc nulls last,
            t.squad desc,
            t.raw_name
$$;

revoke all on function public.club_directory(text, text, int, text) from public;
grant execute on function public.club_directory(text, text, int, text)
  to anon, authenticated, service_role;

  to anon, authenticated, service_role;

-- ── ЗАМЕРЫ ─────────────────────────────────────────────────────────────────
--
--     было                        2249.811 мс   82210 буферов
--     после первого захода          84.560 мс   10601
--     после памятки                 26.498 мс    5563
--
-- ── СВЕРКА ОТВЕТА ──────────────────────────────────────────────────────────
--
-- ⚠️ СРАВНИВАЛСЯ НЕ НАБОР СТРОК, А ОТВЕТ ЦЕЛИКОМ ВМЕСТЕ С ПОРЯДКОМ. Порядок
-- здесь и есть смысл функции — это витрина «самые дорогие составы сверху», и
-- перестановка была бы поломкой, которую `except` по множествам не увидел бы.
--
-- Первый заход сверялся по md5 ответа на пяти наборах параметров — язык
-- (влияет на club_display_name), kind (другая ветка where), поиск кириллицей
-- и латиницей (ilike + club_norm_key + club_alias), маленький limit
-- (проверяет, что перенос счёта матчей за limit не сдвинул границу
-- отсечения). Все пять совпали.
--
-- ⚠️ А ВОТ ВТОРОЙ ЗАХОД ПОКАЗАЛ, ЧТО ЭТОТ СПОСОБ СВЕРКИ ЗДЕСЬ ХРУПОК, И ЭТО
-- СТОИТ ЗАПИСАТЬ. md5 «до» снимался 20.09, «после» — 21.09, и четыре из пяти
-- разошлись. Причина не в правке: в теле стоит `current_date - 400`, окно
-- сдвинулось на сутки вместе с датой, и счёт матчей у части клубов честно
-- изменился. Сверка по снимку, сделанному вчера, у функции, зависящей от
-- сегодняшней даты, доказывает не то, что нужно.
--
-- Правильная сверка — обе версии В ОДИН МОМЕНТ: прежняя логика (живые `val`
-- и `sq`) посчитана заново рядом с новой и вычтена в обе стороны, вместе с
-- номером строки:
--
--     old_rows 60 | new_rows 60 | only_old 0 | only_new 0
--
-- Ноль в обе стороны при сравнении, включающем `row_number()`, — это и
-- значит «тот же ответ в том же порядке».
