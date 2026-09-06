-- ===========================================================================
-- cards.wikidata_qid, cards.transfermarkt_id, стоимость игрока и клуба.
--
-- Владелец: «стоимость игроков и данные с Transfermarkt; стоимость клуба —
-- сумма по составу».
--
-- ЦЕПОЧКА ЗАМЕРЕНА, А НЕ УГАДАНА ПО ИМЕНИ:
--
--     QID → wdt:P2446 (идентификатор Transfermarkt) → профиль по id → цена
--
-- Проверено 04.09.2026 на боевых адресах: Павлович (P2446 574671) → €40.00m,
-- Торриани (939745) → €800k. Совпало с замером владельца до цента.
--
-- ⚠️ ИСТОЧНИК НАЗЫВАЕТСЯ ЧЕСТНО. Данные о стоимости принадлежат Transfermarkt,
-- их ToS переиспользование ограничивают, и владелец принял это решение
-- сознательно. Значит, происхождение не маскируется: оно записано в
-- COMMENT колонки, названо в интерфейсе рядом с числом (ключ локали
-- `card.value_source`) и стоит в шапке сборщика. Отдельной колонки
-- `market_value_source` здесь НЕТ намеренно: источник у этого числа ровно
-- один, а колонка с единственным возможным значением обещает различение,
-- которого нет, — этот проект уже удалял такую (`live_streams.embeddable`).
--
-- ⚠️ QID ХРАНИЛСЯ В ФАЙЛЕ РЕПОЗИТОРИЯ, А НЕ В БАЗЕ. 846 карточек, заведённых
-- сборщиком составов, обогащать можно только по QID — резолв по имени
-- промахивается МОЛЧА (замер: «Гарри Невилл» → в ру-вики «Невилл, Гари»,
-- «Хын Мин Сон» → «Сон Хын Мин», 4 из 4 не найдены). До этой миграции QID
-- жил в docs/data/new_player_cards_2026-09-03.tsv, потому что колонки не было.
-- Теперь он в базе, и всякий следующий резолв кладёт его туда же.
--
-- ⚠️ УНИКАЛЬНОСТЬ QID — ЭТО ГАРД ОТ ВТОРОГО ЗАВЕДЕНИЯ ТЕХ ЖЕ ЛЮДЕЙ. Сборщик
-- составов сопоставляет по ИМЕНИ, и карточка, лежащая с active = false,
-- ему до 04.09.2026 была не видна: следующий --create-cards завёл бы те же
-- 846 человек ВТОРОЙ РАЗ. Индекс ловит это на записи, а не на экране.
--
-- Стоимость клуба НЕ ХРАНИТСЯ. Она считается из club_squad в момент чтения —
-- иначе число под клубом и его же состав разошлись бы при первом переходе,
-- и разошлись бы молча. Это то же правило, по которому в проекте одна
-- SQL-предикат-функция на всю колоду.
--
-- Гранты перечислены явно: политика без гранта роняла этот проект дважды.
-- ===========================================================================

-- --------------------------------------------------------------------------
-- 1. Колонки
-- --------------------------------------------------------------------------
alter table cards add column if not exists wikidata_qid    text;
alter table cards add column if not exists transfermarkt_id text;
alter table cards add column if not exists market_value_eur bigint;
alter table cards add column if not exists market_value_at  date;

comment on column cards.wikidata_qid is
  'QID сущности Викиданных этой карточки (Q12345). Источник резолва для '
  'просмотров, фото и внешних идентификаторов. NULL = не резолвили.';
comment on column cards.transfermarkt_id is
  'Идентификатор игрока на transfermarkt.com, взятый из Викиданных (P2446). '
  'Не угадывается по имени.';
comment on column cards.market_value_eur is
  'Текущая рыночная стоимость в ЕВРО, ИСТОЧНИК — TRANSFERMARKT. Целое число '
  'евро: €40.00m = 40000000. NULL = не собирали или у источника прочерк.';
comment on column cards.market_value_at is
  'Дата оценки, как её печатает Transfermarkt («Last update»). Без неё '
  'стоимость читается как «сейчас», а она — на дату.';

-- Формат QID проверяется здесь, а не в питоне: писать в колонку будут
-- разные скрипты, и правило должно быть одно.
alter table cards drop constraint if exists cards_wikidata_qid_format;
alter table cards add  constraint cards_wikidata_qid_format
  check (wikidata_qid is null or wikidata_qid ~ '^Q[1-9][0-9]*$');

alter table cards drop constraint if exists cards_transfermarkt_id_format;
alter table cards add  constraint cards_transfermarkt_id_format
  check (transfermarkt_id is null or transfermarkt_id ~ '^[1-9][0-9]*$');

-- Отрицательная стоимость и ноль — это не «дёшево», а испорченный разбор.
alter table cards drop constraint if exists cards_market_value_positive;
alter table cards add  constraint cards_market_value_positive
  check (market_value_eur is null or market_value_eur > 0);

-- Одна сущность — одна карточка. См. шапку: это гард от второго заведения.
create unique index if not exists cards_wikidata_qid_uidx
  on cards (wikidata_qid) where wikidata_qid is not null;
create unique index if not exists cards_transfermarkt_id_uidx
  on cards (transfermarkt_id) where transfermarkt_id is not null;

-- --------------------------------------------------------------------------
-- 2. Запись внешних идентификаторов — одной транзакцией, идемпотентно
--
-- Пачка приезжает целиком и применяется одним оператором. Прошлая сессия
-- проталкивала данные по кускам и оборвалась между шагами, закрыв 253 строки
-- состава: здесь такого исхода нет по построению.
--
-- ⚠️ КОНФЛИКТ ПО УНИКАЛЬНОМУ ИНДЕКСУ ПОКАЗЫВАЕТСЯ, А НЕ РОНЯЕТ ПАЧКУ. Если
-- QID уже стоит у другой карточки — это дубль в колоде, и переписывать его
-- нельзя. Но и падать нельзя: замер 04.09.2026 — PostgREST ответил 409 и
-- оборвал прогон, который к тому моменту резолвил 2405 карточек из 2698,
-- то есть работа часов выброшена ради одной пары. Строка с занятым QID не
-- пишется, считается третьим числом (`conflicts`), а посмотреть её поимённо
-- можно через card_qid_conflicts(). Показать и упасть — разные вещи.
--
-- ⚠️ Дедуп ВНУТРИ пачки нужен отдельно: два ряда с одним QID в одном
-- операторе упираются в тот же индекс — «cannot affect row a second time»
-- этот проект уже ловил на составах.
-- --------------------------------------------------------------------------
drop function if exists public.apply_card_wikidata_ids(jsonb);

create function public.apply_card_wikidata_ids(p_rows jsonb)
returns table (written integer, seen integer, conflicts integer)
language plpgsql security definer set search_path = public as $$
declare
  v_written   integer;
  v_seen      integer;
  v_conflicts integer;
begin
  -- ⚠️ БЕЗ ВРЕМЕННОЙ ТАБЛИЦЫ. `security definer` живёт с search_path = public
  -- (иначе вызывающий подменяет схему), а pg_temp в него не входит: обращение
  -- к только что созданной temp-таблице не разрешилось бы вовсе.
  with raw as (
    select (r->>'card_id')::uuid             as card_id,
           nullif(r->>'qid', '')             as qid,
           nullif(r->>'transfermarkt_id','') as tm,
           nullif(r->>'country', '')         as country
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
     where (r->>'card_id') is not null
  ),
  -- QID, уже стоящий у ДРУГОЙ карточки, — дубль в колоде: не пишем, считаем.
  taken as (
    select r.card_id, r.qid
      from raw r
     where r.qid is not null
       and exists (select 1 from cards c
                    where c.wikidata_qid = r.qid and c.id <> r.card_id)
  ),
  -- Тот же QID дважды ВНУТРИ пачки: остаётся одна строка.
  dedup as (
    select distinct on (r.qid) r.card_id, r.qid
      from raw r
     where r.qid is not null
       and not exists (select 1 from taken t where t.card_id = r.card_id)
     order by r.qid, r.card_id
  ),
  src as (
    select r.card_id, d.qid, r.tm, r.country
      from raw r
      left join dedup d on d.card_id = r.card_id
  ),
  -- Тот же разбор для transfermarkt_id: у него свой уникальный индекс.
  tm_taken as (
    select s.card_id from src s
     where s.tm is not null
       and exists (select 1 from cards c
                    where c.transfermarkt_id = s.tm and c.id <> s.card_id)
  ),
  tm_dedup as (
    select distinct on (s.tm) s.card_id, s.tm
      from src s
     where s.tm is not null
       and not exists (select 1 from tm_taken t where t.card_id = s.card_id)
     order by s.tm, s.card_id
  ),
  final as (
    select s.card_id, s.qid, t.tm, s.country
      from src s left join tm_dedup t on t.card_id = s.card_id
  ),
  upd as (
    -- Пишется только там, где значения ещё нет: ручная правка не
    -- перетирается, повтор прогона — no-op. country дописывается лишь
    -- пустой: у карточки уже может стоять страна, выбранная человеком.
    update cards c
       set wikidata_qid     = coalesce(c.wikidata_qid, f.qid),
           transfermarkt_id = coalesce(c.transfermarkt_id, f.tm),
           country          = coalesce(c.country, f.country)
      from final f
     where f.card_id = c.id
       and ( (f.qid     is not null and c.wikidata_qid     is null)
          or (f.tm      is not null and c.transfermarkt_id is null)
          or (f.country is not null and c.country          is null) )
    returning c.id
  )
  select (select count(*) from upd),
         (select count(*) from raw),
         (select count(*) from raw r
           where r.qid is not null
             and not exists (select 1 from dedup d where d.card_id = r.card_id))
    into v_written, v_seen, v_conflicts;

  return query select v_written, v_seen, v_conflicts;
end;
$$;

-- Поимённо: какие карточки претендуют на чужой QID. Без этого «конфликтов 7»
-- — число, по которому нельзя ничего сделать.
create or replace function public.card_qid_conflicts(p_rows jsonb)
returns table (qid text, card_id uuid, card_name text,
               holder_id uuid, holder_name text, holder_active boolean)
language sql stable security definer set search_path = public as $$
  select r.qid, r.card_id, n.name, c.id, c.name, c.active
    from (select (r->>'card_id')::uuid as card_id, nullif(r->>'qid','') as qid
            from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r) r
    join cards c on c.wikidata_qid = r.qid and c.id <> r.card_id
    left join cards n on n.id = r.card_id;
$$;

revoke all on function public.card_qid_conflicts(jsonb) from public, anon, authenticated;
grant execute on function public.card_qid_conflicts(jsonb) to service_role;

revoke all on function public.apply_card_wikidata_ids(jsonb) from public, anon, authenticated;
grant execute on function public.apply_card_wikidata_ids(jsonb) to service_role;

-- --------------------------------------------------------------------------
-- 3. Запись стоимости — тоже одной транзакцией
--
-- Здесь coalesce НЕ используется: стоимость меняется, и новая оценка должна
-- перетирать старую. Защита другая — дата: значение, снятое раньше того, что
-- уже лежит, отбрасывается, иначе повторный прогон со старым кешем откатил бы
-- цену назад и выглядел бы как «источник переоценил».
-- --------------------------------------------------------------------------
create or replace function public.apply_card_market_values(p_rows jsonb)
returns table (written integer, seen integer)
language plpgsql security definer set search_path = public as $$
declare
  v_written integer;
  v_seen    integer;
begin
  with src as (
    select (r->>'card_id')::uuid            as card_id,
           (r->>'value_eur')::bigint        as value_eur,
           nullif(r->>'valued_at','')::date as valued_at
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
     where (r->>'card_id') is not null
       and coalesce((r->>'value_eur')::bigint, 0) > 0
  ), upd as (
    update cards c
       set market_value_eur = s.value_eur,
           market_value_at  = s.valued_at
      from src s
     where s.card_id = c.id
       and (c.market_value_at is null
            or s.valued_at is null
            or s.valued_at >= c.market_value_at)
       and (c.market_value_eur is distinct from s.value_eur
            or c.market_value_at is distinct from s.valued_at)
    returning c.id
  )
  select (select count(*) from upd), (select count(*) from src)
    into v_written, v_seen;

  return query select v_written, v_seen;
end;
$$;

revoke all on function public.apply_card_market_values(jsonb) from public, anon, authenticated;
grant execute on function public.apply_card_market_values(jsonb) to service_role;

-- --------------------------------------------------------------------------
-- 4. Стоимость клуба = сумма по СОСТАВУ, считается при чтении
--
-- ⚠️ ЧИСЛО ОБЯЗАНО ПРИЕХАТЬ ВМЕСТЕ С ТЕМ, ИЗ СКОЛЬКИХ ОНО СОБРАНО. Сумма по
-- трём оценённым игрокам из двадцати восьми — не «стоимость клуба», и
-- показанная в одиночку она врёт ровно так же уверенно, как «1-е место» без
-- размера таблицы. Поэтому функция возвращает и priced, и squad, а экран
-- молчит там, где покрытие мало.
-- --------------------------------------------------------------------------
create or replace function public.club_market_value(p_club_key text)
returns table (total_eur bigint, priced integer, squad integer)
language sql stable security definer set search_path = public as $$
  select coalesce(sum(c.market_value_eur), 0)::bigint,
         count(*) filter (where c.market_value_eur is not null)::int,
         count(*)::int
    from club_squad q
    join cards c on c.id = q.card_id
   where q.club_key = p_club_key and q.left_at is null;
$$;

grant execute on function public.club_market_value(text)
  to anon, authenticated, service_role;

-- Индекс: и сумма по составу, и «самые дорогие» читают эту колонку.
create index if not exists cards_market_value_idx
  on cards (market_value_eur desc nulls last) where market_value_eur is not null;

NOTIFY pgrst, 'reload schema';
