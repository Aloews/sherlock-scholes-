-- ============================================================================
-- ТРАНСФЕРЫ: РАСПИСАНИЕ ОБНОВЛЕНИЯ И РЕЙТИНГ САМЫХ ДОРОГИХ ПЕРЕХОДОВ.
--
-- Владелец спросил: «будет ли обновление трансферов каждые три месяца?»
--
-- ⚠️ ЧЕСТНЫЙ ОТВЕТ НА ТОТ МОМЕНТ БЫЛ «НЕТ, НИКОГДА». Скрипт
-- `docs/players_transfers_transfermarkt.py` был написан и один раз прогнан —
-- последний сбор 08.09.2026, 67 392 строки на 8 237 игроков, — но он не стоял
-- НИ В ОДНОМ расписании: ни в pg_cron, ни в одном workflow. Проверено обоими
-- запросами: `cron.job` со словом transfer — пусто, `grep transfer
-- .github/workflows/` — только чужие строки.
--
-- ⚠️ И ДАЖЕ ЗАПУЩЕННЫЙ КАЖДУЮ НОЧЬ, ОН НЕ ЛОВИЛ БЫ НОВЫЕ ПЕРЕХОДЫ. Его отбор
-- звучал как «взять тех, у кого истории ещё НЕТ». У человека, собранного в
-- сентябре, история есть — значит его январский переход не пришёл бы никогда.
-- Это тот же класс ошибки, что «ноль минут» у игрока, чью статистику мы просто
-- не собирали: отсутствие записи прочитано как отсутствие события.
--
-- ЧТО СДЕЛАНО. Отбор переехал в базу (`transfers_to_refresh`), а в ночной
-- обход добавлены два шага: новички и доза устаревших.
--
--     8 237 игроков / 150 за ночь ≈ 55 ночей
--
-- То есть каждый игрок обновляется ЧАЩЕ, чем раз в три месяца, а
-- Transfermarkt получает полторы сотни вежливых запросов за ночь вместо
-- восьми тысяч в один день. Квартальный залп был бы хуже и по нагрузке, и по
-- делу: трансферное окно закрывается в начале сентября, и обход «раз в
-- квартал» мог бы разминуться с ним на два месяца.
--
-- ⚠️ ПОЧЕМУ ОТБОР В SQL, А НЕ В СКРИПТЕ. Первая версия считала свежесть в
-- питоне и для этого читала `player_transfer` через PostgREST — 67 392 строки
-- постранично. Живой прогон ответил **504 Gateway Timeout**, то есть доза по
-- свежести не работала вовсе, молча. Здесь та же выборка сворачивается в базе
-- и отдаёт ровно дозу.
-- ============================================================================

create or replace function public.transfers_to_refresh(
  p_min_value  bigint  default 600000,
  p_stale_days integer default 0,
  p_limit      integer default 150)
returns table (card_id uuid, name_en text, transfermarkt_id text,
               market_value_eur bigint, last_fetched timestamptz)
language sql stable security definer
set search_path = public set statement_timeout = '60s'
as $$
  with last_seen as (
    select t.tm_player_id, max(t.fetched_at) as seen
      from player_transfer t
     group by t.tm_player_id
  )
  select c.id, c.name_en, c.transfermarkt_id, c.market_value_eur, l.seen
    from cards c
    left join last_seen l on l.tm_player_id = c.transfermarkt_id
   where c.active and c.category = 'player'
     and c.transfermarkt_id is not null
     and c.market_value_eur >= p_min_value
     -- ⚠️ НИКОГДА НЕ ОБОЙДЁННЫЙ БЕРЁТСЯ ВСЕГДА, при любом p_stale_days. Иначе
     -- доза по свежести молча не забирала бы новичков колоды, и «обновление
     -- раз в квартал» работало бы только для тех, кто уже есть.
     and (l.seen is null
          or (p_stale_days > 0
              and l.seen < now() - make_interval(days => p_stale_days)))
   -- От дорогих: при обрыве прогона сделанным окажется то, что важнее.
   order by c.market_value_eur desc nulls last
   limit greatest(coalesce(p_limit, 150), 1);
$$;

comment on function public.transfers_to_refresh(bigint, integer, integer) is
  'Кого обойти за историей трансферов: никогда не собранные плюс те, чья '
  'запись старше p_stale_days. От дорогих. Считается в базе — чтение всей '
  'player_transfer через PostgREST отвечало 504.';

-- ⚠️ ТОЛЬКО service_role: это служебный отбор для ночного обхода, а не экран.
revoke all on function public.transfers_to_refresh(bigint, integer, integer) from public;
grant execute on function public.transfers_to_refresh(bigint, integer, integer) to service_role;

-- ── Рейтинг самых дорогих переходов ─────────────────────────────────────────
-- Владелец: «рейтинг самых дорогих трансферов внутри рейтинга самых дорогих
-- футболистов». Живёт блоком на экране рейтинга, под сортировкой «Стоимость»:
-- слева сколько игрок СТОИТ сегодня, ниже — сколько за него однажды
-- ЗАПЛАТИЛИ.

create or replace function public.top_transfers(
  p_lang  text    default 'ru',
  p_limit integer default 20,
  p_since date    default null)
returns table (
  card_id uuid, name text, name_en text, photo_url text,
  fee_eur bigint, moved_on date, season text,
  from_club text, to_club text)
language sql stable security definer
set search_path = public set statement_timeout = '20s'
as $$
  -- ⚠️ ОДНА СТРОКА — ОДИН ПЕРЕХОД, А НЕ ОДИН ИГРОК. Это рейтинг ТРАНСФЕРОВ:
  -- у Неймара их два дорогих, и схлопывать их в игрока значило бы потерять
  -- второй и превратить этот список во второй рейтинг игроков. Соседний
  -- список на том же экране считает именно игроков — в этом вся разница.
  select c.id, c.name, c.name_en, c.photo_url,
         t.fee_eur, t.moved_on, t.season,
         -- Клубы приходят строками с Transfermarkt. Если такой клуб есть у
         -- нас — показываем НАШЕ название на языке читателя, иначе исходное:
         -- пустое место вместо клуба хуже латиницы.
         coalesce(club_display_name(fc.club_key, p_lang), t.from_club),
         coalesce(club_display_name(tc.club_key, p_lang), t.to_club)
    from player_transfer t
    join cards c on c.id = t.card_id and c.active and c.category = 'player'
    left join football_club fc on fc.transfermarkt_id = t.from_tm_id
    left join football_club tc on tc.transfermarkt_id = t.to_tm_id
   where t.fee_eur is not null
     -- ⚠️ БУДУЩЕЕ ОТСЕКАЕТСЯ. В таблице есть переходы с датой 2027-07-01 —
     -- объявленные заранее. Они ещё не состоялись, и в рейтинге состоявшихся
     -- им не место; проверено, что такие строки там действительно есть.
     and t.moved_on <= current_date
     and (p_since is null or t.moved_on >= p_since)
   order by t.fee_eur desc, t.moved_on desc
   limit greatest(coalesce(p_limit, 20), 1);
$$;

comment on function public.top_transfers(text, integer, date) is
  'Самые дорогие СОСТОЯВШИЕСЯ переходы: строка — переход, а не игрок. '
  'Объявленные заранее (дата в будущем) не показываются.';

revoke all on function public.top_transfers(text, integer, date) from public;
grant execute on function public.top_transfers(text, integer, date)
  to anon, authenticated, service_role;
