-- ============================================================
-- SHERLOCK SCHOLES — test: тактика в фэнтези
--
-- Покрывает supabase/migrations/fantasy_tactics.sql — позиционные надбавки,
-- веса схем и требование схемы к составу.
--
-- ЧТО ИМЕННО ЗАКРЕПЛЯЕТСЯ, и почему это стоит теста. Очки — единственное, ради
-- чего фэнтези существует, и ошибка в них НЕ ВИДНА НА ЭКРАНЕ: неправильное
-- число выглядит ровно так же правдоподобно, как правильное. Никто не заметит,
-- что вратарь получил за сухарь вдвое меньше положенного, — заметят только
-- через месяц, что «оборона почему-то не работает».
--
-- Случай A — таблица очков из шапки миграции, все четыре линии на пяти счетах.
--   Это те самые числа, по которым принималось решение о балансе; если они
--   разъедутся с кодом, разъедется и обещание, написанное игроку на экране.
-- Случай B — веса схем. Их суть в НУЛЯХ: «Оборона» не получает за голы,
--   «Атака» — за сухари. Ноль здесь не мелочь, а вся ставка.
-- Случай C — карточка без позиции идёт по СТАРОМУ правилу и схемой не
--   двигается вовсе. 45 таких карточек в ближайшем туре, и штрафовать их за
--   пробел в НАШИХ данных было бы нечестно.
-- Случай D — требование схемы к составу, на настоящих карточках.
-- Случай E — симметрия крайностей: «Оборона» вратарю и «Атака» нападающему
--   стоят одинаково. Без этого одна из схем была бы просто лучше другой.
--
-- HOW TO RUN — Supabase SQL Editor, или:
--     psql "$DATABASE_URL" -f supabase/tests/fantasy_tactics.test.sql
--
-- SAFETY. Одна транзакция с ROLLBACK в конце. Случаи A–C вообще ничего не
-- пишут (только вызовы функций), случай D заводит четыре карточки с префиксом
-- 'ZZTESTTAC' и не переживает откат.
--
-- Requires: fantasy.sql, fantasy_tactics.sql.
-- On success prints: `fantasy tactics: all assertions passed`.
-- ============================================================

BEGIN;

DO $test$
DECLARE
  v_gk   UUID;
  v_def  UUID;
  v_mid  UUID;
  v_fwd  UUID;
  v_pos  TEXT;
  v_got  INTEGER;
  v_want INTEGER;
BEGIN
  -- ── A. Таблица очков из шапки миграции ─────────────────────────────────
  --            сухарь   гол    2:0   1:1   0:0   3:1
  --   вратарь     4       0      7     1     5     3
  --   защитник    4       1      9     2     5     6
  --   полуз.      1       1      6     2     2     6
  --   нападающий  0       2      7     3     1     9
  FOR v_pos, v_want IN
    SELECT * FROM (VALUES
      ('gk', 7), ('def', 9), ('mid', 6), ('fwd', 7)
    ) AS t(pos, want)
  LOOP
    v_got := public.fantasy_tactic_points(2::smallint, 0::smallint, v_pos, 'balanced');
    ASSERT v_got = v_want,
      format('A: 2:0 для %s должно быть %s, а вышло %s', v_pos, v_want, v_got);
  END LOOP;

  FOR v_pos, v_want IN
    SELECT * FROM (VALUES ('gk', 1), ('def', 2), ('mid', 2), ('fwd', 3)) AS t(pos, want)
  LOOP
    v_got := public.fantasy_tactic_points(1::smallint, 1::smallint, v_pos, 'balanced');
    ASSERT v_got = v_want, format('A: 1:1 для %s: %s вместо %s', v_pos, v_got, v_want);
  END LOOP;

  FOR v_pos, v_want IN
    SELECT * FROM (VALUES ('gk', 5), ('def', 5), ('mid', 2), ('fwd', 1)) AS t(pos, want)
  LOOP
    v_got := public.fantasy_tactic_points(0::smallint, 0::smallint, v_pos, 'balanced');
    ASSERT v_got = v_want, format('A: 0:0 для %s: %s вместо %s', v_pos, v_got, v_want);
  END LOOP;

  FOR v_pos, v_want IN
    SELECT * FROM (VALUES ('gk', 3), ('def', 6), ('mid', 6), ('fwd', 9)) AS t(pos, want)
  LOOP
    v_got := public.fantasy_tactic_points(3::smallint, 1::smallint, v_pos, 'balanced');
    ASSERT v_got = v_want, format('A: 3:1 для %s: %s вместо %s', v_pos, v_got, v_want);
  END LOOP;

  -- Крупное поражение бьёт по всем линиям одинаково: результат клуба общий.
  FOREACH v_pos IN ARRAY ARRAY['gk', 'def', 'mid', 'fwd'] LOOP
    v_got := public.fantasy_tactic_points(0::smallint, 4::smallint, v_pos, 'balanced');
    ASSERT v_got = -1, format('A: 0:4 для %s должно быть −1, а вышло %s', v_pos, v_got);
  END LOOP;

  -- ── B. Веса схем. Суть — в нулях. ──────────────────────────────────────
  -- «Оборона» за голы не платит: 3:1 защитнику — только база победы.
  v_got := public.fantasy_tactic_points(3::smallint, 1::smallint, 'def', 'defensive');
  ASSERT v_got = 3,
    format('B: «Оборона» не должна платить за голы, 3:1 защитнику дало %s', v_got);

  -- «Атака» за сухарь не платит: 0:0 нападающему — только база ничьей.
  v_got := public.fantasy_tactic_points(0::smallint, 0::smallint, 'fwd', 'attacking');
  ASSERT v_got = 1,
    format('B: «Атака» не должна платить за сухарь, 0:0 нападающему дало %s', v_got);

  -- «Оборона» удваивает сухарь: вратарь при 2:0 — 3 базы + 4×2.
  v_got := public.fantasy_tactic_points(2::smallint, 0::smallint, 'gk', 'defensive');
  ASSERT v_got = 11, format('B: «Оборона» вратарю при 2:0: %s вместо 11', v_got);

  -- «Баланс» получает что-то в любом исходе — это его смысл, а не слабость.
  ASSERT public.fantasy_tactic_points(3::smallint, 1::smallint, 'def', 'balanced') = 6,
    'B: «Баланс» обязан обгонять «Оборону» там, где голы есть, а сухаря нет';

  -- ── E. Симметрия крайностей ────────────────────────────────────────────
  -- Ни одна из двух крайних схем не должна быть просто лучше другой.
  ASSERT public.fantasy_tactic_points(2::smallint, 0::smallint, 'gk',  'defensive')
       = public.fantasy_tactic_points(2::smallint, 0::smallint, 'fwd', 'attacking'),
    'E: «Оборона» вратарю и «Атака» нападающему при 2:0 обязаны стоить одинаково';

  -- ── C. Карточка без позиции: старое правило, схемой не двигается ───────
  ASSERT public.fantasy_tactic_points(2::smallint, 0::smallint, NULL, 'balanced')
       = public.fantasy_match_points(2::smallint, 0::smallint),
    'C: без позиции должно работать старое правило целиком';

  FOR v_pos IN SELECT key FROM public.fantasy_tactic LOOP
    ASSERT public.fantasy_tactic_points(2::smallint, 0::smallint, NULL, v_pos) = 7,
      format('C: схема «%s» не должна двигать карточку без позиции', v_pos);
  END LOOP;

  -- ── D. Требование схемы к составу, на настоящих карточках ─────────────
  INSERT INTO public.cards (name, name_en, category, active, facts)
  VALUES ('ZZTESTTAC Вратарь', 'ZZTESTTAC GK', 'player', true,
          '{"position": "Вратарь"}'::jsonb)
  RETURNING id INTO v_gk;
  INSERT INTO public.cards (name, name_en, category, active, facts)
  VALUES ('ZZTESTTAC Защитник', 'ZZTESTTAC DEF', 'player', true,
          '{"position": "Защитник"}'::jsonb)
  RETURNING id INTO v_def;
  INSERT INTO public.cards (name, name_en, category, active, facts)
  VALUES ('ZZTESTTAC Полузащитник', 'ZZTESTTAC MID', 'player', true,
          '{"position": "Полузащитник"}'::jsonb)
  RETURNING id INTO v_mid;
  INSERT INTO public.cards (name, name_en, category, active, facts)
  VALUES ('ZZTESTTAC Нападающий', 'ZZTESTTAC FWD', 'player', true,
          '{"position": "Нападающий"}'::jsonb)
  RETURNING id INTO v_fwd;

  -- «Баланс» не требует ничего — подходит любая пятёрка.
  ASSERT public.fantasy_tactic_fits(ARRAY[v_mid, v_mid, v_mid, v_mid, v_mid], 'balanced'),
    'D: «Баланс» не должен ничего требовать';

  -- «Оборона» требует троих из обороны: вратарь считается своим.
  ASSERT public.fantasy_tactic_fits(ARRAY[v_gk, v_def, v_def, v_mid, v_fwd], 'defensive'),
    'D: вратарь+два защитника обязаны проходить под «Оборону»';
  ASSERT NOT public.fantasy_tactic_fits(ARRAY[v_gk, v_def, v_mid, v_mid, v_fwd], 'defensive'),
    'D: двое в обороне под «Оборону» проходить не должны';

  -- «Атака» требует двух нападающих.
  ASSERT public.fantasy_tactic_fits(ARRAY[v_fwd, v_fwd, v_mid, v_mid, v_def], 'attacking'),
    'D: два нападающих обязаны проходить под «Атаку»';
  ASSERT NOT public.fantasy_tactic_fits(ARRAY[v_fwd, v_mid, v_mid, v_mid, v_def], 'attacking'),
    'D: один нападающий под «Атаку» проходить не должен';

  -- Карточка без позиции не идёт в зачёт НИ ОДНОЙ линии: она не «свободный
  -- защитник», она неизвестность.
  ASSERT NOT public.fantasy_tactic_fits(
      ARRAY[v_gk, v_def, (SELECT id FROM public.cards
                           WHERE facts->>'position' IS NULL AND category = 'player'
                           LIMIT 1), v_mid, v_fwd], 'defensive'),
    'D: карточка без позиции не должна закрывать требование обороны';

  -- Незнакомая схема — отказ, а не тихий откат к «Балансу».
  ASSERT NOT public.fantasy_tactic_fits(ARRAY[v_mid, v_mid, v_mid, v_mid, v_mid], 'tiki-taka'),
    'D: незнакомая схема не должна подходить ничему';
END
$test$;

SELECT 'fantasy tactics: all assertions passed' AS result;

ROLLBACK;
