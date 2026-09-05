-- ===========================================================================
-- ДВЕ НОВЫЕ ОСИ ИЗВЕСТНОСТИ: ДОМА и В МИРЕ.
--
-- Владелец: «известность собиралась не только по ру-вики, а со всех
-- источников, и выводилась общая. Азиатских игроков не просматривают ни с ру
-- региона, ни с европейского. Нужно измерять известность в той стране, откуда
-- игрок родом, и сравнивать с мировой».
--
-- ⚠️ ЖАЛОБА ЗАМЕРЕНА, А НЕ ПРИНЯТА НА ВЕРУ. `cards.pageviews_i18n` до сих пор
-- наполнялся ДЕВЯТЬЮ языками — и это ровно девять локалей интерфейса
-- (ru en es pt fr zh ja ko ar), а не девять языков, на которых читают про
-- футболистов. Замер 04.09.2026 на боевых данных:
--
--     активных игроков                                    2918
--     из них БЕЗ ЕДИНОГО просмотра на языке своей страны   1452   (49.8 %)
--
-- Половина колоды. Турок, поляк, серб, иранец, украинец, грек, вьетнамец,
-- таец меряются языками, на которых про них не читает никто: своей колонки у
-- них просто нет. Кореец, японец и китаец в девятку попали — и именно поэтому
-- дыра выглядела маленькой.
--
-- ЧТО ЗАВЕДЕНО:
--
--   fame        как было — перцентиль по МАКСИМУМУ по языкам. Ось колоды,
--               на ней стоят пороги 90 («знаменитые») и 99 («легенды»),
--               tier и тег legend. Определение НЕ МЕНЯЛОСЬ.
--   fame_world  перцентиль по СУММЕ по всем языкам. Это и есть «общая»:
--               человек, которого читают на двадцати языках понемногу,
--               по максимуму проигрывает тому, кого читают на одном.
--   fame_home   перцентиль по максимуму среди языков СВОЕЙ СТРАНЫ
--               (country_wiki_lang). Это «известен ли он дома».
--
-- Сравнение ради него и заводится: fame_home высокая при низкой fame_world —
-- герой своей страны, которого мир не знает; наоборот — легионер, известный
-- везде, кроме родины.
--
-- ⚠️ ОКНО ПЕРЦЕНТИЛЯ ПОЧИНЕНО, И ЭТО ИЗМЕРЕНО. Прежняя версия ранжировала ВСЕ
-- активные карточки семьи, включая те, у кого просмотров нет: им самим
-- ставился NULL, но в окне они стояли и занимали низ, поднимая перцентиль
-- всем остальным. Это записано в docs/MAP.md как известная поломка («медиана
-- 50 → 61»), и лечили её порядком шагов, а не окном. Теперь карточка без
-- данных в окно не входит вовсе. Замер сдвига на боевых данных:
--
--     семья    ранжировано  средний сдвиг  сдвиг ≥5  знаменитых  легенд
--     игроки       2906         −0.21          0      307 → 306   44 → 44
--     остальные     686         −4.75        363       80 →  72   12 → 11
--
-- У игроков без данных двенадцать из 2918 — сдвиг незаметен. У остальных их
-- 72 из 758, каждая десятая, и восемь карточек уходили в «знаменитые» ровно
-- потому, что снизу стояла пустота. Это не регресс, а снятие приписки.
--
-- И это же делает БЕЗОПАСНЫМ включение 846 новых карточек: пока у них нет
-- просмотров, они больше не двигают шкалу никому.
--
-- ⚠️ ДОМАШНЯЯ ИЗВЕСТНОСТЬ — МАКСИМУМ, А НЕ СУММА. У страны языков бывает
-- несколько ({de, fr, it, rm} у Швейцарии, {fr, wo} у Сенегала), и сумма
-- сложила бы разные аудитории одной страны в одно число, завысив её ровно
-- там, где языков больше. Максимум выбирает тот раздел, который эту страну
-- и представляет, — выбирает не список, а сами просмотры.
--
-- ⚠️ И ПЕРЦЕНТИЛЬ СЧИТАЕТСЯ ВНУТРИ ЯЗЫКА, А НЕ ПО ВСЕЙ КОЛОДЕ. Первая версия
-- ранжировала домашний счёт против ВСЕХ игроков — и мерила не известность
-- дома, а РАЗМЕР ВИКИПЕДИИ СТРАНЫ. Замер средних домашних просмотров:
--
--     en 400 681 · ja 215 264 · fr 145 947 · es 120 874 · pt 87 993 · ko 9 022
--
-- Англичанин соревновался с корейцем сорокакратной разницей в аудитории, и
-- выдача читалась как чепуха: «герои дома» — сплошь англоязычные страны, а
-- Тьяго Алькантара с испанской статьёй получал «дома 7».
-- Теперь окно — (семья, домашний язык), и это сразу дало осмысленное:
-- Головин дома 100 при 71 в мире, Гойло 92 против 24, Лисакович 97 против 30
-- — игроки РПЛ, которых знают в России и не знают нигде. Ровно то сравнение,
-- ради которого ось и заводилась.
--
-- ⚠️ КОГОРТА МЕНЬШЕ ДЕСЯТИ — ЭТО NULL, А НЕ ЧИСЛО. На двух соотечественниках
-- перцентиль выдаёт 0 и 100, и оба выглядят осмысленно. Языки наполняются
-- ночным шагом, и до наполнения честнее молчать.
--
-- ⚠️ ДЛЯ ru ДОМАШНИЙ СЧЁТ БЕРЁТСЯ ИЗ cards.pageviews, И ЭТО НЕ МЕЛОЧЬ.
-- `pageviews_i18n->>'ru'` у русских карточек снят с ЧУЖОЙ статьи — замер
-- 04.09.2026: у Головина `cards.pageviews` = 273 016, а в jsonb 382, на три
-- порядка меньше; у Довбни 39 032 против 376, у Васютина 15 649 против 34.
-- Хуже того, у 264 из 329 русских ключа `ru` в jsonb НЕТ ВОВСЕ, хотя ру-счёт
-- у них есть: ранжировать их было не по чему, и в домашнюю ось попадали 47.
-- После правки — 307 из 329, а всего ранжированных дома 1744 из 2918.
--
-- DROP перед CREATE обязателен: у функции меняется список колонок
-- RETURNS TABLE, а `create or replace` этого не умеет (42P13).
-- ===========================================================================

alter table cards add column if not exists fame_home  smallint;
alter table cards add column if not exists fame_world smallint;

comment on column cards.fame_home is
  'Известность ДОМА, 0..100: перцентиль по максимуму просмотров среди языков '
  'своей страны (country_wiki_lang). NULL = страны нет, языка нет в '
  'pageviews_i18n, или просмотров ноль. Ставится refresh_card_fame().';
comment on column cards.fame_world is
  'Известность В МИРЕ, 0..100: перцентиль по СУММЕ просмотров по всем '
  'языковым разделам. NULL = данных нет. Ставится refresh_card_fame().';

drop function if exists public.refresh_card_fame();

create function public.refresh_card_fame()
returns table (family text, n_cards bigint, no_data bigint,
               no_home bigint, no_world bigint)
language plpgsql as $$
DECLARE
  -- Меньше десяти соотечественников — перцентиль не считается: на двоих он
  -- выдаёт 0 и 100, и оба числа выглядят осмысленно.
  min_cohort constant integer := 10;
BEGIN
  WITH metric AS (
    SELECT
      c.id,
      CASE WHEN c.category = 'player' THEN 'player' ELSE 'other' END AS fam,
      -- Ось колоды: максимум по языкам. Определение прежнее.
      GREATEST(COALESCE(c.pageviews, 0), COALESCE(pv.mx, 0))     AS v_max,
      -- «Общая»: сумма по всем разделам, какие собраны.
      GREATEST(COALESCE(c.pageviews, 0), COALESCE(pv.total, 0))  AS v_world,
      hm.lang                                                    AS home_lang,
      COALESCE(hm.mx, 0)                                         AS v_home
    FROM cards c
    LEFT JOIN LATERAL (
      SELECT max(e.v::bigint) AS mx, sum(e.v::bigint) AS total
        FROM jsonb_each_text(COALESCE(c.pageviews_i18n, '{}'::jsonb)) AS e(k, v)
    ) pv ON true
    LEFT JOIN LATERAL (
      -- ⚠️ ДВА ИСТОЧНИКА ДОМАШНЕГО СЧЁТА, И ВТОРОЙ ОБЯЗАТЕЛЕН — см. шапку:
      -- у русских карточек jsonb-ключ 'ru' либо снят с чужой статьи, либо
      -- отсутствует, а cards.pageviews — это и есть ру-вики.
      SELECT s.lang, max(s.views) AS mx
        FROM (
          SELECT w.lang, e.v::bigint AS views
            FROM jsonb_each_text(COALESCE(c.pageviews_i18n, '{}'::jsonb)) AS e(k, v)
            JOIN country_wiki_lang w
              ON w.lang = e.k AND w.country_code = c.country
          UNION ALL
          SELECT 'ru', COALESCE(c.pageviews, 0)
           WHERE COALESCE(c.pageviews, 0) > 0
             AND EXISTS (SELECT 1 FROM country_wiki_lang w
                          WHERE w.country_code = c.country AND w.lang = 'ru')
        ) s
       GROUP BY s.lang
       ORDER BY 2 DESC
       LIMIT 1
    ) hm ON true
    WHERE c.active
  ), cohort AS (
    SELECT home_lang, count(*) AS n
      FROM metric WHERE v_home > 0 GROUP BY home_lang
  ), ranked AS (
    -- ⚠️ PARTITION BY … , (v > 0) — вот чем чинится окно. Карточки без данных
    -- уезжают в СВОЮ группу и перцентиль остальным больше не двигают.
    SELECT m.id,
           CASE WHEN m.v_max = 0 THEN NULL ELSE
             round(100 * percent_rank() OVER (
               PARTITION BY m.fam, (m.v_max > 0) ORDER BY m.v_max))::smallint END AS fame,
           CASE WHEN m.v_world = 0 THEN NULL ELSE
             round(100 * percent_rank() OVER (
               PARTITION BY m.fam, (m.v_world > 0) ORDER BY m.v_world))::smallint END AS fame_world,
           -- Окно домашней оси — (семья, ЯЗЫК): иначе меряется размер
           -- Википедии страны, а не известность игрока дома.
           CASE WHEN m.v_home = 0 OR co.n IS NULL OR co.n < min_cohort THEN NULL ELSE
             round(100 * percent_rank() OVER (
               PARTITION BY m.fam, m.home_lang, (m.v_home > 0)
               ORDER BY m.v_home))::smallint END AS fame_home
      FROM metric m
      LEFT JOIN cohort co ON co.home_lang = m.home_lang
  )
  UPDATE cards c
     SET fame       = r.fame,
         fame_world = r.fame_world,
         fame_home  = r.fame_home
    FROM ranked r
   WHERE r.id = c.id
     AND (c.fame       IS DISTINCT FROM r.fame
       OR c.fame_world IS DISTINCT FROM r.fame_world
       OR c.fame_home  IS DISTINCT FROM r.fame_home);

  -- Погашенные карточки славы не носят — их не раздают.
  UPDATE cards SET fame = NULL, fame_world = NULL, fame_home = NULL
   WHERE NOT active
     AND (fame IS NOT NULL OR fame_world IS NOT NULL OR fame_home IS NOT NULL);

  -- Косметические рамки редкости идут по той же оси.
  UPDATE cards c SET tier = fame_tier(c.fame)
   WHERE c.tier IS DISTINCT FROM fame_tier(c.fame);

  UPDATE cards
     SET tags = (SELECT array_agg(t) FROM unnest(tags) t WHERE t <> 'star')
   WHERE tags && ARRAY['star'];

  UPDATE cards
     SET tags = (SELECT array_agg(t) FROM unnest(tags) t WHERE t <> 'legend')
   WHERE tags && ARRAY['legend'] AND (fame IS NULL OR fame < 99 OR category <> 'player');

  UPDATE cards
     SET tags = array_append(COALESCE(tags, '{}'), 'legend')
   WHERE category = 'player' AND fame >= 99 AND NOT COALESCE(tags, '{}') && ARRAY['legend'];

  RETURN QUERY
    SELECT CASE WHEN c.category = 'player' THEN 'player' ELSE 'other' END,
           count(*),
           count(*) FILTER (WHERE c.fame IS NULL),
           count(*) FILTER (WHERE c.fame_home IS NULL),
           count(*) FILTER (WHERE c.fame_world IS NULL)
      FROM cards c WHERE c.active GROUP BY 1;
END;
$$;

-- Отбор «герой дома, мир не знает» и обратный читают обе колонки сразу.
create index if not exists cards_fame_home_world_idx
  on cards (fame_home, fame_world) where active;

-- --------------------------------------------------------------------------
-- Дописать просмотры, НЕ ПОТЕРЯВ уже собранные языки.
--
-- ⚠️ ЗАМЕНА jsonb ЦЕЛИКОМ — ЭТО ПОТЕРЯ. Сборщики ходят разными выборками
-- языков: один принесёт {tr, en}, другой {ru, es}. Присваивание вместо
-- слияния молча стёрло бы чужую половину, и обнаружилось бы это только тем,
-- что известность у половины колоды однажды «упала».
-- --------------------------------------------------------------------------
create or replace function public.merge_card_pageviews(p_rows jsonb)
returns table (written integer, seen integer)
language plpgsql security definer set search_path = public as $$
declare
  v_written integer;
  v_seen    integer;
begin
  with src as (
    select (r->>'card_id')::uuid as card_id,
           (r->'views')          as views
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
     where (r->>'card_id') is not null
       and jsonb_typeof(r->'views') = 'object'
  ), upd as (
    update cards c
       set pageviews_i18n = coalesce(c.pageviews_i18n, '{}'::jsonb) || s.views
      from src s
     where s.card_id = c.id
       and coalesce(c.pageviews_i18n, '{}'::jsonb) <>
           coalesce(c.pageviews_i18n, '{}'::jsonb) || s.views
    returning c.id
  )
  select (select count(*) from upd), (select count(*) from src)
    into v_written, v_seen;

  return query select v_written, v_seen;
end;
$$;

revoke all on function public.merge_card_pageviews(jsonb) from public, anon, authenticated;
grant execute on function public.merge_card_pageviews(jsonb) to service_role;

NOTIFY pgrst, 'reload schema';
