-- ============================================================================
-- МОСТ SOCCER WIKI → КАРТОЧКА ПО КЛУБУ И ДАТЕ РОЖДЕНИЯ.
--
-- ⚠️ ПО ИМЕНИ ЭТО НЕ РЕШАЕТСЯ, И ЭТО ПРОВЕРЕНО ГЛАЗАМИ.
-- `link_soccerwiki_by_name` сверяет имя ТОЧНО, а Soccer Wiki пишет фамилию
-- первой и склеивает:
--
--     «Júnior Neymar»   → Neymar
--     «Jorge Koke»      → Koke
--     «Alarcón Isco»    → Isco
--     «Frello Jorginho» → Жоржиньо
--     «Carlos Casemiro» → Каземиро
--     «Pascal Gross»    → «Pascal Groß»      (ß)
--     «Lukáš Hrádecký»  → «Lukas Hradecky»   (диакритика)
--
-- Совпадений по последнему слову 1952, а подтверждённых клубом из них 231 —
-- остальное однофамильцы. Связать их значило бы приписать игроку чужую
-- статистику; в этом проекте такое уже было («Крузейро» ↔ `cruz azul`).
--
-- ЧТО РАБОТАЕТ: клуб И дата рождения. Даты приходят из ДВУХ НЕЗАВИСИМЫХ
-- источников — Transfermarkt (`club_roster.born_on`) и Soccer Wiki
-- (`soccerwiki_player.born_on`); совпадение обоих у одного клуба — ключ,
-- которому можно верить. Замер на первых 291 строке с датой: 242 связались
-- однозначно (83 %), 2 отвергнуты как неоднозначные.
--
-- ⚠️ ОДНОЗНАЧНОСТЬ ТРЕБУЕТСЯ С ОБЕИХ СТОРОН. Двое в одном клубе с одной датой
-- рождения — редкость, но она бывает, и тогда связывать нельзя ни того, ни
-- другого: половина таких пар была бы перепутана молча.
--
-- ⚠️ ИМЯ НАРОЧНО НЕ СВЕРЯЕТСЯ. Список выше — ровно те случаи, где имена
-- расходятся; гард по имени отверг бы верные связи и оставил только те, что и
-- так связывались.
--
-- ⚠️ ШАГ БЕСПОЛЕЗЕН БЕЗ ЧТЕНИЯ СТРАНИЦ ИГРОКОВ. Дата рождения появляется
-- только там, и до 14.09.2026 её не было ни у кого из несвязанных: сборщик
-- страниц читал ТОЛЬКО тех, кто уже в колоде. Разбор — в
-- `docs/soccerwiki_players.py` и `player_talent_queue.sql`.
-- ============================================================================

create or replace function link_soccerwiki_by_birth()
returns table (linked integer, ambiguous integer)
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_linked integer := 0;
  v_amb    integer := 0;
begin
  create temp table _bpair on commit drop as
  with sw as (
    select p.pid, c.club_key, p.born_on
      from soccerwiki_player p
      join soccerwiki_club c on c.club_id = p.club_id
     where p.card_id is null and p.born_on is not null
  ), pairs as (
    select sw.pid, r.card_id
      from sw
      join club_roster r on r.club_key = sw.club_key and r.born_on = sw.born_on
     where r.card_id is not null
  ),
  -- одна карточка на игрока…
  one_card as (
    select pid, min(card_id::text)::uuid as card_id
      from pairs group by pid having count(distinct card_id) = 1
  ),
  -- …и один игрок на карточку
  one_pid as (
    select card_id from one_card group by card_id having count(*) = 1
  )
  select o.pid, o.card_id from one_card o join one_pid u on u.card_id = o.card_id;

  with upd as (
    update soccerwiki_player p set card_id = b.card_id
      from pg_temp._bpair b
     where p.pid = b.pid and p.card_id is null
    returning 1
  )
  select count(*) into v_linked from upd;

  select count(*) into v_amb from (
    select sw.pid
      from soccerwiki_player p
      join soccerwiki_club c on c.club_id = p.club_id
      join lateral (select p.pid, c.club_key, p.born_on) sw on true
      join club_roster r on r.club_key = sw.club_key and r.born_on = sw.born_on
     where p.card_id is null and p.born_on is not null and r.card_id is not null
     group by sw.pid having count(distinct r.card_id) > 1
  ) z;

  drop table pg_temp._bpair;
  return query select v_linked, v_amb;
end;
$$;
