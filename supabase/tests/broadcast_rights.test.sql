-- ============================================================
-- SHERLOCK SCHOLES — test: правообладатель для страны читателя
--
-- ЧТО ЗДЕСЬ ПРОВЕРЯЕТСЯ, И ПОЧЕМУ НЕ СОДЕРЖИМОЕ ТАБЛИЦЫ. Строки меняются
-- каждый сезон — тест, утверждающий «в Испании это DAZN», через год покраснеет
-- сам по себе и будет прав. Проверяется ПРАВИЛО ВЫБОРА, которое меняться не
-- должно:
--
--   A. страна получает своего вещателя;
--   B. ПУСТО — ЭТО ОТВЕТ. Для России у Премьер-лиги правообладателя нет
--      вовсе, и функция обязана вернуть ноль строк, а не подставить соседа;
--   C. мировые права подходят любой стране;
--   D. СВОЙ ВЕЩАТЕЛЬ ВАЖНЕЕ МИРОВОГО — если есть оба, первым идёт местный.
--
-- Случай D проверяется на ВЫДУМАННОМ турнире, который тут же откатывается:
-- сегодня пары «местный + мировой» в данных нет, а правило есть, и без такой
-- строки оно осталось бы непроверенным до первого турнира, где оба появятся.
--
-- HOW TO RUN — Supabase SQL Editor, или:
--     psql "$DATABASE_URL" -f supabase/tests/broadcast_rights.test.sql
--
-- SAFETY. Пишет две строки во ВЛОЖЕННОЙ транзакции и откатывает всё целиком
-- через ROLLBACK. В боевой базе после прогона не остаётся ничего.
--
-- Requires: broadcast_rights.sql.
-- On success prints: `broadcast_rights: all assertions passed`.
-- ============================================================

BEGIN;

DO $test$
DECLARE
  v_n     INT;
  v_first TEXT;
BEGIN
  -- ── A. Страна получает своего вещателя ─────────────────────────────────
  SELECT count(*) INTO v_n FROM public.broadcast_rights_for('soccer_epl', 'GB');
  ASSERT v_n >= 1, 'A: для Британии не нашлось ни одного правообладателя АПЛ';

  -- Регистр кода страны не значим: клиент шлёт то, что объявила локаль.
  SELECT count(*) INTO v_n FROM public.broadcast_rights_for('soccer_epl', 'gb');
  ASSERT v_n >= 1, 'A: строчный код страны перестал находиться';

  -- ── B. Пусто — это ответ «не заявлен» ──────────────────────────────────
  -- ⚠️ Не меняйте это на «хоть что-нибудь показать». Премьер-лига не называет
  -- правообладателя для России, и подстановка соседней строки была бы враньём
  -- на основном языке приложения.
  SELECT count(*) INTO v_n FROM public.broadcast_rights_for('soccer_epl', 'RU');
  ASSERT v_n = 0,
    format('B: для России нашлось %s строк — правообладателя АПЛ там не заявлено', v_n);

  -- Несуществующая страна ведёт себя так же: пусто, а не ошибка.
  SELECT count(*) INTO v_n FROM public.broadcast_rights_for('soccer_epl', 'ZZ');
  ASSERT v_n = 0, 'B: выдуманный код страны что-то вернул';

  -- ── C. Мировые права подходят любой стране ─────────────────────────────
  SELECT count(*) INTO v_n FROM public.broadcast_rights_for('soccer_usa_mls', 'RU');
  ASSERT v_n >= 1,
    'C: мировые права MLS не нашлись для страны без своей строки — проверьте флаг worldwide';

  -- ── D. Свой вещатель важнее мирового ───────────────────────────────────
  INSERT INTO public.broadcast_rights
    (sport_key, territory, broadcaster, country, worldwide,
     season_from, season_to, source_url)
  VALUES
    ('zz_test_league', 'Worldwide', 'Global Pass', null, true,
     '2026', '2026', 'https://example.invalid/test'),
    ('zz_test_league', 'Testland',  'Local TV',    'ZZ', false,
     '2026', '2026', 'https://example.invalid/test');

  SELECT broadcaster INTO v_first
  FROM public.broadcast_rights_for('zz_test_league', 'ZZ') LIMIT 1;
  ASSERT v_first = 'Local TV',
    format('D: первым вернулся «%s», а должен местный вещатель', v_first);

  -- А стране без своей строки достаётся мировой — и он единственный.
  SELECT count(*) INTO v_n FROM public.broadcast_rights_for('zz_test_league', 'QQ');
  ASSERT v_n = 1, format('D: стране без своей строки досталось %s строк вместо одной', v_n);

  SELECT broadcaster INTO v_first
  FROM public.broadcast_rights_for('zz_test_league', 'QQ') LIMIT 1;
  ASSERT v_first = 'Global Pass', format('D: вместо мировых прав вернулось «%s»', v_first);

  -- ── E. Оба аргумента необязательны ─────────────────────────────────────
  -- Ради этого они и сделаны необязательными: один путь чтения на оба вопроса.
  SELECT count(*) INTO v_n FROM public.broadcast_rights_for(null, 'GB');
  ASSERT v_n >= 1, 'E: «моя страна, все турниры» перестал работать';

  SELECT count(*) INTO v_n FROM public.broadcast_rights_for('soccer_epl', null);
  ASSERT v_n >= 2, 'E: «этот турнир, все страны» перестал работать';

  RAISE NOTICE 'broadcast_rights: all assertions passed';
END
$test$;

ROLLBACK;
