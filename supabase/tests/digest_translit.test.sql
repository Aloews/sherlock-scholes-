-- ============================================================
-- SHERLOCK SCHOLES — test: digest_translit() и склейка через алфавиты
--
-- Закрепляет замер из football_digest.sql: до транслитерации русская половина
-- лент имела РОВНО НОЛЬ общих основ с латинской, и «Арсенал» — «Манчестер
-- Сити» шёл двумя темами, из которых русская стояла шестой при 227
-- заголовках.
--
-- ЧТО ИМЕННО ЗДЕСЬ ПРОВЕРЯЕТСЯ, и почему не digest_topics(). Та читает живую
-- news_items, и любое утверждение о её выдаче зависело бы от сегодняшних
-- новостей — тест был бы то зелёным, то красным без единого изменения кода.
-- Поэтому проверяется то, из чего она собрана и что детерминировано:
--   * digest_translit() на парах, по которым принималось решение (случай A);
--   * УСЛОВИЕ РЕБРА — три общих основы у пары заголовков (случай B). Именно
--     оно решает, попадут ли две заметки в одну тему;
--   * известные пределы метода (случай C) — они утверждаются НАРОЧНО, чтобы
--     будущая правка, которая их снимет, себя показала.
--
-- HOW TO RUN — Supabase SQL Editor, или:
--     psql "$DATABASE_URL" -f supabase/tests/digest_translit.test.sql
--
-- SAFETY. Ничего не пишет: только вызывает immutable-функции. Транзакция и
-- ROLLBACK оставлены для единообразия с остальными тестами.
--
-- Requires: football_digest.sql.
-- On success prints: `digest_translit: all assertions passed`.
-- ============================================================

BEGIN;

DO $test$
DECLARE
  v_ru   TEXT;
  v_lat  TEXT;
  v_hit  INT;
BEGIN
  -- ── A. Пары, на которых принималось решение ────────────────────────────
  -- Каждая — из живых лент тех суток, а не выдумана.
  FOR v_ru, v_lat IN
    SELECT * FROM (VALUES
      ('Торресу',    'Torres'),      -- ради чего всё затевалось
      ('Барселоны',  'Barcelone'),   -- с против c: ради этого c → s
      ('Ювентус',    'Juventus'),    -- ю→iu против ju: ради этого j → i
      ('Мартинеса',  'Martínez'),    -- диакритика: ради этого translate
      ('Манчестер',  'Manchester'),  -- ч и ch сходятся побочно
      ('Мбаппе',     'Mbappé'),
      ('Челси',      'Chelsea'),
      ('Ливерпуля',  'Liverpool'),
      ('Дортмунд',   'Dortmund'),
      ('Родри',      'Rodri'),
      ('Зенита',     'Zenit'),
      ('Салах',      'Salah')
    ) AS t(ru, lat)
  LOOP
    ASSERT left(public.digest_translit(v_ru), 5) = left(public.digest_translit(v_lat), 5),
      format('A: %s и %s должны давать одну основу, а дают %s и %s',
             v_ru, v_lat,
             left(public.digest_translit(v_ru), 5),
             left(public.digest_translit(v_lat), 5));
  END LOOP;

  -- ── B. Условие ребра: три общих основы у разноалфавитной пары ──────────
  -- Заголовки настоящие, из лент 17.08.
  SELECT cardinality(ARRAY(
    SELECT unnest(public.digest_tokens(
             'Дани Ольмо обратился к Феррану Торресу после его перехода из «Барселоны» в «ПСЖ»'))
    INTERSECT
    SELECT unnest(public.digest_tokens(
             'PSG : le FC Barcelone se frotte les mains avec la vente de Ferran Torres !'))
  )) INTO v_hit;
  ASSERT v_hit >= 3,
    format('B: русский и французский заголовок про Торреса должны делить >=3 основы, делят %s', v_hit);

  SELECT cardinality(ARRAY(
    SELECT unnest(public.digest_tokens(
             '«Барселона» согласовала переход Родри с «Манчестер Сити» — Фабрицио Романо'))
    INTERSECT
    SELECT unnest(public.digest_tokens(
             'Rodri set to complete Barcelona move after Manchester City accept bid'))
  )) INTO v_hit;
  ASSERT v_hit >= 3,
    format('B: русский и английский заголовок про Родри должны делить >=3 основы, делят %s', v_hit);

  -- И столь же важное обратное: несвязанные заметки НЕ должны сцепляться.
  -- Обе про футбол, обе упоминают клуб, сюжеты разные.
  SELECT cardinality(ARRAY(
    SELECT unnest(public.digest_tokens(
             '«Шальке-04» — «Реал» Мадрид: во сколько начало товарищеского матча'))
    INTERSECT
    SELECT unnest(public.digest_tokens(
             'Luis Llopis dice adiós al Real Madrid'))
  )) INTO v_hit;
  ASSERT v_hit < 3,
    format('B: трансляция матча и уход тренера — РАЗНЫЕ сюжеты, а делят %s основ', v_hit);

  -- ── C. Известные пределы, утверждённые нарочно ─────────────────────────
  -- Если однажды они начнут сходиться, тест упадёт и заставит перечитать
  -- таблицу замеров: снятие этих двух случаев прежде взрывало шум.
  ASSERT left(public.digest_translit('Гвардиола'), 5) <> left(public.digest_translit('Guardiola'), 5),
    'C: «Гвардиола» и Guardiola сошлись — проверь, не выросло ли число ложных тем';
  ASSERT left(public.digest_translit('Комо'), 5) <> left(public.digest_translit('Como'), 5),
    'C: «Комо» и Como сошлись — проверь, не выросло ли число ложных тем';

  -- ── D. Латиница не должна пострадать ───────────────────────────────────
  -- Сворачивание применяется к обеим сторонам, поэтому пары, работавшие
  -- раньше внутри латиницы, обязаны работать и теперь.
  ASSERT left(public.digest_translit('Fernández'), 5) = left(public.digest_translit('Fernandes'), 5),
    'D: Fernández и Fernandes разошлись — сломана склейка внутри латиницы';
  ASSERT public.digest_tokens('Arsenal') = public.digest_tokens('arsenal'),
    'D: регистр стал значимым';

  RAISE NOTICE 'digest_translit: all assertions passed';
END
$test$;

ROLLBACK;
