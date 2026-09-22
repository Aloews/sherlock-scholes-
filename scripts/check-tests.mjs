#!/usr/bin/env node
// Проверка проверок: способна ли каждая из них ВООБЩЕ упасть.
//
// ⚠️ ЗАЧЕМ. В проекте восемь сотен юнит-тестов, и они были зелёными ровно
// тогда, когда владелец пятый раз писал «ТВ не работает». Зелёная проверка, не
// способная покраснеть, хуже отсутствия проверки: отсутствие видно, а ложная
// зелень внушает уверенность.
//
// (Сам экран ТВ с тех пор уехал в Aloews/sherlock-tv вместе со своими
// проверками — но повод, по которому этот скрипт написан, никуда не делся.)
//
// Этот скрипт НАРОЧНО ЛОМАЕТ по одной вещи за раз и требует, чтобы
// соответствующая проверка это заметила. Не заметила — она пустая, и скрипт
// валит прогон.
//
// ⚠️ ЛОМАЕТ ОН НАСТОЯЩИЕ ФАЙЛЫ и восстанавливает их в `finally`. Если процесс
// убить посреди прогона, останется испорченный файл — поэтому перед работой
// проверяется, что дерево чистое, а после каждой поломки идёт немедленное
// восстановление из памяти, а не из git.
//
//   node scripts/check-tests.mjs
//
// Выход: 0 — все проверки способны падать; 1 — есть пустая.

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';

const CASES = [];
function testcase(name, why, fn) { CASES.push({ name, why, fn }); }

/** Прогнать команду. `true` — вышла нулём. */
function passes(cmd, timeoutMs = 300_000) {
  try {
    execSync(cmd, { stdio: 'pipe', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/** Испортить файл, прогнать проверку, вернуть файл как был. */
function withBroken(path, mutate, run) {
  const original = readFileSync(path, 'utf-8');
  try {
    writeFileSync(path, mutate(original), 'utf-8');
    return run();
  } finally {
    writeFileSync(path, original, 'utf-8');
  }
}

// ---------------------------------------------------------------------------
testcase(
  'check-i18n замечает пропавший ключ',
  'девять локалей — главное правило проекта; проверка, которая не видит дыру, ' +
  'позволяет выкатить экран, где игрок увидит сырой ключ вместо текста',
  () => withBroken('src/shared/i18n/locales/es.json',
    (s) => {
      const d = JSON.parse(s);
      // Убираем ровно один ключ — самый тихий из возможных сбоев.
      delete d.home.back;
      return JSON.stringify(d, null, 2) + '\n';
    },
    () => !passes('node scripts/check-i18n.mjs')),
);

// ⚠️ ТРИ СЛУЧАЯ НИЖЕ РАНЬШЕ ЛОМАЛИ `features/stream`. Экран ТВ уехал в
// отдельный репозиторий (Aloews/sherlock-tv), и эти три пришлось перенацелить
// на код, который у игры ОСТАЛСЯ. Мишени выбраны не наугад: каждая — правило,
// на котором проект уже ломался, и каждая проверена вручную на то, что
// подмена действительно краснеет.
//
// ⚠️ ПРЕЖНИЕ ТРИ НЕ ПОТЕРЯНЫ, И ЧИНИТЬ ЗДЕСЬ НЕЧЕГО. Они уехали вместе с
// экраном и живут в `scripts/check-tests.mjs` соседнего репозитория:
// «сломанное правило отбора» (http вместо https), «сломанный порядок каналов»
// (порядок по здоровью) и «открытый каталог» (флаг VITE_SHOW_CATALOGUE над
// группой 18+). Проверено прогоном там 14.09.2026: восемь случаев из восьми
// краснеют, когда их ломают.
//
// ⚠️ И ТЯНУТЬ ИХ ОБРАТНО СЮДА НЕ НАДО. Случай, который правит файл в ЧУЖОМ
// клоне, требует этот клон с установленными зависимостями у каждого, кто
// запускает проверку, ломает игру из-за чужого кода и краснит не тот
// репозиторий. Проверка живёт рядом с кодом, который стережёт, — здесь это
// правило соблюдено обеими сторонами.

testcase(
  'tsc замечает несуществующее поле',
  'строгий режим — единственное, что ловит опечатку в имени поля до прода',
  () => withBroken('src/features/digest/groupStories.ts',
    (s) => s.replace('storyTokens(n.title)', 'storyTokens(n.nosuchfield)'),
    () => !passes('npx tsc --noEmit')),
);

testcase(
  'vitest замечает сломанную транслитерацию',
  'на ней «Ноттингем» встречается с «Nottingham» и склеивается в один сюжет; ' +
  'сломай её — лента снова печатает один трансфер пятью строками',
  () => withBroken('src/features/digest/storyTokens.ts',
    (s) => s.replace("w = w.replace(/ж/g, 'zh')", "w = w.replace(/ж/g, 'j')"),
    () => !passes('npx vitest run src/features/digest/storyTokens.test.ts')),
);

testcase(
  'vitest замечает сломанную склейку сюжетов',
  'относительный порог — та самая правка, без которой объединение по общим ' +
  'словам слило 20 заметок из 60 в одну карточку через пять разных матчей',
  () => withBroken('src/features/digest/groupStories.ts',
    (s) => s.replace('export const SAME_STORY_FRACTION = 0.45;',
                     'export const SAME_STORY_FRACTION = 0;'),
    () => !passes('npx vitest run src/features/digest/groupStories.test.ts')),
);

testcase(
  'vitest замечает подпись, уехавшую в Edge-функцию',
  'подпись Telegram, попавшая в вызов функции, требует предзапроса CORS — и ' +
  'браузер блокирует вызов ЦЕЛИКОМ, пока сервер отвечает 200 на прямой ' +
  'запрос: ровно так «собрать сводку», вход в комнату и ОПЛАТА перестали ' +
  'работать, а сотня проверок осталась зелёной',
  () => withBroken('src/shared/lib/signatureScope.ts',
    (s) => s.replace(
      "  return url.includes('/rest/v1/') || url.includes('/realtime/v1/');",
      '  return true;  // СЛОМАНО НАРОЧНО: подпись едет всюду'),
    () => !passes('npx vitest run test/deploy_functions.test.ts src/shared/lib/signatureScope.test.ts')),
);

testcase(
  'vitest замечает закрытый экран, показанный неподписанному',
  'владелец просил прятать недоступные разделы, а не показывать их с замком; ' +
  'правило, которое перестало прятать, снаружи выглядит как «ничего не ' +
  'изменилось», и заметить это можно только тестом',
  () => withBroken('src/shared/lib/proGate.ts',
    (s) => s.replace(
      '  return state.proLoaded && !state.isPro && requiresPro(pathname);',
      '  return false;  // СЛОМАНО НАРОЧНО: не прячем ничего'),
    () => !passes('npx vitest run src/shared/lib/proGate.test.ts')),
);

testcase(
  'тесты мухи замечают дофамин, который усиливает связь',
  'у дрозофилы дофамин ОСЛАБЛЯЕТ синапс KC→MBON; правило, которое усиливает, ' +
  'выглядит как обучение и даёт числа, но это уже не муха, а обычный градиент',
  () => withBroken('football_scraper/fly_brain.py',
    (s) => s.replace('block * (1.0 - self.depression), floor)',
                     'block * (1.0 + self.depression), floor)'),
    () => !passes(py('tests/test_fly_brain.py'))),
);

testcase(
  'pytest замечает тест, который выходит на успехе',
  'CLAUDE.md предупреждает: `pytest -q` СОБИРАЕТ все файлы test_*.py, то есть ' +
  'импортирует их. `sys.exit(0)` в теле модуля рвёт сбор с INTERNALERROR — и ' +
  'прогон падает ровно тогда, когда все проверки прошли. Локально зелено, в ' +
  'CI красное; так и случилось с тестами мухи',
  () => withBroken('football_scraper/tests/test_fly_brain.py',
    (s) => s.replace('print("все прошли")',
                     'print("все прошли")\nsys.exit(0)  # СЛОМАНО НАРОЧНО'),
    () => !passes('cd football_scraper && python3 -m pytest -q', 600_000)),
);

testcase(
  'тесты порядка замечают возврат к чтению только связанных',
  'сборщик страниц читал ТОЛЬКО тех, кто уже в колоде; у остальных никогда не ' +
  'появлялась дата рождения, а без неё их нечем связать — петля, молчавшая ' +
  'месяцами: шаг отрабатывал каждую ночь и ничего не ронял',
  () => withBroken('docs/soccerwiki_players.py',
    (s) => s.replace('"select": "pid,name,rating,place", "order": "place.asc"',
                     '"select": "pid,name,rating", "order": "rating.desc"'),
    () => !passes(py('tests/test_talent_order.py'))),
);

testcase(
  'check-prod замечает мёртвый адрес',
  'проверка прода — единственная, способная упасть по той причине, по которой ' +
  'ломается приложение; если она зелёная на несуществующем хосте, она пустая',
  () => !passes('PROD_APP_URL=https://no-such-host.invalid node scripts/check-prod.mjs',
                120_000),
);

testcase(
  'check-prod замечает охват известных, считанный не по тем карточкам',
  'шаг догадки отрабатывал каждую ночь, что-то угадывал и не падал — а самых ' +
  'известных карточек не пробовал НИ РАЗУ: у всех непробованных ключ ' +
  'сортировки был одинаков, и внутри группы порядок оставался по id. Снаружи ' +
  'это выглядело как «всё работает», и поймать такое может только проверка, ' +
  'которая смотрит ИМЕННО на верх колоды',
  () => withBroken('scripts/check-prod.mjs',
    (s) => s.replaceAll('&fame=gte.80', '&fame=is.null'),
    () => !passes('node scripts/check-prod.mjs', 300_000)),
);

testcase(
  'тесты скрапера замечают снятый гард',
  'футбольный гард — единственное, что отделяет футболиста Данте от поэта Данте',
  () => withBroken('docs/cards_descriptions_build.py',
    (s) => s.replace('def lead_is_football(lead, lang="ru"):',
                     'def lead_is_football(lead, lang="ru"):\n    return True  # СЛОМАНО НАРОЧНО'),
    () => !passes('cd football_scraper && python3 tests/test_descriptions.py')),
);

// ⚠️ `-B` И СНЯТЫЙ `__pycache__` — НЕ ПЕДАНТИЗМ, А УСЛОВИЕ РАБОТЫ ЭТИХ ДВУХ
// СЛУЧАЕВ. Правка `span + 1` -> `span + 2` не меняет РАЗМЕР файла, а порча и
// восстановление укладываются в одну секунду — то есть у восстановленного
// файла та же mtime и та же длина, что записаны в .pyc. Python считает такой
// кеш годным и продолжает исполнять СЛОМАННЫЙ байт-код. Стоило это получаса:
// тесты падали на файле, который `diff` называл совпадающим с исходным.
const py = (file) =>
  `rm -rf football_scraper/__pycache__ && cd football_scraper && `
  + `PYTHONDONTWRITEBYTECODE=1 python3 -B ${file}`;

testcase(
  'тесты скрапера замечают пропавшую лигу',
  'лига, выпавшая из списка обхода, не даёт ни ошибки, ни нуля в логе — её ' +
  'просто перестают спрашивать, и игроки этой лиги тихо остаются без ' +
  'статистики; именно так вторые дивизионы стояли на 2-5% охвата',
  () => withBroken('football_scraper/espn_stats.py',
    (s) => s.replace('    "eng.1": "English Premier League",\n', ''),
    () => !passes(py('tests/test_espn_stats.py'))),
);

testcase(
  'тесты скрапера замечают очередь догадки без известности',
  'третий ключ сортировки не видно ни в логе, ни в падении: шаг отрабатывает, ' +
  'что-то угадывает, но самые известные карточки в бюджет не попадают. Так и ' +
  'было — у ВСЕХ карточек с известностью 70+ без статистики tried = 0, среди ' +
  'них Тьерри Анри, Родриго, Агуэро и Карвахаль, пока тысячи карточек без ' +
  'единого просмотра в википедии перебирались каждую ночь',
  () => withBroken('football_scraper/sports_ru_stats.py',
    (s) => s.replace(
      '    todo.sort(key=lambda c: misses.get(c["id"], (-1, ""))\n'
      + '                            + (-float(value.get(c.get("club_key")) or 0.0),\n'
      + '                               -float(c.get("fame") or 0.0)))',
      '    todo.sort(key=lambda c: misses.get(c["id"], (-1, "")))'),
    () => !passes(py('tests/test_sports_ru_stats.py'))),
);

testcase(
  'тесты скрапера замечают очередь чтения без важности',
  'бюджета хватает на пятую часть очереди, и порядок решает не «когда», а ' +
  '«прочитают ли вообще»: по прежнему ключу в него попадали те, у кого ' +
  'удачный UUID — карточек с известностью 90+ было 11 из 319. Возврат к ' +
  'сортировке по одной свежести не ломает ни один запрос и виден только ' +
  'тем, что самых известных игроков в статистике опять нет',
  () => withBroken('football_scraper/sports_ru_stats.py',
    (s) => s.replace(
      '"&order=checked_day.asc.nullsfirst,club_value_eur.desc,"\n'
      + '                   "fame.desc,card_id.asc")',
      '"&order=checked_at.asc.nullsfirst,card_id.asc")'),
    () => !passes(py('tests/test_sports_ru_stats.py'))),
);

testcase(
  'тесты скрапера замечают отметки об отказе одним залпом',
  'запись всех отметок после цикла выглядит исправной ровно до тех пор, пока ' +
  'прогон доходит до конца: снятый на середине не пишет НИ ОДНОЙ, очередь не ' +
  'двигается, и следующей ночью перебираются те же первые сотни карточек',
  () => withBroken('football_scraper/sports_ru_stats.py',
    (s) => s.replace('            if tried % FLUSH_EVERY == 0:',
                     '            if False:'),
    () => !passes(py('tests/test_sports_ru_stats.py'))),
);

testcase(
  'тесты скрапера замечают дыру в окне дат',
  'пропущенные сутки выглядят как сутки без матчей: обход не падает, а матчи ' +
  'за этот день просто не собираются никогда',
  // Шаг по тридцать суток вместо шага по дню — правдоподобная «оптимизация»:
  // на большинстве длин она даёт те же месяцы и замечается только там, где
  // отрезок перешагивает месяц целиком (60 суток от 13 сентября теряют июль).
  () => withBroken('football_scraper/espn_stats.py',
    (s) => s.replace('        day -= timedelta(days=1)',
                     '        day -= timedelta(days=30)'),
    () => !passes(py('tests/test_espn_stats.py'))),
);

testcase(
  'vitest замечает ровный обратный отсчёт',
  'десять одинаковых уколов подряд — это и есть то, что раздражало: первый и ' +
  'десятый звучали одинаково, хотя означали разное. Нарастание вернуть в ' +
  'ровное состояние можно одной строкой, и на слух это заметит только тот, ' +
  'кто помнит, как было',
  () => withBroken('src/shared/lib/sounds.ts',
    (s) => s.replace('  return (from - remaining + 1) / from;', '  return 1;'),
    () => !passes('npx vitest run src/shared/lib/sounds.test.ts')),
);

testcase(
  'vitest замечает появившийся звуковой файл',
  'ответ «звук не ест трафика» верен ровно до первого mp3, положенного ' +
  '«просто послушать»; после него он становится враньём, и узнать об этом ' +
  'будет неоткуда',
  () => {
    const path = 'public/__probe.mp3';
    try {
      writeFileSync(path, 'не настоящий mp3, только имя', 'utf-8');
      return !passes('npx vitest run src/shared/lib/sounds.test.ts');
    } finally {
      if (existsSync(path)) unlinkSync(path);
    }
  },
);

// ── Обучение прогнозистов ──────────────────────────────────────────────────
// ⚠️ ЗАМЕР ОБУЧЕНИЯ ЛОМАЕТСЯ НЕ ПАДЕНИЕМ, А КРАСИВЫМ ЧИСЛОМ. Подсмотренное
// будущее, подбор по проверочной части, точка отсчёта в свою пользу — всё это
// даёт ЗЕЛЁНЫЙ прогон и неверный вывод. Пять случаев ниже ломают ровно те
// места, где такая ошибка в этом проекте УЖЕ была сделана.

testcase(
  'тесты обучения замечают утечку будущего в обучение',
  'случайный разрез вместо разреза по времени кладёт в обучение матчи, ' +
  'сыгранные ПОЗЖЕ проверочных; любая модель после этого выглядит умнее, ' +
  'чем она есть, и ошибка падает без единой строчки настоящего улучшения',
  () => withBroken('football_scraper/forecast_duel.py',
    (s) => s.replace(
      '    i = max(1, int(n * train))',
      '    i = max(1, int(n * train))\n    import numpy as _np; _np.random.default_rng(0)'
      + '  # СЛОМАНО: см. ниже\n    return slice(0, i), slice(0, i), slice(0, n)'),
    () => !passes(py('tests/test_forecast_duel.py'))),
);

testcase(
  'тесты обучения замечают подбор по проверочной части',
  'выбрать λ по тем же матчам, на которых потом отчитываешься, — это ' +
  'подглядывание в ответ: число выходит красивое, а на новых матчах его нет',
  () => withBroken('football_scraper/forecast_duel.py',
    (s) => s.replace('        m = mae(Xva @ w, yva)',
                     '        m = mae(Xtr @ w, ytr)  # СЛОМАНО: подбор по обучающей'),
    () => !passes(py('tests/test_forecast_duel.py'))),
);

testcase(
  'тесты обучения замечают штраф на свободном члене',
  'оштрафованный свободный член тянет прогноз к НУЛЮ ГОЛОВ, а не к обычной ' +
  'результативности; на экране это выглядит как «модель осторожничает», а на ' +
  'деле сломано',
  () => withBroken('football_scraper/forecast_duel.py',
    (s) => s.replace('    R[0, 0] = 0.0\n    return np.linalg.solve',
                     '    return np.linalg.solve'),
    () => !passes(py('tests/test_forecast_duel.py'))),
);

testcase(
  'тесты обучения замечают плотную проекцию вместо разрежённой',
  'плотная проекция — это уже не резервуар: разрежённость и есть то ' +
  'единственное, чем схема похожа на коннектом мухи, и без неё название ' +
  '«мозг дрозофилы» на экране становится неправдой',
  () => withBroken('football_scraper/forecast_duel.py',
    (s) => s.replace('    W *= rng.random((n_in, n_units)) < density', '    pass'),
    () => !passes(py('tests/test_forecast_duel.py'))),
);

testcase(
  'тесты обучения замечают снятую защиту от молчащей модели',
  'без нижней границы покрытия «свой вариант» выберет запас, при котором ' +
  'называет три матча из тысячи, и покажет великолепный процент ни о чём',
  () => withBroken('football_scraper/forecast_duel.py',
    (s) => s.replace('MIN_COVERAGE = 0.25', 'MIN_COVERAGE = 0.0'),
    () => !passes(py('tests/test_forecast_duel.py'))),
);

// ── Калибровка уверенности ─────────────────────────────────────────────────
// ⚠️ КАЛИБРОВКА ЛОМАЕТСЯ ОСОБЕННО ТИХО: она не падает и не рисует пустой
// экран, она просто перестаёт что-либо исправлять, а число рядом с прогнозом
// продолжает выглядеть как число. Две мутации ниже — ровно те две ошибки,
// которые уже были сделаны в этой сессии.

testcase(
  'тесты калибровки замечают разрез случайный вместо разреза по времени',
  'подгонка, проверенная на матчах вперемешку с учебными, показывает ' +
  'выигрыш, которого на новых матчах нет; тот же грех, что и в обучении, ' +
  'но здесь его труднее заметить — Brier всё равно падает',
  () => withBroken('football_scraper/calibration.py',
    (s) => s.replace('    return pairs[:cut], pairs[cut:]',
                     '    return pairs, pairs  # СЛОМАНО: проверка на учебной'),
    () => !passes(py('tests/test_calibration.py'))),
);

testcase(
  'тесты калибровки замечают снятую защиту от вырожденного входа',
  'если модель называет ОДНУ И ТУ ЖЕ уверенность, логит у всех точек один, ' +
  'гессиан вырождается точно, и Ньютон уезжает в чепуху — замерено: Brier ' +
  '0.5600 против 0.4580 сырого, то есть калибровка делает ХУЖЕ, чем ничего',
  () => withBroken('football_scraper/calibration.py',
    (s) => s.replace('    if var_x < 1e-12:', '    if False:  # СЛОМАНО'),
    () => !passes(py('tests/test_calibration.py'))),
);

testcase(
  'тесты калибровки замечают немонотонное преобразование',
  'калибровка обязана сохранять ПОРЯДОК матчей по уверенности: иначе это ' +
  'уже другая модель, выдающая себя за честную подпись к старой, и самый ' +
  'уверенный прогноз перестаёт быть самым уверенным',
  () => withBroken('football_scraper/calibration.py',
    (s) => s.replace('def apply_platt(a: float, b: float, p: float) -> float:\n'
                     + '    return sigmoid(a * logit(p) + b)',
                     'def apply_platt(a: float, b: float, p: float) -> float:\n'
                     + '    return sigmoid(-a * logit(p) + b)  # СЛОМАНО: знак'),
    () => !passes(py('tests/test_calibration.py'))),
);

testcase(
  'тесты прав замечают затёртое решение владельца о лицензии',
  '`license_ok` отвечает «есть ли у нас право это показывать», и ставит его ' +
  'человек. Допиши кто-нибудь `license_ok = excluded.license_ok` в upsert ' +
  'реестра — и следующее применение миграции вернёт умолчания поверх его ' +
  'решения. Ни одного признака на экране при этом не появится: строки на ' +
  'месте, числа на месте, они просто перестали быть его',
  () => withBroken('supabase/migrations/content_rights.sql',
    (s) => s.replace('  attribution = excluded.attribution,',
                     '  attribution = excluded.attribution,\n'
                     + '  license_ok  = excluded.license_ok,  -- СЛОМАНО'),
    () => !passes('npx vitest run test/content_rights.test.ts')),
);

testcase(
  'тесты прав замечают ревизию, открытую анониму',
  'ревизия отвечает «5335 снимков показываются без разрешения» — это ' +
  'утверждение про нас, а не про контент, и вдобавок стоит 5.5 с полного ' +
  'прохода при потолке anon в три секунды. Выданная анониму, она и список ' +
  'претензий раздаёт, и отвечает 57014 вместо ответа',
  () => withBroken('supabase/migrations/content_rights.sql',
    (s) => s.replace('grant execute on function public.content_rights_gaps()         to service_role;',
                     'grant execute on function public.content_rights_gaps() to anon, service_role;  -- СЛОМАНО'),
    () => !passes('npx vitest run test/content_rights.test.ts')),
);

testcase(
  'тесты подписи замечают разбор, который «узнаёт» чужой хост',
  'если `file_title_from_url` начнёт отдавать имя для ссылок Transfermarkt ' +
  'и ESPN, сборщик подписей понесёт Викискладу имена чужих файлов. Тот ' +
  'ответит «нет такого» на каждое — и прогон будет выглядеть рабочим, не ' +
  'подписав ничего',
  () => withBroken('docs/cards_photo_credits.py',
    (s) => s.replace("    m = re.search(r\"/commons/[0-9a-f]/[0-9a-f]{2}/([^/]+)$\", path)",
                     "    m = re.search(r\"/([^/]+)$\", path)  # СЛОМАНО: любой хост"),
    () => !passes(py('tests/test_photo_credits.py'))),
);

testcase(
  'тесты маркировки замечают разъехавшееся правило «чей файл»',
  'правило выписано дважды: в SQL по нему считает ревизия прав, в TypeScript ' +
  'им помечается каждый показанный файл. Разъедутся — обе стороны будут ' +
  '«работать», просто говорить про разное: ревизия считает снимок Викисклада ' +
  'подписанным, а разметка объявляет его чужим',
  () => withBroken('src/shared/lib/provenance.ts',
    (s) => s.replace("'a.espncdn.com': 'espn',",
                     "'a.espncdn.com': 'thesportsdb',  // СЛОМАНО"),
    () => !passes('npx vitest run test/provenance_parity.test.ts')),
);

testcase(
  'тесты маркировки замечают экран, забывший пометить чужой файл',
  'метка, которую надо не забыть поставить на новом экране, однажды не ' +
  'ставится — и это ничем себя не проявит: картинка отрисуется, тесты ' +
  'пройдут, экран будет выглядеть готовым. Обход по всему src — ' +
  'единственное, что делает слово «ко всему» проверяемым',
  () => withBroken('src/screens/LeagueTableScreen.tsx',
    (s) => s.replace('\n                                 {...provenanceAttrs({ url: r.crest_url })} />',
                     ' />  {/* СЛОМАНО */}'),
    () => !passes('npx vitest run test/provenance_coverage.test.ts')),
);

testcase(
  'тесты маркировки замечают метку, одинаковую для всех',
  'если незнакомый хост начнёт получать метку-заглушку вместо пустоты, ' +
  'чужое спрячется под своим — ровно то, против чего вся эта работа. ' +
  'И проверка «метка есть» при этом зеленела бы',
  () => withBroken('src/shared/lib/provenance.ts',
    (s) => s.replace('  return HOST_SOURCE[host] ?? null;',
                     "  return HOST_SOURCE[host] ?? 'own';  // СЛОМАНО"),
    () => !passes('npx vitest run src/shared/ui/PlayerPhoto.test.tsx')),
);

testcase(
  'тесты дизайна замечают нечитаемый текст на бумаге',
  'в переданном макете стояло «--brand-muted #8C8275 — 4.6:1 на #F2EADB»; ' +
  'пересчёт дал 3.16, то есть вторичный текст на кремовом не дотягивал до ' +
  'AA. Число в комментарии не проверяет себя само — проверяет только мера',
  () => withBroken('src/index.css',
    (s) => s.replace('    --brand-muted:        90 82 70;    /* #5A5246',
                     '    --brand-muted:       140 130 117;  /* СЛОМАНО #8C8275'),
    () => !passes('npx vitest run test/design_paper.test.ts')),
);

testcase(
  'тесты дизайна замечают фон, прибитый к тёмному',
  'у body рядом стоит `bg-brand-bg`, который читает токен и даёт кремовый, ' +
  'но встроенный `style="background: #0a0e1a"` перебивает его по правилам ' +
  'каскада. Обе строки выглядят осмысленно порознь, и заметить это можно ' +
  'было только замером computed-стиля в браузере',
  () => withBroken('index.html',
    (s) => s.replace('style="background: var(--splash-bg, #0a0e1a); margin: 0"',
                     'style="background: #0a0e1a; margin: 0"  /* СЛОМАНО */'),
    () => !passes('npx vitest run test/design_paper.test.ts')),
);

// ---------------------------------------------------------------------------
testcase(
  'тесты сборных замечают включённую обратно Лигу наций УЕФА',
  'её расписание ведёт платный провайдер под своими идентификаторами; ESPN ' +
  'отдаст те же матчи под своими, с приставкой espn:, и в календаре встанут ' +
  'две строки на одну игру. Заметить это можно только глазами — обе строки ' +
  'выглядят правильными',
  () => withBroken('supabase/migrations/national_fixtures.sql',
    (s) => s.replace("'Лига наций УЕФА', false,", "'Лига наций УЕФА', true,"),
    () => !passes('npx vitest run test/national_fixtures.test.ts')),
);

// ---------------------------------------------------------------------------
testcase(
  'тесты сборных замечают турнир, забытый в одной локали',
  'реестр турниров живёт в базе, имена — в девяти файлах, и разойтись им ' +
  'ничто не мешает. Забытый ключ не падает и не логируется: он выходит на ' +
  'экран как «Concacaf Gold Cup» посреди корейского списка',
  () => withBroken('src/shared/i18n/locales/ja.json',
    (s) => {
      const d = JSON.parse(s);
      delete d.leagues.soccer_concacaf_gold_cup;
      return JSON.stringify(d, null, 2) + '\n';
    },
    () => !passes('npx vitest run test/national_fixtures.test.ts')),
);

// ---------------------------------------------------------------------------
testcase(
  'тесты сборных замечают запрос без срока',
  'запрос без срока не падает — он висит, а висящий сборщик неотличим от ' +
  'работающего. Ровно так ночной обход шёл 3 ч 36 мин при бюджете 80 минут',
  () => withBroken('supabase/functions/football-national/index.ts',
    (s) => s.replace('          signal: AbortSignal.timeout(REQUEST_MS),\n', ''),
    () => !passes('npx vitest run test/national_fixtures.test.ts')),
);

// ---------------------------------------------------------------------------
testcase(
  'тесты сборных замечают дешёвый режим, ставший дорогим',
  'режим scores зовётся каждые пять минут. Подменить ему реестр на полный — ' +
  'значит обходить все турниры за три месяца 288 раз в сутки: 11 232 запроса ' +
  'к чужому бесплатному адресу вместо пары десятков',
  () => withBroken('supabase/functions/football-national/index.ts',
    (s) => s.replace('mode === "scores" ? "national_leagues_in_play" : "espn_national_leagues"',
                     '"espn_national_leagues"'),
    () => !passes('npx vitest run test/national_fixtures.test.ts')),
);

// ---------------------------------------------------------------------------
testcase(
  'тесты сборных замечают снятую заслонку перед вызовом',
  'без проверки окна задание поднимало бы Edge-функцию 288 раз в сутки ради ' +
  'ответа «матчей нет». Стоимость видна только в счёте за месяц',
  () => withBroken('supabase/migrations/schedule_national_fixtures.sql',
    (s) => s.replace("  if p_mode = 'scores' then", "  if false then"),
    () => !passes('npx vitest run test/national_fixtures.test.ts')),
);

// ---------------------------------------------------------------------------
testcase(
  'тесты сборных замечают турнир, выпавший из KNOWN_SPORT_KEYS',
  'без записи имя турнира уходит в readableSportKey — «Fifa World Cup ' +
  'Qualifiers Africa» посреди списка матчей. Это не ошибка, это просто уродливо, ' +
  'и поэтому её никто не чинит годами',
  () => withBroken('src/features/fixtures/leagues.ts',
    (s) => s.replace("  'soccer_international_friendlies',\n", ''),
    () => !passes('npx vitest run test/national_fixtures.test.ts')),
);

// ---------------------------------------------------------------------------
// Дерево обязано быть чистым: иначе восстановление затрёт чужие правки.
const dirty = execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
if (dirty) {
  console.error('Рабочее дерево не чистое — скрипт ломает файлы и возвращает их обратно,');
  console.error('и на грязном дереве это опасно. Закоммитьте или спрячьте изменения.\n');
  console.error(dirty.split('\n').slice(0, 10).join('\n'));
  process.exit(2);
}

console.log('\nПроверка проверок: способна ли каждая упасть, если её сломать\n');

const vacuous = [];
for (const c of CASES) {
  process.stdout.write(`  … ${c.name}`);
  let caught = false;
  try {
    caught = c.fn();
  } catch (e) {
    console.log(`\r  ! ${c.name} — сам прогон упал: ${String(e).slice(0, 60)}`);
    vacuous.push(c);
    continue;
  }
  console.log(`\r  ${caught ? '✓' : '✗'} ${c.name}${caught ? '' : '  — ПУСТАЯ'}`);
  if (!caught) vacuous.push(c);
}

// Восстановление могло не сработать — убеждаемся, что дерево снова чистое.
const after = execSync('git status --porcelain', { encoding: 'utf-8' }).trim();
console.log('');
if (after) {
  console.error('⚠ ФАЙЛЫ НЕ ВОССТАНОВЛЕНЫ. Проверьте и откатите вручную:\n' + after);
  process.exit(2);
}

if (vacuous.length === 0) {
  console.log('✓ все проверки краснеют, когда их ломают — им можно верить');
  process.exit(0);
}

console.error(`✗ ПУСТЫХ ПРОВЕРОК: ${vacuous.length}. Зелень от них ничего не значит.\n`);
for (const c of vacuous) console.error(`  ${c.name}\n    ${c.why}`);
process.exit(1);
