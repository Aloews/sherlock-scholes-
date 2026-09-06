-- Клубы в коллекцию: карточка каждому клубу справочника, у которого есть герб.
--
-- ЗАЧЕМ. Замер 06.09.2026: в `football_club` 1545 клубов, а карточек категории
-- `club` — 430. То есть больше тысячи клубов в коллекции не показывались
-- вовсе, хотя герб, латинское имя и лига у них уже собраны.
--
-- ⚠️ ВНЕШНИХ ЗАПРОСОВ ЗДЕСЬ НЕТ НИ ОДНОГО. Всё, из чего состоит клубная
-- карточка, уже лежит в справочнике: имя, `name_en`, герб. Поэтому это SQL, а
-- не сборщик: ходить некуда.
--
-- ⚠️ ТОЛЬКО С ГЕРБОМ. Клубная карточка без картинки — пустая плашка на экране
-- коллекции; лучше её не заводить, чем заводить пустой. Клубы без герба
-- закроются, когда до них дойдёт шаг эмблем ESPN.
--
-- ⚠️ СТРАНА НЕ СТАВИТСЯ, И ЭТО СОГЛАСОВАНО С СУЩЕСТВУЮЩИМИ. У клубных
-- карточек `country` пуст (проверено на «Манчестер Юнайтед», «Арсенал»,
-- «Ливерпуль»), а в справочнике страна лежит РУССКИМ НАЗВАНИЕМ («Германия»),
-- тогда как колода хранит код ISO. Отображать одно в другое словарём здесь
-- значит завести правило, которого больше нигде нет.
--
-- ⚠️ ДУБЛЬ ЛОВИТСЯ ПО ОБЕИМ СТОРОНАМ: и по уже связанной карточке
-- (`football_club.card_id`), и по совпадению нормализованного имени с
-- существующей клубной карточкой. Одного мало: часть клубов связана, часть
-- заведена карточкой без связи.

create or replace function public.create_cards_from_clubs()
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
  create temp table _cl on commit drop as
  select fc.club_key,
         btrim(fc.name)                       as name,
         nullif(btrim(fc.name_en), '')        as name_en,
         fc.crest_url,
         fc.wikidata_qid
    from football_club fc
   where fc.kind = 'club'
     and fc.card_id is null
     and fc.crest_url is not null
     and coalesce(btrim(fc.name), '') <> ''
     -- Уже есть карточка с таким же нормализованным именем — не вторая.
     and not exists (
       select 1 from cards c
        where c.category = 'club'
          and club_norm_key(coalesce(c.name_en, c.name)) = club_norm_key(coalesce(fc.name_en, fc.name)))
     and (fc.wikidata_qid is null
          or not exists (select 1 from cards c2 where c2.wikidata_qid = fc.wikidata_qid));

  select count(*) into v_seen from pg_temp._cl;

  -- Два клуба, сводящиеся к одному ключу, — не два клуба. Берём по одному.
  create temp table _one on commit drop as
  select distinct on (club_norm_key(coalesce(name_en, name))) *
    from pg_temp._cl
   order by club_norm_key(coalesce(name_en, name)), club_key;

  select v_seen - count(*) into v_skipped from pg_temp._one;

  with ins as (
    insert into cards (name, name_en, category, category_ru, difficulty,
                       forbidden_words, photo_url, active, wikidata_qid, created_at)
    select o.name, o.name_en, 'club', 'клубы', 'medium',
           (select array_agg(distinct w) from (
              select o.name as w
              union
              select unnest(string_to_array(o.name, ' '))
            ) t where length(btrim(w)) > 1),
           o.crest_url, true, o.wikidata_qid, now()
      from pg_temp._one o
    returning id, name
  ),
  lnk as (
    update football_club fc set card_id = i.id
      from ins i, pg_temp._one o
     where o.name = i.name and fc.club_key = o.club_key and fc.card_id is null
    returning 1
  )
  select (select count(*) from ins), (select count(*) from lnk)
    into v_created, v_linked;

  drop table pg_temp._one;
  drop table pg_temp._cl;
  return query select v_created, v_linked, v_skipped, v_seen;
end;
$function$;

comment on function public.create_cards_from_clubs() is
  'Заводит карточку коллекции каждому клубу справочника, у которого есть герб '
  'и ещё нет карточки. Внешних запросов не делает: всё уже в football_club.';

revoke all on function public.create_cards_from_clubs() from public;
grant execute on function public.create_cards_from_clubs() to service_role;
