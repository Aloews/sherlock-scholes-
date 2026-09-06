-- Карточка игрока из состава клуба — по идентификатору, БЕЗ ру-статьи.
--
-- ЧТО МЕШАЛО ЗАВЕСТИ МИРОВОГО ИГРОКА. Резолв в `scraper/wikidata.py` описан
-- прямо в его шапке: «footballer match WITH a ruwiki article → name_ru set,
-- source=wikidata, high; no russian article → name_ru=null, source=none, low».
-- То есть футболист без статьи в РУССКОЙ Википедии карточкой стать не мог в
-- принципе, сколько бы о нём ни знал остальной мир. Здесь этого гейта нет:
-- имя берётся из ЛЮБЫХ языковых ярлыков Викиданных, а ру — лишь один из них.
--
-- ⚠️ КАРТОЧКИ ЗАВОДЯТСЯ АКТИВНЫМИ — ЭТО РЕШЕНИЕ ВЛАДЕЛЬЦА, И ОНО ОТМЕНЯЕТ
-- ПРЕЖНЕЕ ПРАВИЛО. В проекте записано «заводить недостающим голые карточки
-- нельзя, колода уже портилась так», и первая версия этой функции заводила
-- их погашенными именно поэтому. Владелец на это ответил прямо: приложение
-- теперь про футболистов и их статистику, нынешних игроков «уже все выучили
-- и они повторяются», и нужны АБСОЛЮТНО ВСЕ футболисты. Редкий игрок здесь
-- не брак колоды, а то, ради чего она заводится.
--
-- Что это значит на деле, чтобы никто потом не искал поломку:
-- `cards_matching` отбирает по `c.active`, а `fame_min` в нём НЕОБЯЗАТЕЛЕН —
-- значит игра без фильтра будет раздавать и малоизвестных. Порог `fame_min`
-- остаётся тем рычагом, которым игрок сужает колоду до знаменитых.
--
-- ⚠️ `langs` НЕ СТАВИТСЯ ВОВСЕ (NULL — «во всех языках»). Отсечь игрока без
-- русского ярлыка от русской игры значило бы оставить русского игрока с той
-- же заученной колодой — ровно с тем, на что владелец и жалуется. Имя тогда
-- берётся латиницей: «Lovend's Delinois» на карточке читается и объясняется,
-- а требование статьи в ру-вики — это про ПОЛЬЗОВАТЕЛЯ, а не про игрока.

create or replace function public.create_cards_from_roster(p_rows jsonb)
returns table(created integer, linked integer, skipped integer, seen integer)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_created integer := 0;
  v_linked  integer := 0;
  v_skipped integer := 0;
  v_seen    integer := 0;
begin
  create temp table _cr on commit drop as
  select r->>'tm_player_id'          as tm_player_id,
         nullif(r->>'qid','')        as qid,
         nullif(btrim(r->>'name_ru'),'') as name_ru,
         nullif(btrim(r->>'name_en'),'') as name_en,
         nullif(r->>'country','')    as country,
         case when jsonb_typeof(r->'langs') = 'array'
              then array(select jsonb_array_elements_text(r->'langs')) end as langs
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where coalesce(r->>'tm_player_id','') <> '';

  select count(*) into v_seen from pg_temp._cr;

  -- ⚠️ ЧЕЛОВЕК УЖЕ В КОЛОДЕ — НЕ ЗАВОДИТЬ ВТОРОГО. Проверка по ОБОИМ
  -- идентификаторам: 19 дублей колоды поймал в своё время именно уникальный
  -- индекс по QID, которого сравнение имён не видело.
  create temp table _fresh on commit drop as
  select c.* from pg_temp._cr c
   where coalesce(c.name_ru, c.name_en) is not null
     and not exists (select 1 from cards x where x.transfermarkt_id = c.tm_player_id)
     and (c.qid is null
          or not exists (select 1 from cards x where x.wikidata_qid = c.qid))
     -- Одна и та же цель дважды в пачке — тоже повод не заводить наугад.
     and 1 = (select count(*) from pg_temp._cr y where y.tm_player_id = c.tm_player_id)
     and (c.qid is null
          or 1 = (select count(*) from pg_temp._cr z where z.qid = c.qid));

  select v_seen - count(*) into v_skipped from pg_temp._fresh;

  with ins as (
    insert into cards (name, name_en, category, category_ru, difficulty,
                       forbidden_words, country, langs, active,
                       wikidata_qid, transfermarkt_id, created_at)
    select coalesce(f.name_ru, f.name_en),
           f.name_en,
           'player', 'игроки', 'medium',
           -- Запретные слова — само имя и его части, как у существующих
           -- карточек («Зинедин Зидан» → {Зинедин Зидан, Зинедин, Зидан}).
           (select array_agg(distinct w) from (
              select coalesce(f.name_ru, f.name_en) as w
              union
              select unnest(string_to_array(coalesce(f.name_ru, f.name_en), ' '))
            ) t where length(btrim(w)) > 1),
           f.country,
           f.langs,                   -- сборщик присылает null, см. шапку
           true,                      -- см. шапку: решение владельца
           f.qid, f.tm_player_id, now()
      from pg_temp._fresh f
    returning id, transfermarkt_id
  ),
  lnk as (
    update club_roster r set card_id = i.id
      from ins i
     where r.tm_player_id = i.transfermarkt_id and r.card_id is null
    returning 1
  )
  select (select count(*) from ins), (select count(*) from lnk)
    into v_created, v_linked;

  drop table pg_temp._fresh;
  drop table pg_temp._cr;
  return query select v_created, v_linked, v_skipped, v_seen;
end;
$function$;

comment on function public.create_cards_from_roster(jsonb) is
  'Заводит карточку игрока из состава клуба по его id на Transfermarkt, без '
  'требования статьи в ру-Википедии. Карточка активна: владелец решил, что '
  'нужны все футболисты, а не только заученные.';

revoke all on function public.create_cards_from_roster(jsonb) from public;
grant execute on function public.create_cards_from_roster(jsonb) to service_role;
