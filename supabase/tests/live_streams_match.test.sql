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

  -- ── B2. Заголовки, НА КОТОРЫХ ПРЕДИКАТ ЛОМАЛСЯ ────────────────────────
  -- Каждый — из обхода вкладок трансляций десяти официальных каналов (308
  -- заголовков). Все шесть форм ниже проходили НЕВЕРНО, пока их не измерили,
  -- и каждая стоила отдельной правки. Выдумать их не получилось бы: три из
  -- шести — не на латинице или не на английском.
  FOR v_title, v_want IN
    SELECT * FROM (VALUES
      -- «previa» — испанское превью. Ла Лига подписывает так 8 из 30.
      ('🔴 RC DEPORTIVO vs ELCHE CF - PREVIA DEL PARTIDO',                     false),
      -- «avant-match» — французское. Плюс голое «replay», которым Ligue 1
      -- подписывает почти все свои трансляции.
      ('🏆 REPLAY | Avant-match : RC Lens 🆚 Paris Saint-Germain',              false),
      ('Replay | Matchday 25 - Ligue 1 Pre-Sale Service | PSG vs Monaco',      false),
      -- «highlight» без s. Через список с одним «highlights» проходило.
      ('[Highlight] Hana Bank K League 1 2026 Round 23 Jeju vs. Anyang',       false),
      -- «хайлайты» по-корейски: 22 заголовка из 72 у K League.
      ('[30분 하이라이트] 하나은행 K리그2 2026 22R 대구 vs 충남아산',                    false),
      -- « x » между БРЕНДАМИ, а не клубами. Известный предел, см. C.
      ('REVEAL TEAM OF THE SEASON FUT 24 🎮🔥 I Ligue 1 Uber Eats x EA',        false),
      -- И то, что предикат МОЛЧА ПРОПУСКАЛ: британское « v » как разделитель.
      -- Отвергнуто мной как рискованное — и зря: так УЕФА называет финалы.
      ('Häcken v Hammarby - 2026 UEFA Women''s Europa Cup Final - 2nd Leg',    true),
      ('Wolves v Shanghai Shenhua FC | Premier League NEXTGEN Beijing Cup 2026', true),
      -- Настоящие матчи с четырёх каналов, ради которых всё и заведено.
      ('EN VIVO | ARGENTINA vs. BRASIL | CONMEBOL SUB17 FUTSAL 2026',          true),
      ('EN VIVO | Pachuca vs. Chivas | Torneo Sub-14 2026 | Final | Partido Completo', true),
      ('🔴 ATALANTA U19 vs JUVENTUS U19 | Full Match LIVE | Coppa Italia',      true),
      ('Preseason Friendly | Cerezo Osaka vs. Borussia Dortmund | Full Game',  true)
    ) AS t(title, want)
  LOOP
    v_got := public.looks_like_match(v_title) AND NOT public.is_studio_talk(v_title);
    ASSERT v_got = v_want,
      format('B2: «%s» — ожидали %s, получили %s', v_title, v_want, v_got);
  END LOOP;

  -- ── B3. Не матч, хотя выглядит как матч ───────────────────────────────
  -- Два класса, найденные обходом каналов-кандидатов. Ни один из признаков
  -- выше их не ловил, и оба прошли бы как идущие матчи.
  FOR v_title, v_want IN
    SELECT * FROM (VALUES
      -- КИБЕРФУТБОЛ. Официальный канал Indian Super League ведёт 29
      -- трансляций из 30 под именем «eISL»: настоящие клубы, настоящее «vs»,
      -- играют в видеоигру.
      ('[LIVE] eISL Season 2 Playoffs - Semi Final 2 Leg 2 | North East United FC vs Kerala Blasters FC', false),
      ('[LIVE] eISL Season 2 League - Match 4 | FC Goa vs Kerala Blasters FC', false),
      ('eFootball Championship: Real Madrid vs Barcelona',                     false),
      ('EA SPORTS FC Pro: Ajax vs PSV',                                        false),
      -- СОПРОВОДИТЕЛЬНЫЙ СТРИМ. Экстракляса ведёт их под меткой «LIVE IRL», и
      -- в тех же заголовках написано, что сам матч идёт на Canal+Sport 3.
      ('LIVE IRL | O Kuchta! Legia Warszawa vs Radomiak Radom | Mecz w Canal+Sport 3', false),
      ('Rozgrzewka przed ceremonią! | LECH vs WISŁA | LIVE IRL',               false),
      -- ЖЕРЕБЬЁВКА. Отсекалась ОТСУТСТВИЕМ признака матча, а не правилом —
      -- «Group A vs Group B» проскочило бы. Найдена первым же прогоном после
      -- добавления канала АФК.
      ('Live | AFC Champions League Two 2026/27™ Group Stage Draw',            false),
      ('Group Stage Draw: Group A vs Group B',                                 false),
      ('Champions League Draw Ceremony',                                       false),
      -- Настоящие матчи с каналов, заведённых после этой проверки.
      ('L.A. Firpo vs LD Alajuelense | Copa Centroamericana Concacaf 2026',    true),
      ('Mount Pleasant vs Cibao FC | 2026 Concacaf Caribbean Cup',             true),
      ('Isuzu UTE A-League 2026 Grand Final - Auckland FC v Sydney FC',        true),
      ('Tokyo Verdy Beleza vs Naegohyang Women''s FC | Full Match | FINAL',    true)
    ) AS t(title, want)
  LOOP
    v_got := public.looks_like_match(v_title) AND NOT public.is_studio_talk(v_title);
    ASSERT v_got = v_want,
      format('B3: «%s» — ожидали %s, получили %s', v_title, v_want, v_got);
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

  -- « x » между брендами от « x » между клубами разбором заголовка не
  -- отличить, и предикат этого не умеет. Конкретный случай снят исключением
  -- на формат («team of the season»), а САМ ПРЕДЕЛ остаётся и утверждается:
  -- вымышленная коллаборация без такого маркера пройдёт как матч.
  ASSERT public.looks_like_match('Nike x Adidas')
     AND NOT public.is_studio_talk('Nike x Adidas'),
    'C: предел « x » исчез — если он снят намеренно, обновите комментарий в live_streams.sql';

  -- Метка «IRL» отсекает сопроводительные стримы, но обязана быть ОТДЕЛЬНЫМ
  -- словом: без границ она сидит внутри «girl» и «swirl» и выключила бы
  -- женский футбол целиком.
  ASSERT NOT public.is_studio_talk('Girls Cup Final: Chelsea vs Arsenal'),
    'C: «irl» сработало внутри слова — проверьте границы \\m…\\M';
  ASSERT NOT public.is_studio_talk('Swirl Cup: Milan vs Inter'),
    'C: «irl» сработало внутри слова';

  -- «Ничья» в отчёте о матче — не церемония жеребьёвки. Отсекать надо форму
  -- («stage draw», «draw ceremony»), а не само слово: голое `draw` выбросило бы
  -- каждый отчёт о матче, закончившемся вничью.
  ASSERT public.looks_like_match('Arsenal vs Chelsea — thrilling 2-2 draw at the Emirates')
     AND NOT public.is_studio_talk('Arsenal vs Chelsea — thrilling 2-2 draw at the Emirates'),
    'C: слово draw стало исключением само по себе — ничейные матчи теперь не показываются';

  -- «irl» внутри слова страницей не является: границы слова обязаны стоять.
  ASSERT public.looks_like_match('Girls Cup Final: Ajax vs PSV')
     AND NOT public.is_studio_talk('Girls Cup Final: Ajax vs PSV'),
    'C: «irl» ловится внутри слов — проверьте границы \\m…\\M';

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
