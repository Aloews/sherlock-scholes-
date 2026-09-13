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
// отдельный репозиторий (Aloews/sherlock-tv), и вместе с ним уехали его
// проверки — а эти три пришлось перенацелить на код, который у игры ОСТАЛСЯ.
// Мишени выбраны не наугад: каждая — правило, на котором проект уже ломался, и
// каждая проверена вручную на то, что подмена действительно краснеет.

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
