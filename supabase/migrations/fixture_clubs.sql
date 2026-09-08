-- Клубы матчей для экрана «Ближайшие матчи».
-- ==========================================================================
--
-- Владелец: «нужно экран „ближайших матчей“ доделать до уровня, того
-- отображения, что на главной. Но оставить составы и стоимость считать у двух
-- клубов».
--
-- На главной матч выглядит так: две эмблемы, названия клубов на языке
-- читателя, турнир и «через 25 минут». В списке матчей до сих пор были только
-- английские названия от провайдера расписания и время — потому что `fixtures`
-- хранит `home_team`/`away_team` строками провайдера и ничего о клубе не знает.
--
-- Эта функция и есть недостающий мост: по списку id матчей отдаёт то же, что
-- top_fixtures отдаёт для главной, плюс стоимость и размер состава КАЖДОГО из
-- двух клубов по отдельности — их владелец просил оставить, а не сворачивать
-- в одну сумму, как на главной.
--
-- ⚠️ ВТОРОЙ КОПИИ ПРАВИЛА СОПОСТАВЛЕНИЯ ЗДЕСЬ НЕТ. Имя команды превращает в
-- club_key ровно та же `resolve_club_key`, что и в top_fixtures. Своя копия
-- правила означала бы, что «Зенит» на главной и «Зенит» в списке матчей
-- однажды разойдутся — молча и в одну сторону.
--
-- ⚠️ ПО СПИСКУ ID, А НЕ ПО ОКНУ ВРЕМЕНИ. У экрана два режима: список
-- ближайших и календарь, который показывает и уже сыгранные дни. Окно «от
-- сейчас» покрыло бы только первый, и в календаре эмблемы молча исчезли бы.
--
-- Замеры на 120 матчах, прогретый кеш:
--   `club_key in (подзапрос)`      2 179 мс, 22 425 буферов
--   соединение по списку ключей      210 мс — так и оставлено
--   свёртка по всем 1 005 клубам   1 736 мс (как в top_fixtures) — не нужна:
--                                  клубов у этих матчей 168

create or replace function public.fixture_clubs(
  p_ids  text[],
  p_lang text default 'ru'
) returns table (
  fixture_id       text,
  home_key         text,
  home_name        text,
  home_crest       text,
  home_value       bigint,
  home_squad       integer,
  away_key         text,
  away_name        text,
  away_crest       text,
  away_value       bigint,
  away_squad       integer,
  minutes_to_start integer
)
language sql
stable
security definer
set search_path = public
set statement_timeout = '20s'
as $$
  -- ⚠️ ВТОРОЙ КОПИИ ПРАВИЛА СОПОСТАВЛЕНИЯ ЗДЕСЬ НЕТ. Название команды из
  -- расписания превращает в наш club_key ровно та же resolve_club_key, что и
  -- в top_fixtures: иначе «Зенит» на главной и «Зенит» в списке матчей
  -- разошлись бы молча.
  with want as materialized (
    select f.id, f.commence_at,
           resolve_club_key(f.home_team, null) as hk,
           resolve_club_key(f.away_team, null) as ak
      from fixtures f
     where f.id = any(coalesce(p_ids, '{}'::text[]))
  ),
  keys as materialized (
    select w.hk as k from want w where w.hk is not null
    union
    select w.ak from want w where w.ak is not null
  ),
  -- ⚠️ СОЕДИНЕНИЕ ПО СПИСКУ КЛЮЧЕЙ, А НЕ `club_key in (подзапрос)`. Разница
  -- измерена на тех же 120 матчах: соединение — 210 мс на всю функцию, `in`
  -- с подзапросом — 2 179 мс. Свёртка по ВСЕМ 1 005 клубам (как в
  -- top_fixtures) стоит 1 736 мс и здесь не нужна: клубов этих матчей 168.
  --
  -- ⚠️ size — ВЕСЬ СОСТАВ, а value — только те, у кого есть цена. Это разные
  -- числа, и подписаны они на экране порознь: «22 игрока» и сумма. Считать
  -- составом только оценённых значило бы называть неполноту размером клуба.
  squad as materialized (
    select cc.club_key,
           sum(c.market_value_eur)::bigint as value,
           count(*)::integer as size
      from card_current_club cc
      join keys k on k.k = cc.club_key
      join cards c on c.id = cc.card_id and c.active and c.category = 'player'
     group by cc.club_key
  )
  select w.id,
         w.hk,
         case when w.hk is null then null else club_display_name(w.hk, p_lang) end,
         hc.crest_url, hs.value, coalesce(hs.size, 0),
         w.ak,
         case when w.ak is null then null else club_display_name(w.ak, p_lang) end,
         ac.crest_url, as_.value, coalesce(as_.size, 0),
         -- Минуты до начала считает БАЗА: часы телефона врут молча.
         (extract(epoch from (w.commence_at - now())) / 60)::integer
    from want w
    left join football_club hc on hc.club_key = w.hk
    left join football_club ac on ac.club_key = w.ak
    left join squad hs on hs.club_key = w.hk
    left join squad as_ on as_.club_key = w.ak;
$$;

comment on function public.fixture_clubs(text[], text) is
  'Клубы матчей списком id: эмблема, название на языке читателя, стоимость и размер состава, минуты до начала. Сопоставление имени команды с club_key — той же resolve_club_key, что и в top_fixtures.';

revoke all on function public.fixture_clubs(text[], text) from public;
grant execute on function public.fixture_clubs(text[], text) to anon, authenticated, service_role;
