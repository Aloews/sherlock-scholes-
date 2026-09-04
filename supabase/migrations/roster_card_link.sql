-- Мост «строка полного состава ↔ карточка колоды».
--
-- ЗАЧЕМ. `apply_club_roster` связывает строку ростера с карточкой только по
-- `cards.transfermarkt_id`, а его не было у 1783 активных карточек игроков:
-- 1633 строки из 2644 остались без карточки. Читалось это как «состав шире
-- колоды» — и проверка в check-prod РАДОВАЛАСЬ этому числу. На деле Беллингем
-- в колоде ЕСТЬ: активная карточка с фото, он стоит в `card_current_club` у
-- «Реала», то есть и в фэнтези. Не было моста, а не карточки.
--
-- ДВА ПУТИ, ОБА НА РАВЕНСТВЕ, НИ ОДНОГО НА ПОХОЖЕСТИ:
--   1) id на Transfermarkt → (wdt:P2446, обратно) → QID → cards.wikidata_qid;
--   2) точное латинское имя, суженное клубом (`card_current_club`).
-- Первый шаг цепочки — обратный поиск по WDQS, он живёт в
-- `docs/roster_link_cards.py`; сопоставление — здесь, потому что словарь
-- псевдонимов клубов у базы.
--
-- ⚠️ НЕОДНОЗНАЧНОСТЬ — ОТКАЗ, А НЕ ВЫБОР. `name_en` не уникален по человеку:
-- у «Родри» две РАЗНЫЕ активные карточки (Родриго Эрнандес и Родриго Санчес
-- Родригес), у «Витиньи» тоже. Пара берётся, только если она единственная с
-- ОБЕИХ сторон в пределах клуба; иначе строка считается неоднозначной и
-- возвращается числом `ambiguous` — по ОБОИМ путям, — а не связывается наугад. Тот же отказ, что у эмблем
-- ESPN, и по той же причине: «Vitória S.C.» едва не получил чужой герб.
--
-- ⚠️ ТОЛЬКО АКТИВНЫЕ КАРТОЧКИ. У половины дублей колоды одна карточка
-- погашена (`active = false`) намеренно; связать ростер с погашенной значит
-- воскресить её на экране клуба.

create or replace function public.link_roster_to_cards(p_rows jsonb)
returns table(by_qid integer, by_name integer, ambiguous integer)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_qid  integer := 0;
  v_name integer := 0;
  v_amb  integer := 0;
begin
  create temp table _link on commit drop as
  select r->>'tm_player_id' as tm_player_id,
         nullif(r->>'qid','') as qid
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where coalesce(r->>'tm_player_id','') <> '';

  with pairs as (
    select distinct l.tm_player_id, c.id as card_id
      from pg_temp._link l
      join cards c on c.wikidata_qid = l.qid
     where l.qid is not null and c.active
  ),
  clean as (
    select p.* from pairs p
     where 1 = (select count(*) from pairs x where x.tm_player_id = p.tm_player_id)
       and 1 = (select count(*) from pairs y where y.card_id = p.card_id)
  ),
  upd_cards as (
    update cards c set transfermarkt_id = k.tm_player_id
      from clean k
     where c.id = k.card_id and c.transfermarkt_id is null
       and not exists (select 1 from cards o
                        where o.transfermarkt_id = k.tm_player_id and o.id <> c.id)
    returning 1
  ),
  upd_roster as (
    update club_roster r set card_id = k.card_id
      from clean k
     where r.tm_player_id = k.tm_player_id and r.card_id is null
    returning 1
  )
  select (select count(*) from upd_roster),
         (select count(*) from pairs) - (select count(*) from clean)
    into v_qid, v_amb;

  with cand as (
    select r.club_key, r.tm_player_id, c.id as card_id
      from club_roster r
      join card_current_club cc on cc.resolved_key = r.club_key
      join cards c on c.id = cc.card_id
     where r.card_id is null
       and c.active                     -- см. шапку: погашенный дубль не кандидат
       and c.name_en is not null
       and lower(btrim(c.name_en)) = lower(btrim(r.name))
  ),
  clean2 as (
    select d.* from cand d
     where 1 = (select count(*) from cand x
                 where x.club_key = d.club_key and x.tm_player_id = d.tm_player_id)
       and 1 = (select count(*) from cand y
                 where y.club_key = d.club_key and y.card_id = d.card_id)
  ),
  upd2 as (
    update club_roster r set card_id = k.card_id
      from clean2 k
     where r.club_key = k.club_key and r.tm_player_id = k.tm_player_id
       and r.card_id is null
    returning 1
  ),
  upd2_cards as (
    update cards c set transfermarkt_id = k.tm_player_id
      from clean2 k
     where c.id = k.card_id and c.transfermarkt_id is null
       and not exists (select 1 from cards o
                        where o.transfermarkt_id = k.tm_player_id and o.id <> c.id)
    returning 1
  )
  -- ⚠️ ОТКАЗ ОБЯЗАН БЫТЬ СЛЫШЕН. Отброшенные по QID уже сосчитаны выше;
  -- здесь прибавляются отброшенные по имени. Молчаливый отказ неотличим от
  -- «сопоставлять было нечего», и проверка на нём зеленеет впустую.
  select (select count(*) from upd2),
         v_amb + (select count(*) from cand) - (select count(*) from clean2)
    into v_name, v_amb;

  drop table pg_temp._link;
  return query select v_qid, v_name, v_amb;
end;
$function$;

comment on function public.link_roster_to_cards(jsonb) is
  'Связывает club_roster с карточками по QID и по точному имени в клубе. '
  'Неоднозначную пару НЕ берёт, возвращает её числом.';

-- ⚠️ ВТОРОЙ ШАГ, БЕЗ КОТОРОГО ПОЧИНКА НЕ ЗАКАНЧИВАЕТСЯ. У 120 карточек QID
-- пришлось снять: он указывал на страницу ФАМИЛИИ («Беллингем» → Q16479897,
-- «Bellingham (surname)») или на однофамильца-персонажа («Халк» → Q188760,
-- Marvel, слава 90). По тем же страницам сняты просмотры, поэтому слава этих
-- карточек была ложью. Ночной резолв идёт ПО ИМЕНИ и с новым P31-гардом ту же
-- страницу теперь отвергнет — то есть карточка осталась бы без QID навсегда.
-- Ростер даёт верный QID по идентификатору, а не по названию статьи.
create or replace function public.backfill_card_qid_from_roster(p_rows jsonb)
returns table(written integer, taken integer)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_written integer := 0;
  v_taken   integer := 0;
begin
  create temp table _q on commit drop as
  select r->>'tm_player_id' as tm_player_id, nullif(r->>'qid','') as qid
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where coalesce(r->>'tm_player_id','') <> '' and coalesce(r->>'qid','') <> '';

  with cand as (
    -- Один QID на одну карточку: если на карточку претендуют два разных QID
    -- (две строки ростера в разных клубах), не берём ни одного.
    select distinct cr.card_id, q.qid
      from club_roster cr
      join pg_temp._q q on q.tm_player_id = cr.tm_player_id
      join cards c on c.id = cr.card_id
     where cr.card_id is not null and c.wikidata_qid is null
  ),
  clean as (
    select d.* from cand d
     where 1 = (select count(*) from cand x where x.card_id = d.card_id)
       and 1 = (select count(*) from cand y where y.qid = d.qid)
  ),
  upd as (
    update cards c set wikidata_qid = k.qid
      from clean k
     where c.id = k.card_id and c.wikidata_qid is null
       and not exists (select 1 from cards o
                        where o.wikidata_qid = k.qid and o.id <> c.id)
    returning 1
  )
  select (select count(*) from upd),
         (select count(*) from cand) - (select count(*) from clean)
    into v_written, v_taken;

  drop table pg_temp._q;
  return query select v_written, v_taken;
end;
$function$;

comment on function public.backfill_card_qid_from_roster(jsonb) is
  'Дописывает карточке верный QID по её id на Transfermarkt. Занятый другой '
  'карточкой QID пропускает и возвращает числом.';

-- Гранты перечислены явно: обе функции ПИШУТ, игроку они не нужны.
revoke all on function public.link_roster_to_cards(jsonb) from public;
revoke all on function public.backfill_card_qid_from_roster(jsonb) from public;
grant execute on function public.link_roster_to_cards(jsonb) to service_role;
grant execute on function public.backfill_card_qid_from_roster(jsonb) to service_role;
