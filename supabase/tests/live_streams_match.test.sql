-- ============================================================
-- SHERLOCK SCHOLES — test: «идёт матч» против «идёт разговор о матче»
--
-- ЗАКРЕПЛЯЕТ ЕДИНСТВЕННЫЙ СЛУЧАЙ, РАДИ КОТОРОГО ПРЕДИКАТ УСТРОЕН СЛОЖНЕЕ,
-- ЧЕМ «есть vs». Замер 17.08.2026, 19:40 UTC, четырнадцать официальных
-- каналов, два живых эфира:
--
--   MLS      «MLS NEXT PRO: Atlanta United 2 vs Chicago Fire FC II»  ← матч
--   LALIGA   «RC DEPORTIVO vs ELCHE CF | RUEDA DE PRENSA»            ← НЕ матч
--
-- Оба заголовка содержат «vs» и два клуба. Отличает их только исключение,
-- поэтому оно и проверяется первым: если кто-то упростит предикат до поиска
-- «vs», этот тест упадёт на настоящем заголовке, а не на выдуманном.
--
-- ЧТО ПРОВЕРЯЕТСЯ ОТДЕЛЬНО — СМЕЩЕНИЕ. Ошибка здесь несимметрична: не
-- показать идущий матч дёшево, показать пресс-конференцию под надписью
-- «идёт сейчас» — дорого. Случай D утверждает это смещение НАРОЧНО, чтобы
-- правка, которая его снимет, себя показала.
--
-- HOW TO RUN — Supabase SQL Editor, или:
--     psql "$DATABASE_URL" -f supabase/tests/live_streams_match.test.sql
--
-- SAFETY. Ничего не пишет: только immutable-функции. Транзакция и ROLLBACK
-- оставлены для единообразия с остальными тестами.
--
-- Requires: live_streams.sql.
-- On success prints: `live_streams: all assertions passed`.
-- ============================================================

BEGIN;

DO $test$
DECLARE
  v_title TEXT;
  v_want  BOOLEAN;
  v_got   BOOLEAN;
BEGIN
  -- ── A. Два настоящих заголовка из замера ───────────────────────────────
  ASSERT public.looks_like_match(
           'MLS NEXT PRO: Atlanta United 2 vs Chicago Fire FC II | Aug 18, 2026')
     AND NOT public.is_studio_talk(
           'MLS NEXT PRO: Atlanta United 2 vs Chicago Fire FC II | Aug 18, 2026'),
    'A: живой матч MLS перестал считаться матчем';

  ASSERT public.looks_like_match('RC DEPORTIVO vs ELCHE CF | RUEDA DE PRENSA'),
    'A: «vs» в заголовке пресс-конференции обязан находиться — на этом стоит весь смысл исключения';
  ASSERT public.is_studio_talk('RC DEPORTIVO vs ELCHE CF | RUEDA DE PRENSA'),
    'A: пресс-конференция Ла Лиги снова проходит как матч';

  -- ── B. Решение целиком, на всех формах ────────────────────────────────
  FOR v_title, v_want IN
    SELECT * FROM (VALUES
      -- Матч назван на языках, на которых лиги называют его сами.
      ('Flamengo x Palmeiras | Brasileirão',                   true),
      ('Bayern gegen Dortmund | LIVE',                         true),
      ('PSG contre Marseille',                                 true),
      ('Зенит против Спартака',                                true),
      ('Inter contro Milan',                                   true),
      ('K League 1: Ulsan HD vs Jeonbuk Hyundai Motors',       true),
      -- Студия вокруг матча — не матч, хотя названа теми же клубами.
      ('Real Madrid vs Barcelona - PRE-MATCH SHOW',            false),
      ('Weekly Podcast: Arsenal vs Chelsea preview',           false),
      ('Post-match reaction: Ajax vs PSV',                     false),
      ('Champions League Draw Show',                           false),
      ('Sorteo de la Copa del Rey',                            false),
      -- Повтор в петле. Канал В ЭФИРЕ, но идёт нарезка, а не игра.
      ('Match Highlights: Inter vs Milan',                     false),
      ('Resumen: Sevilla vs Betis',                            false),
      ('Melhores Momentos: Flamengo x Vasco',                  false),
      ('Classic match: Liverpool vs Milan 2005',               false),
      -- Ни матча, ни студии.
      ('Team news and analysis',                               false),
      ('Goal of the month',                                    false)
    ) AS t(title, want)
  LOOP
    v_got := public.looks_like_match(v_title) AND NOT public.is_studio_talk(v_title);
    ASSERT v_got = v_want,
      format('B: «%s» — ожидали %s, получили %s', v_title, v_want, v_got);
  END LOOP;

  -- ── C. Известные пределы, утверждаемые НАРОЧНО ─────────────────────────
  -- Одиночное « x » требует букв с обеих сторон и пробелов: без этого оно
  -- ловило бы «Max», «Box» и любой хэштег.
  ASSERT NOT public.looks_like_match('Max Verstappen Box Box Box'),
    'C: одиночное x снова ловит слова с буквой x';

  -- Матч, названный ТОЛЬКО тире, не распознаётся — и это принято. Тире стоит
  -- разделителем в каждом втором заголовке YouTube, и считать его признаком
  -- матча значило бы объявить матчем всё подряд.
  ASSERT NOT public.looks_like_match('Arsenal - Chelsea'),
    'C: тире стало признаком матча — проверьте, не объявлен ли матчем каждый заголовок';

  -- ── D. Смещение в сторону «лучше не показать» ──────────────────────────
  -- Заголовок, в котором есть И признак матча, И признак студии, считается
  -- студией. Утверждается отдельно от B, потому что это правило, а не случай.
  ASSERT NOT (public.looks_like_match('Barcelona vs Girona | RUEDA DE PRENSA')
              AND NOT public.is_studio_talk('Barcelona vs Girona | RUEDA DE PRENSA')),
    'D: при споре признаков победил матч — смещение перевёрнуто';

  RAISE NOTICE 'live_streams: all assertions passed';
END
$test$;

ROLLBACK;
