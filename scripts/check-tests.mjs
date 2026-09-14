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
  'check-prod замечает мёртвый адрес',
  'проверка прода — единственная, способная упасть по той причине, по которой ' +
  'ломается приложение; если она зелёная на несуществующем хосте, она пустая',
  () => !passes('PROD_APP_URL=https://no-such-host.invalid node scripts/check-prod.mjs',
                120_000),
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
  'тесты скрапера замечают дыру в окне дат',
  'пропущенные сутки выглядят как сутки без матчей: обход не падает, а матчи ' +
  'за этот день просто не собираются никогда',
  () => withBroken('football_scraper/espn_stats.py',
    (s) => s.replace('        covered += span + 1', '        covered += span + 2'),
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
