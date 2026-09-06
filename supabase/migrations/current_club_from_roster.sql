-- Текущий клуб — ещё и из состава, а не только из статьи.
--
-- ЗАЧЕМ. `rebuild_card_current_clubs()` выводит клуб из ОТКРЫТОГО диапазона
-- лет в `cards.career_stats` / `legend_career` — то есть из статьи. У карточек,
-- заведённых из ростера, статьи нет и `career_stats` пуст, поэтому клуб у них
-- не появлялся вовсе: досье не могло показать ни клуб, ни его эмблему.
--
-- ⚠️ РОСТЕР ЗДЕСЬ ТОЧНЕЕ СТАТЬИ, А НЕ ХУЖЕ. `club_roster` — это заявка клуба,
-- снятая с его собственной страницы на дату, и связана она с карточкой
-- идентификатором (id на Transfermarkt / QID), а не именем. Статья же
-- обновляется, когда до неё дойдут руки.
--
-- ⚠️ ПОЭТОМУ ИСТОЧНИК НАЗВАН, А НЕ ЗАТЁРТ. `source` уже существует ровно для
-- этого — «чтобы неверную запись можно было проследить». Записи из статьи не
-- трогаются: перезапись более свежего менее свежим — не починка.
--
-- ⚠️ ИГРОК В ДВУХ ЗАЯВКАХ — ОТКАЗ. Аренда даёт две строки, и «какой-нибудь»
-- клуб на карточке хуже, чем никакой: по нему отбирается состав в игре.

create or replace function public.fill_current_club_from_roster()
returns table(written integer, ambiguous integer)
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_written integer := 0;
  v_amb     integer := 0;
begin
  create temp table _rc on commit drop as
  select r.card_id, min(r.club_key) as club_key, count(distinct r.club_key) as clubs
    from club_roster r
   where r.card_id is not null
   group by r.card_id;

  select count(*) into v_amb from pg_temp._rc where clubs > 1;

  with src as (
    select c.card_id, c.club_key, coalesce(fc.name, fc.name_en, c.club_key) as club
      from pg_temp._rc c
      join football_club fc on fc.club_key = c.club_key
     where c.clubs = 1
  ),
  ins as (
    insert into card_current_club (card_id, club, club_key, source, fetched_at)
    select s.card_id, s.club, s.club_key, 'club_roster', now() from src s
    on conflict (card_id) do nothing      -- запись из статьи не трогаем
    returning 1
  )
  select count(*) into v_written from ins;

  drop table pg_temp._rc;
  return query select v_written, v_amb;
end;
$function$;

comment on function public.fill_current_club_from_roster() is
  'Проставляет текущий клуб карточкам, у которых его нет, по заявке клуба '
  '(club_roster). Записи, выведенные из статьи, не перезаписывает; игрока в '
  'двух заявках пропускает.';

revoke all on function public.fill_current_club_from_roster() from public;
grant execute on function public.fill_current_club_from_roster() to service_role;
