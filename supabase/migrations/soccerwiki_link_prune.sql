-- Одна карточка — не больше одного игрока Soccer Wiki, и решает дата рождения.
-- ===========================================================================
--
-- Владелец: «у тебя же после игры в Элиас написано, что Гарначо в Челси, а он
-- уже перешёл. И были другие ошибки в составах „Спартака“».
--
-- Разбирая это, нашлось кое-что хуже устаревших трансферов. Карточка Бруну
-- Фернандеша была связана СРАЗУ С ДВУМЯ игроками Soccer Wiki:
--
--   pid  64598  «Manchester United»,   дата рождения 1994-09-08 — совпадает
--   pid 164522  «Sheffield Wednesday», даты рождения нет вовсе
--
-- Соединение выбирало любую из двух, и экран заявлял, что Бруну играет в
-- Шеффилде. Однофамильцев имя не различает по построению: у обоих оно буква
-- в букву. Дата рождения различает.
--
-- Замер до чистки: 14 636 связанных карточек, из них 180 связаны с
-- НЕСКОЛЬКИМИ игроками (366 строк), и 59 связок соединяли людей с ЯВНО
-- РАЗНЫМИ датами рождения. После: 0 и 0, связок 14 585.
--
-- ⚠️ ЭТО НЕ ДЕЛАЕТ SOCCER WIKI ГЛАВНЫМ ИСТОЧНИКОМ СОСТАВОВ. До этого ещё
-- далеко, и почему — записано в docs/MAP.md: 1 207 клубов Soccer Wiki завели
-- в справочнике СВОЮ строку рядом с уже существующей («Bayern München» рядом
-- с «Баварией», «Olympique Marseille» рядом с «Марселем»), а ещё у 1 578
-- ключа нет вовсе. Переключить текущий клуб на Soccer Wiki прямо сейчас
-- означало бы «перевести» половину «Баварии» в другой клуб с тем же составом.
-- Сперва склейка справочника, потом источник.

create or replace function public.prune_soccerwiki_links()
returns table (снято_по_дате integer, снято_дублей integer)
language plpgsql security definer set search_path = public as $$
declare v_date int; v_dup int;
begin
  -- 1. Дата известна с обеих сторон и НЕ СОВПАЛА — это чужой человек.
  update soccerwiki_player p set card_id = null
    from cards c
   where p.card_id = c.id
     and p.born_on is not null and c.born_on is not null
     and p.born_on <> c.born_on;
  get diagnostics v_date = row_count;

  -- 2. Осталось несколько на одну карточку — держим лучшую: сперва ту, у кого
  --    дата совпала с карточкой, затем ту, у кого дата вообще есть, затем
  --    меньший pid, чтобы выбор был воспроизводим, а не случаен.
  with ranked as (
    select p.pid, p.card_id,
           row_number() over (
             partition by p.card_id
             order by (p.born_on is not null and p.born_on = c.born_on) desc,
                      (p.born_on is not null) desc,
                      p.pid) as rn
      from soccerwiki_player p
      join cards c on c.id = p.card_id
     where p.card_id is not null
  )
  update soccerwiki_player p set card_id = null
    from ranked r where p.pid = r.pid and r.rn > 1;
  get diagnostics v_dup = row_count;

  return query select v_date, v_dup;
end;
$$;

comment on function public.prune_soccerwiki_links() is
  'Снимает связки карточка → игрок Soccer Wiki, где дата рождения противоречит, '
  'и оставляет по одной связке на карточку. Однофамильцев различает дата, а не имя.';

revoke all on function public.prune_soccerwiki_links() from public, anon, authenticated;
grant execute on function public.prune_soccerwiki_links() to service_role;
