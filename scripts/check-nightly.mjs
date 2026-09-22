#!/usr/bin/env node
// ОТРАБОТАЛ ЛИ НОЧНОЙ ОБХОД — ПО ДАННЫМ, А НЕ ПО ЛОГУ.
//
// ⚠️ ЗАЧЕМ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ — прочитайте, прежде чем менять пороги.
//
// Ночной обход дважды терял вторую половину себя, и оба раза это НЕ БЫЛО
// ВИДНО НИОТКУДА:
//
//   12–21.09.2026  десять прогонов подряд помечены «cancelled» — читается как
//                  «кто-то отменил вручную». Первый шаг забирал весь job,
//                  runner получал SIGTERM, и 21 шаг из 28 не запускался.
//   22.09.2026     починка ограничила шаг сроком в 80 минут — и первый шаг
//                  всё равно шёл 3 ч 36 мин, потому что срок проверялся
//                  ПЕРЕД шагом и не мог прервать уже идущий.
//
// Общего у обоих случаев одно: прогон не был красным ни разу. Зато данные
// говорили прямо (замер 22.09.2026 09:37 UTC):
//
//   club_crest              02.09   — 20 суток
//   cards.market_value_at   06.09   — 16 суток
//   club_roster             07.09   — 15 суток
//   soccerwiki_player       08.09   — 14 суток
//   player_transfer         08.09   — 14 суток
//
// Две недели без половины конвейера, и узнал об этом человек, а не проверка.
//
// ПОЭТОМУ ЗДЕСЬ СМОТРЯТ НА РЕЗУЛЬТАТ, А НЕ НА ХОД. Шаг мог отработать, упасть,
// быть убитым по сроку или не запуститься вовсе — таблице всё равно: либо в
// неё сегодня писали, либо нет.
//
//   node scripts/check-nightly.mjs
//
// Выход: 0 — обход доходит до конца; 1 — какая-то его часть молчит.

import { readFileSync, existsSync } from 'node:fs';

const TIMEOUT_MS = 20_000;
const DAY = 86_400_000;

function env(name) {
  if (process.env[name]) return process.env[name];
  if (!existsSync('.env')) return null;
  for (const line of readFileSync('.env', 'utf-8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && m[1] === name) return m[2].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

// ⚠️ ГРАНИЦА «ВАЛИТЬ / ПЕЧАТАТЬ» ПРОВЕДЕНА ПО ОДНОМУ ПРИЗНАКУ: есть ли у шага
// работа КАЖДУЮ ночь. У дозовых шагов (обойти клубы, обновить старше срока)
// работа есть всегда, поэтому их таблица обязана двигаться — молчание значит
// поломку. У остальных молчание бывает законным: эмблемы собраны все, цена на
// Transfermarkt не менялась. Такое число печатается, но ничего не заваливает —
// иначе проверка научилась бы краснеть на здоровом конвейере, и её отключили
// бы первой.
const ROWS = [
  { table: 'club_roster', column: 'fetched_at', days: 3, gate: true,
    what: 'Заявки клубов (Transfermarkt)',
    why: 'шаг обходит клубы дозой — работа есть каждую ночь' },
  { table: 'soccerwiki_player', column: 'fetched_at', days: 3, gate: true,
    what: 'Карточки игроков Soccer Wiki',
    why: 'обход мира со сроком годности 7 суток — работа есть каждую ночь' },
  { table: 'player_transfer', column: 'fetched_at', days: 4, gate: true,
    what: 'История переходов',
    why: 'доза «новые + старше квартала» — пустой она не бывает' },
  { table: 'club_crest', column: 'fetched_at', days: null, gate: false,
    what: 'Эмблемы клубов (ESPN)',
    why: 'молчит законно, когда все эмблемы уже собраны' },
  { table: 'cards', column: 'market_value_at', days: null, gate: false,
    what: 'Стоимости игроков',
    why: 'дата ставится источником, а не нами' },
  { table: 'club_squad', column: 'fetched_at', days: null, gate: false,
    what: 'Составы (Викиданные)',
    why: 'двигает pg_cron, а не этот обход' },
];

async function latest(url, key, table, column) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(
      `${url}/rest/v1/${table}?select=${column}&${column}=not.is.null`
      + `&order=${column}.desc&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: ac.signal });
    if (!r.ok) return { error: `HTTP ${r.status}` };
    const rows = await r.json().catch(() => []);
    const raw = rows[0]?.[column] ?? null;
    return raw ? { at: new Date(raw) } : { error: 'таблица пуста' };
  } catch (e) {
    return { error: String(e).slice(0, 60) };
  } finally {
    clearTimeout(t);
  }
}

const url = env('VITE_SUPABASE_URL') || env('SUPABASE_URL');
const key = env('SUPABASE_SERVICE_KEY') || env('SUPABASE_KEY');
if (!url || !key) {
  console.error('✗ нет SUPABASE_URL / SUPABASE_KEY — проверять нечем');
  process.exit(1);
}

const now = Date.now();
const measured = [];
let failed = 0;

console.log('Ночной обход — по свежести того, что он наполняет\n');
for (const row of ROWS) {
  const got = await latest(url, key, row.table, row.column);
  if (got.error) {
    // ⚠️ НЕДОСТУПНАЯ ТАБЛИЦА — ЭТО «НЕ ИЗМЕРЕНО», А НЕ «УСТАРЕЛО», и путать
    // их нельзя. У части таблиц грантов нет вовсе (так заперт `club_crest`,
    // так же заперт `fixture_odds`), и красный крест на них читался бы как
    // поломка обхода. Заваливает прогон только недоступность той таблицы,
    // по которой мы СУДИМ.
    console.log(`${row.gate ? '✗' : '·'} ${row.what.padEnd(34)} не измерено: ${got.error}`);
    if (row.gate) failed++;
    continue;
  }
  const age = (now - got.at.getTime()) / DAY;
  measured.push({ row, age });
  const stale = row.gate && age > row.days;
  if (stale) failed++;
  const when = got.at.toISOString().slice(0, 16).replace('T', ' ');
  const mark = !row.gate ? '·' : stale ? '✗' : '✓';
  const limit = row.gate ? `порог ${row.days} сут` : 'не заваливает';
  console.log(`${mark} ${row.what.padEnd(34)} ${when}  ${age.toFixed(1)} сут  (${limit})`);
  if (stale) console.log(`  ${' '.repeat(34)} ⛔ ${row.why}`);
}

// ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ. Сравнение числа с числом молча перестаёт работать,
// если замер сломан: даты не разобрались, список пуст, знак перевёрнут. Тот же
// замер с заведомо недостижимым порогом ОБЯЗАН назвать свежую таблицу
// устаревшей. Не назвал — зелень выше ничего не стоит.
const control = measured.filter((m) => m.row.gate);
const catches = control.length > 0 && control.every((m) => Number.isFinite(m.age))
                && control.some((m) => m.age > 0);
console.log('');
console.log(`${catches ? '✓' : '✗'} контроль: тот же замер с порогом 0 сут `
            + (catches ? 'поймал бы все три таблицы' : 'НЕ СРАБОТАЛ — замер сломан'));
if (!catches) failed++;

console.log('');
if (failed) {
  console.log(`✗ обход не доходит до конца: ${failed} признак(ов).`);
  console.log('  Смотреть надо в шаг «Run daily enrichment» последнего прогона:');
  console.log('  строки «>>> STEP …» и «<<< STEP … -> exit N за M мин».');
  process.exit(1);
}
console.log('✓ обход доходит до конца — все дозовые таблицы обновлялись вовремя');
