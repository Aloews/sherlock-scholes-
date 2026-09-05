-- Мост «клуб → Викиданные → Transfermarkt», для клубов, которых у нас ещё нет.
--
-- ЗАЧЕМ ВТОРОЙ МОСТ, КОГДА ЕСТЬ ГОЛОСОВАНИЕ. Голосование игроков
-- (`clubs_roster_transfermarkt.py`) строит `verein` по составу, который у нас
-- УЖЕ есть: до пяти игроков с известным `cards.transfermarkt_id`. Для клуба,
-- впервые появившегося в расписании, голосовать некому — игроков ноль, и
-- состав ему не собрать НИКОГДА. Замер 05.09.2026: в расписании 435 клубов,
-- мост есть у 76.
--
-- ⚠️ P7223, А НЕ ДОГАДКА О НОМЕРЕ СВОЙСТВА. Проверено на «Челси»: Q9616 несёт
-- P7223 = 631, и это ровно тот `verein/631`, который у нас уже стоял. Дальше
-- сверено глазами на выборке: Кёльн 3, Аякс 610, Байер 15, Юнион Берлин 89,
-- Анже 1420, Гвадалахара 6711 — все верны.
--
-- ⚠️ НЕОДНОЗНАЧНОСТЬ — ОТКАЗ. У «Анже» Викиданные знают и основную команду, и
-- «Angers SCO II»; берётся та, чей английский ярлык РАВЕН нашему имени, и
-- только если такая одна. Где точного равенства нет («Viktoria Plzeň» против
-- ярлыка «FC Viktoria Plzeň») — не берём ничего. На выборке из десяти это
-- шесть взятых и четыре отказа: отказ дешевле чужого клуба, что уже доказано
-- «Страсбуром», получившим заявку «Челси».
--
-- ⚠️ ЧУЖОЙ МОСТ НЕ ПЕРЕЗАПИСЫВАЕТСЯ. Существующий `transfermarkt_id` добыт
-- голосованием и подтверждён выкачанным составом; эта функция только
-- ЗАПОЛНЯЕТ пустое. И `verein`, уже занятый другим клубом, пропускается со
-- счётчиком, а не роняет пачку: уникальный индекс
-- `football_club_transfermarkt_id_uniq` иначе отменил бы всю транзакцию
-- из-за одной строки.

alter table football_club add column if not exists wikidata_qid text;

alter table football_club drop constraint if exists football_club_wikidata_qid_format;
alter table football_club add constraint football_club_wikidata_qid_format
  check (wikidata_qid is null or wikidata_qid ~ '^Q[1-9][0-9]*$');

-- Один QID — один клуб, той же природы, что и индекс по `verein`.
create unique index if not exists football_club_wikidata_qid_uniq
    on football_club (wikidata_qid) where wikidata_qid is not null;

comment on column football_club.wikidata_qid is
  'QID клуба в Викиданных. Резолв — по name_en с обязательным P7223 и отказом '
  'при неоднозначности; см. docs/clubs_transfermarkt_id_wikidata.py.';

create or replace function public.apply_club_transfermarkt_ids(p_rows jsonb)
returns table(written integer, taken integer, seen integer)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_written integer := 0;
  v_taken   integer := 0;
  v_seen    integer := 0;
begin
  create temp table _cb on commit drop as
  select r->>'club_key'                    as club_key,
         nullif(r->>'transfermarkt_id','') as tm_id,
         nullif(r->>'qid','')              as qid
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where coalesce(r->>'club_key','') <> '';

  select count(*) into v_seen from pg_temp._cb;

  -- Одна и та же цель дважды в пачке — тоже неоднозначность, а не «повезёт».
  with cand as (
    select b.club_key, b.tm_id, b.qid
      from pg_temp._cb b
      join football_club fc on fc.club_key = b.club_key
     where fc.transfermarkt_id is null
       and b.tm_id is not null
       and 1 = (select count(*) from pg_temp._cb x where x.tm_id = b.tm_id)
       and 1 = (select count(*) from pg_temp._cb y where y.club_key = b.club_key)
  ),
  free as (
    select c.* from cand c
     where not exists (select 1 from football_club o
                        where o.transfermarkt_id = c.tm_id and o.club_key <> c.club_key)
  ),
  upd as (
    update football_club fc
       set transfermarkt_id = f.tm_id,
           wikidata_qid = coalesce(fc.wikidata_qid,
                            case when not exists (select 1 from football_club o
                                                   where o.wikidata_qid = f.qid
                                                     and o.club_key <> f.club_key)
                                 then f.qid end)
      from free f
     where fc.club_key = f.club_key and fc.transfermarkt_id is null
    returning 1
  )
  select (select count(*) from upd),
         (select count(*) from cand) - (select count(*) from free)
    into v_written, v_taken;

  drop table pg_temp._cb;
  return query select v_written, v_taken, v_seen;
end;
$function$;

comment on function public.apply_club_transfermarkt_ids(jsonb) is
  'Заполняет football_club.transfermarkt_id (и QID) из Викиданных. Занятый '
  'другим клубом verein пропускает и возвращает числом; существующий мост не '
  'трогает.';

revoke all on function public.apply_club_transfermarkt_ids(jsonb) from public;
grant execute on function public.apply_club_transfermarkt_ids(jsonb) to service_role;

-- Кто реально играет — по расписанию, а не по справочнику целиком. Отбор
-- живёт здесь, потому что имя команды у провайдера сводится к нашему клубу
-- штатным `resolve_club_key` (у него словарь псевдонимов), и второй копии
-- этого правила в питоне быть не должно.
--
-- Замер 05.09.2026: 437 разных команд в `fixtures`, ВСЕ 437 разрешаются.
-- Сырое сравнение имён давало «195 неизвестных» — там были «Arsenal»,
-- «Barcelona» и «Real Madrid», состав которого у нас уже собран. Неизвестных
-- клубов нет; не хватает у известных моста, состава и стоимости.
create or replace function public.clubs_in_fixtures()
returns table(club_key text)
language sql
stable
security definer
set search_path = public
as $function$
  select distinct resolve_club_key(t.team, null) as club_key
    from (select home_team as team from fixtures
          union all
          select away_team from fixtures) t
   where resolve_club_key(t.team, null) is not null;
$function$;

comment on function public.clubs_in_fixtures() is
  'Клубы, встречающиеся в расписании матчей, сведённые к club_key штатным '
  'резолвером. Приоритет для сборщиков: сперва те, чьи матчи игрок видит.';

revoke all on function public.clubs_in_fixtures() from public;
grant execute on function public.clubs_in_fixtures() to service_role;
