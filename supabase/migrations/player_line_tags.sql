-- Игроки по линиям: 23 021 карточка была без единой метки.
--
-- Владелец: «разбей новых игроков по категориям, сейчас там 27 000 без
-- категорий».
--
-- ЧТО ИМЕННО ОН ВИДЕЛ. Категория (`cards.category`) есть у всех — все они
-- `player`. Нет МЕТОК (`cards.tags`): по ним колода режется на «вратарей»,
-- «великанов», «играли на ЧМ». Замер 08.09.2026: из 25 508 действующих
-- игроков метку несут 2 579, а 23 021 не несёт ни одной — то есть для
-- подборщика колоды они все одинаковые.
--
-- ПОЧЕМУ ИХ НЕ БЫЛО. Прежние метки строил `cards_facts_apply.py` из
-- ВИКИДАННЫХ: позиция через P413, рост через P2048. У карточек, заведённых из
-- заявок клубов (`cards_from_roster.py` — а это и есть «новые игроки»),
-- сущности в Викиданных чаще всего нет вовсе, и метка не появлялась никогда.
--
-- ⚠️ НО ПОЗИЦИЯ У НИХ ЕСТЬ, ПРОСТО В ДРУГОМ МЕСТЕ. `cards.position_ru`
-- заполняется из заявки Transfermarkt, и там ровно четыре значения:
--     Защитник 8195 · Полузащитник 7578 · Нападающий 6739 · Вратарь 2799
-- Это 25 311 из 25 508 — почти вся колода. Четыре линии и есть та разбивка,
-- которую просили, и брать её надо оттуда, где она лежит.
--
-- ⚠️ ЧЕТЫРЕ ЛИНИИ, А НЕ ДВАДЦАТЬ АМПЛУА. Soccer Wiki знает «Wingback» и
-- «Deep-Lying Forward», но подборщик колоды — это чипы на экране: двадцать
-- штук читаются как шум, четыре — как выбор. Тонкое амплуа остаётся в досье,
-- где на него есть место.

-- ---------------------------------------------------------------------------
-- Линия по русской позиции из заявки — ЧИСТАЯ ФУНКЦИЯ.
--
-- ⚠️ ТОЧНОЕ СРАВНЕНИЕ, А НЕ `ilike '%защит%'`. «Защитник» и «Полузащитник»
-- отличаются приставкой, и поиск по подстроке записал бы каждого
-- полузащитника ещё и в защитники — 7578 карточек в чужую линию, молча.
-- ---------------------------------------------------------------------------
create or replace function public.line_tag_from_position(p_position text)
returns text
language sql
immutable
as $$
  select case lower(btrim(coalesce(p_position, '')))
           when 'вратарь'      then 'goalkeeper'
           when 'защитник'     then 'defender'
           when 'полузащитник' then 'midfielder'
           when 'нападающий'   then 'forward'
           else null
         end
$$;

comment on function public.line_tag_from_position(text) is
  'Русская позиция из заявки Transfermarkt в метку линии. Сравнение точное: '
  '«Защитник» и «Полузащитник» различаются приставкой, и подстрока смешала бы их.';

-- ---------------------------------------------------------------------------
-- Линия по коду Soccer Wiki — запасной источник для тех, у кого позиции в
-- заявке нет. Правило ТО ЖЕ, что во фронтенде (`shared/lib/soccerwikiPosition.ts`):
-- берётся ПЕРВЫЙ код, потому что источник перечисляет позиции от глубокой к
-- передней и первая — основная.
-- ---------------------------------------------------------------------------
create or replace function public.line_tag_from_sw(p_position text)
returns text
language sql
immutable
as $$
  select case lower(split_part(regexp_replace(coalesce(p_position, ''), '\(.*$', ''), ',', 1))
           when 'gk' then 'goalkeeper'
           when 'd'  then 'defender'
           when 'dm' then 'midfielder'
           when 'm'  then 'midfielder'
           when 'am' then 'midfielder'
           when 'f'  then 'forward'
           else null
         end
$$;

comment on function public.line_tag_from_sw(text) is
  'Код позиции Soccer Wiki («D,DM,M(L)») в метку линии по ПЕРВОМУ коду — то же '
  'правило, что в shared/lib/soccerwikiPosition.ts.';

-- ---------------------------------------------------------------------------
-- Разложить колоду по линиям и росту.
--
-- ⚠️ МЕТКИ ДОБАВЛЯЮТСЯ, А НЕ ЗАМЕЩАЮТСЯ. У карточки уже могут стоять
-- `world_cup`, `ballon_dor`, `legend` — они добыты из Викиданных и стоят
-- дороже: потерять их ради линии значило бы обменять редкое на общее.
--
-- ⚠️ РОСТ БЕРЁТСЯ И ИЗ SOCCER WIKI, И ИЗ ФАКТОВ. Оба источника меряют одно и
-- то же; у Soccer Wiki он есть у тех, у кого нет статьи в Википедии, и
-- наоборот. Границы прежние: `giant` ≥ 190, `dwarf` ≤ 170 — их задал
-- `cards_facts_apply.py`, и менять их здесь значило бы переименовать
-- категорию под теми же чипами.
--
-- Идемпотентна: повторный прогон не задваивает метки и не трогает уже
-- размеченных.
-- ---------------------------------------------------------------------------
create or replace function public.fill_player_line_tags()
returns table(lines integer, giants integer, dwarfs integer)
language plpgsql
security definer
set search_path = public
set statement_timeout = '240s'
as $function$
declare
  v_lines  integer := 0;
  v_giant  integer := 0;
  v_dwarf  integer := 0;
begin
  -- 1. Линия.
  with want as (
    select c.id,
           coalesce(line_tag_from_position(c.position_ru),
                    line_tag_from_sw(p.position)) as tag,
           c.tags as have
      from cards c
      left join soccerwiki_player p on p.card_id = c.id
     where c.active and c.category = 'player'
  ),
  upd as (
    update cards c
       set tags = array_append(coalesce(c.tags, '{}'), w.tag)
      from want w
     where c.id = w.id
       and w.tag is not null
       -- ⚠️ ОДНА ЛИНИЯ НА КАРТОЧКУ, И ЭТО ПОЧИНКА ПЕРВОЙ ВЕРСИИ. Сперва
       -- проверялось только «нет ли уже ТАКОЙ метки» — и трое получили обе:
       -- Transfermarkt пишет им «Защитник», Soccer Wiki «Gk». Источники
       -- спорят, а игрок в двух чипах сразу — это не разрешение спора, это
       -- два неверных ответа вместо одного. Метка линии уже стоит — вторую
       -- не дописываем.
       and not (coalesce(w.have, '{}')
                && array['goalkeeper','defender','midfielder','forward'])
    returning 1
  )
  select count(*) into v_lines from upd;

  -- 2. Рост: великаны.
  with want as (
    select c.id
      from cards c
      left join soccerwiki_player p on p.card_id = c.id
     where c.active and c.category = 'player'
       and coalesce(p.height_cm, (c.facts->>'height_cm')::int) >= 190
       and not ('giant' = any(coalesce(c.tags, '{}')))
  ),
  upd as (
    update cards c set tags = array_append(coalesce(c.tags, '{}'), 'giant')
      from want w where c.id = w.id
    returning 1
  )
  select count(*) into v_giant from upd;

  -- 3. Рост: малыши. Ноль — это НЕ рост, а «не измерено».
  with want as (
    select c.id
      from cards c
      left join soccerwiki_player p on p.card_id = c.id
     where c.active and c.category = 'player'
       and coalesce(p.height_cm, (c.facts->>'height_cm')::int) between 1 and 170
       and not ('dwarf' = any(coalesce(c.tags, '{}')))
  ),
  upd as (
    update cards c set tags = array_append(coalesce(c.tags, '{}'), 'dwarf')
      from want w where c.id = w.id
    returning 1
  )
  select count(*) into v_dwarf from upd;

  return query select v_lines, v_giant, v_dwarf;
end;
$function$;

comment on function public.fill_player_line_tags() is
  'Метки линии (goalkeeper/defender/midfielder/forward) из позиции заявки, '
  'запасным — из кода Soccer Wiki; плюс giant/dwarf по росту. Добавляет, '
  'не замещая: world_cup и ballon_dor добыты дороже. Идемпотентна.';

revoke all on function public.fill_player_line_tags() from public;
grant execute on function public.fill_player_line_tags() to service_role;
revoke all on function public.line_tag_from_position(text) from public;
revoke all on function public.line_tag_from_sw(text) from public;
grant execute on function public.line_tag_from_position(text) to service_role;
grant execute on function public.line_tag_from_sw(text) to service_role;
