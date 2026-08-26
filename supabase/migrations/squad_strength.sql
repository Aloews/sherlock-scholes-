-- ============================================================================
-- fixture_squad_strength — УРОВЕНЬ СОСТАВА вместо истории противостояний.
--
-- ЗАЧЕМ. Просили ИИ-анализ истории встреч. Его не из чего строить, и это
-- измерено: в `fixtures` 0 из 266 предстоящих матчей имеют хоть одну прошлую
-- встречу, на команду в среднем 1.1 сыгранный матч. Владелец предложил замену:
-- «тогда оценивай команды по уровню состава футболистов». Вот она.
--
-- ЧТО ЭТО ЗА ЧИСЛО И ЧЕМ ОНО НЕ ЯВЛЯЕТСЯ. Это средняя ИЗВЕСТНОСТЬ (`cards.fame`,
-- 0..100, построена по википедийным просмотрам) игроков клуба. Известность —
-- не мастерство и не форма: ветеран на излёте карьеры известнее талантливого
-- дебютанта. Поэтому число подписано «состав», а не «сила», и НЕ является ни
-- прогнозом, ни вероятностью.
--
-- ⚠️ РАВНАЯ ГЛУБИНА — НЕ ПРИДИРКА, А ИСПРАВЛЕНИЕ ПЕРЕКОСА. Оцифрованы клубы
-- очень неравномерно: у «Реала» 20 карточек, у «Реала Сосьедад» — 5. Наивное
-- среднее по всем сравнивало бы ВЕСЬ состав одного с ЗВЁЗДАМИ другого: у
-- бедно оцифрованного клуба в карточки попали только знаменитости, и его
-- среднее завышено. Замер: «Арсенал» по всем карточкам 87.7, по одиннадцати
-- самым известным — 97.1.
--
-- Поэтому сравниваются N самых известных с КАЖДОЙ стороны, где N — сколько
-- есть у более бедной стороны, но не больше 11 (это размер стартового
-- состава, дальше сравнивать нечего).
--
-- ⚠️ СРАВНИВАТЬ МЕЖДУ ЛИГАМИ НЕЛЬЗЯ. Известность считается по википедии, а она
-- сильно зависит от языка и внимания: РПЛ даёт 18–32, АПЛ 60–97. Внутри одного
-- матча это не мешает — обе команды почти всегда из одной лиги, — но
-- складывать эти числа в общую таблицу лиг нельзя.
--
-- ПОКРЫТИЕ ЧЕСТНО МАЛОЕ, и функция это возвращает, а не прячет:
--   268 предстоящих матчей
--    74 обе команды есть в карточках вообще
--    23 у обеих не меньше пяти игроков   ← порог функции
--    10 у обеих не меньше одиннадцати
-- Зато оставшиеся 23 — это ровно те матчи, ради которых экран открывают:
-- Реал, Барселона, Бавария, Ман Сити, Ливерпуль, Арсенал плюс РПЛ.
--
-- Гранты перечислены явно: политика без гранта роняла этот проект дважды.
-- ============================================================================

create or replace function public.fixture_squad_strength(p_min_depth int default 5)
returns table (
  fixture_id text,
  home_fame numeric,
  away_fame numeric,
  depth int,
  home_squad int,
  away_squad int
)
language sql stable security definer set search_path = public as $$
  with p as (
    select cc.club_key, c.fame,
           row_number() over (partition by cc.club_key order by c.fame desc) as rn
      from card_current_club cc
      join cards c on c.id = cc.card_id
     where c.active and c.category = 'player' and c.fame is not null
  ),
  sz as (select p.club_key, count(*)::int as n from p group by p.club_key),
  fx as (
    select f.id, club_match_key(f.home_team) as hk, club_match_key(f.away_team) as ak
      from fixtures f
     where f.commence_at >= now() and not f.completed
  ),
  sized as (
    select fx.id, fx.hk, fx.ak, hz.n as hn, az.n as an,
           least(hz.n, az.n, 11) as depth
      from fx
      join sz hz on hz.club_key = fx.hk
      join sz az on az.club_key = fx.ak
     -- Порог обязателен. По двум карточкам «уровень состава» — это уровень
     -- двух человек, и подписать его именем клуба значит соврать.
     where least(hz.n, az.n) >= greatest(2, p_min_depth)
  )
  select s.id,
         round(avg(ph.fame)::numeric, 1),
         round(avg(pa.fame)::numeric, 1),
         s.depth, s.hn, s.an
    from sized s
    join p ph on ph.club_key = s.hk and ph.rn <= s.depth
    join p pa on pa.club_key = s.ak and pa.rn <= s.depth
   group by s.id, s.depth, s.hn, s.an
$$;

comment on function public.fixture_squad_strength(int) is
  'Средняя известность (cards.fame) N самых известных игроков каждой команды, '
  'N — по более бедной стороне, максимум 11. НЕ прогноз и НЕ вероятность: '
  'известность не равна мастерству. Между лигами не сравнивается.';

revoke all on function public.fixture_squad_strength(int) from public;
grant execute on function public.fixture_squad_strength(int) to anon, authenticated, service_role;
