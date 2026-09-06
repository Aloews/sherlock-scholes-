-- Клуб из строки карьеры — в карточку клуба коллекции.
--
-- ЗАЧЕМ. Владелец: «карточке игрока сделай кликабельными клубы, которые бы
-- вели на заполненную карточку клуба в „коллекциях“». В досье игрока клубы
-- карьеры лежат СТРОКАМИ («Мюнхен 1860», «Спартак») — ни ключа, ни id, — и
-- нажать на них было не на что.
--
-- ⚠️ СОПОСТАВЛЯЕТ `resolve_club_key`, А НЕ НОВОЕ ПРАВИЛО. Словарь псевдонимов
-- клубов у базы, и вторая его копия разошлась бы молча. Существующий
-- `club_card_by_name` для этого не годится и это ЗАМЕРЕНО: он сравнивает
-- `name_en`, поэтому из семи проб русскими названиями нашёл ровно одну
-- («Manchester United»), а «Спартак», «Бавария», «Реал Мадрид» — ни одной.
-- Через `resolve_club_key` находятся все.
--
-- ⚠️ НЕНАЙДЕННЫЙ КЛУБ ВОЗВРАЩАЕТСЯ СТРОКОЙ С ПУСТЫМ id, А НЕ ПРОПУСКАЕТСЯ.
-- Экран обязан отличать «клуб есть, вот ссылка» от «клуба у нас нет»: во
-- втором случае строка карьеры показывается без ссылки, а не исчезает.
-- Замер 06.09.2026: «Дармштадт 98» из живой карточки не находится вовсе —
-- ключ выводится как `darmshtadt 98`, а такого клуба в справочнике нет.

create or replace function public.clubs_by_names(p_names text[])
returns table(name text, club_key text, card_id uuid, crest_url text)
language sql
stable
security definer
set search_path = public
as $$
  select n.name,
         fc.club_key,
         fc.card_id,
         fc.crest_url
    from unnest(coalesce(p_names, '{}'::text[])) as n(name)
    left join football_club fc
           on fc.club_key = resolve_club_key(n.name, null)
          and fc.card_id is not null;
$$;

comment on function public.clubs_by_names(text[]) is
  'Названия клубов → ключ и карточка коллекции. Ненайденные возвращаются с NULL, '
  'а не пропадают: экран показывает такую строку без ссылки.';

revoke all on function public.clubs_by_names(text[]) from public;
grant execute on function public.clubs_by_names(text[]) to anon, authenticated, service_role;
