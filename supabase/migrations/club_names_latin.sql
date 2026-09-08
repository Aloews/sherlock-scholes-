-- Имена клубов — латиницей, Soccer Wiki эталон.
-- ===========================================================================
--
-- Владелец: «ориентируйся на имя с Soccer Wiki и можешь использовать имена
-- игроков именно так как написано там. А переводи только интерфейс, имена
-- больше не переводи, пиши их латиницей».
--
-- ИМЕНА ИГРОКОВ УЖЕ ЛАТИНИЦЕЙ, и менять там нечего: `cardDisplayName` отдаёт
-- `name_en` игроку на любом языке, включая русский, а `name_en` есть у 25 507
-- карточек из 25 508.
--
-- КЛУБЫ БЫЛИ ИСКЛЮЧЕНИЕМ. `club_display_name` на русском отдавала `f.name`
-- («Бавария»), на прочих языках — перевод карточки, и только потом латиницу.
-- Теперь латиница первая всегда.
--
-- ⚠️ РУССКОЕ ИМЯ ОСТАЁТСЯ ЗАПАСНЫМ, И ЭТО НЕ ПОЛУМЕРА. Латиницы нет у 639
-- клубов даже после заливки из Soccer Wiki; пустая строка вместо названия
-- хуже кириллицы. Замер после заливки: латиница у 1 894 клубов из 2 729.
--
-- ⚠️ ЗАЛИВКА ИДЁТ ИЗ SOCCER WIKI И ПЕРЕЗАПИСЫВАЕТ ПРЕЖНЕЕ name_en. Так просил
-- владелец: источник назван эталонным. Где Soccer Wiki клуб не знает, прежнее
-- имя остаётся нетронутым.

update football_club f
   set name_en = k.name
  from soccerwiki_club k
 where k.club_key = f.club_key
   and k.name is not null and btrim(k.name) <> ''
   and f.name_en is distinct from k.name;

create or replace function public.club_display_name(p_club_key text, p_lang text)
returns text
language sql stable set search_path = public as $$
  select coalesce(f.name_en, f.name)
    from football_club f where f.club_key = p_club_key
$$;

comment on function public.club_display_name(text, text) is
  'Имя клуба ЛАТИНИЦЕЙ на любом языке; русское имя — запасное для тех, у кого латиницы нет. p_lang оставлен в сигнатуре ради совместимости вызовов.';
