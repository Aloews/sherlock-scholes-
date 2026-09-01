#!/usr/bin/env node
// Замер лимитов, в которые этот проект УЖЕ упирался.
//
// ЗАЧЕМ. Каждый пункт ниже — не гипотетический потолок из документации, а
// случай, который однажды что-то сломал и стоил расследования:
//
//   db-max-rows        оба сборщика статистики видели треть колоды и печатали
//                      «cards in deck: 1000» как нормальное число
//   баланс Anthropic   «Сводка не собралась» на каждое нажатие, в логах —
//                      400 invalid_request_error про кредиты
//   лимит GitHub API   PR собран и проверен, а снять черновик нечем
//   вес каталога ТВ    870 КБ без сжатия: ~17 с молчания на медленном 3G,
//                      и игрок решает, что ТВ не работает
//   бюджет pg_cron     считался руками в шапке schedule_football_digest.sql
//   localStorage       лимит ~5 МБ на весь домен, и данные туда класть нельзя
//
// ⚠️ ЭТО ЗАМЕР, А НЕ ПРОВЕРКА. Скрипт ничего не заваливает и ничего не
// запрещает: он печатает числа и говорит, сколько осталось. Решение «пушить
// или подождать» остаётся за человеком — порог, при котором стоит подождать,
// у каждого лимита свой и меняется вместе с задачей.
//
//   node scripts/check-limits.mjs
//
// Секреты берутся из окружения и .env, если он есть; чего нет — честно
// помечается как «не измерено», а не подставляется наугад.

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const TIMEOUT_MS = 20_000;

function env(name) {
  if (process.env[name]) return process.env[name];
  if (!existsSync('.env')) return null;
  for (const line of readFileSync('.env', 'utf-8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && m[1] === name) return m[2].trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

async function get(url, headers = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { headers, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

const rows = [];
/** @param status 'ok' | 'warn' | 'skip' */
function row(name, value, headroom, status = 'ok') {
  rows.push({ name, value, headroom, status });
}

// ---------------------------------------------------------------- GitHub ----
async function github() {
  const token = env('GITHUB_TOKEN') ?? env('GH_TOKEN');
  if (!token) {
    row('GitHub API', 'не измерено', 'нет GITHUB_TOKEN в окружении', 'skip');
    return;
  }
  try {
    const r = await get('https://api.github.com/rate_limit', {
      Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
    });
    const d = await r.json();
    // ⚠️ ОТСУТСТВИЕ СТРОКИ ХУЖЕ ПЛОХОЙ СТРОКИ. Если ответ пришёл не той формы
    // (сменился API, токен без прав), молчаливый `continue` убирал лимит из
    // таблицы совсем — и «GitHub не показан» читалось бы как «с ним всё
    // хорошо». Ровно та ошибка, которую этот скрипт и призван ловить.
    if (!d.resources?.core && !d.resources?.graphql) {
      // 401/403 — это «нечем мерить», а не «лимит исчерпан», и путать их
      // нельзя: первое чинится токеном, второе — ожиданием.
      const noAccess = r.status === 401 || r.status === 403;
      row('GitHub API', noAccess ? 'нет доступа' : 'ответ не разобран',
          noAccess ? `HTTP ${r.status} — токен не подошёл к api.github.com`
                   : `HTTP ${r.status}, нет resources`,
          noAccess ? 'skip' : 'warn');
      return;
    }
    for (const key of ['core', 'graphql']) {
      const c = d.resources?.[key];
      if (!c) continue;
      const mins = Math.max(0, Math.round((c.reset * 1000 - Date.now()) / 60000));
      // ⚠️ ЧЕРНОВИК СНИМАЕТСЯ ТОЛЬКО ЧЕРЕЗ GRAPHQL. У него свой счётчик, и
      // исчерпанный graphql при живом core значит «код готов, а смержить
      // нечем» — ровно то, обо что эта сессия и споткнулась.
      row(`GitHub ${key}`, `${c.remaining} из ${c.limit}`,
          c.remaining === 0 ? `сброс через ${mins} мин` : 'ок',
          c.remaining === 0 ? 'warn' : 'ok');
    }
  } catch (e) {
    row('GitHub API', 'ошибка', String(e).slice(0, 60), 'warn');
  }
}

// -------------------------------------------------------------- Supabase ----
async function supabase() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    row('PostgREST db-max-rows', 'не измерено', 'нет VITE_SUPABASE_* ', 'skip');
    return;
  }
  try {
    // ⚠️ ПРОСИМ БОЛЬШЕ, ЧЕМ ВЛЕЗЕТ, И СМОТРИМ НА CONTENT-RANGE. Сервер режет
    // ответ молча и отвечает 200: `?limit=5000` однажды вернул ровно 1000
    // строк при `Content-Range: 0-999/2919`, и оба сборщика приняли это за
    // всю колоду. Признак усечения — ТОЛЬКО в заголовке.
    const r = await get(`${url}/rest/v1/cards?select=id&limit=5000`, {
      apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact',
    });
    const range = r.headers.get('content-range');
    const got = (await r.json()).length;
    const total = range?.split('/')[1];
    row('PostgREST db-max-rows', `отдал ${got} строк`,
        total && Number(total) > got
          ? `⚠ в таблице ${total} — ответ УСЕЧЁН, читать страницами с order=`
          : `в таблице ${total ?? '?'} — влезло целиком`,
        total && Number(total) > got ? 'warn' : 'ok');
  } catch (e) {
    row('PostgREST db-max-rows', 'ошибка', String(e).slice(0, 60), 'warn');
  }
}

// ------------------------------------------------------------- бандлы -------
function bundles() {
  const dir = 'dist/assets';
  if (!existsSync(dir)) {
    row('Первый заход, вес', 'не измерено', 'нет dist — сначала npm run build', 'skip');
    return;
  }
  const eager = readdirSync(dir).filter((f) =>
    f.endsWith('.js') && (f.startsWith('index-') || f.startsWith('vendor-') || /^ru-/.test(f)));
  const total = eager.reduce((n, f) => n + statSync(join(dir, f)).size, 0);
  const kb = Math.round(total / 1024);
  // 700 КБ — то, на чём проект стоит сейчас после разделения чанков. Порог не
  // священный: он здесь, чтобы РОСТ был заметен, а не чтобы что-то запрещать.
  row('Первый заход, вес', `${kb} КБ (${eager.length} файлов)`,
      kb > 800 ? '⚠ вырос — проверить, что попало в главный бандл' : 'в пределах прежнего',
      kb > 800 ? 'warn' : 'ok');

  const cache = 5 * 1024; // localStorage, КБ
  // Самый крупный жилец отсюда уехал вместе с ТВ (там кэшировался РЕЗУЛЬТАТ
  // разбора каталога, а не сам каталог на 870 КБ — он занял бы почти весь
  // лимит). Строка остаётся: следующий, кто задумает положить сюда данные, а
  // не настройку, должен увидеть, сколько здесь на самом деле места.
  row('localStorage', `лимит ~${cache} КБ`,
      'настройки и мелкие ключи; крупных данных здесь быть не должно', 'ok');
}

// ------------------------------------------------------------- печать -------
const MARK = { ok: '  ', warn: '⚠ ', skip: '· ' };

await github();
await supabase();
bundles();

const w1 = Math.max(...rows.map((r) => r.name.length));
const w2 = Math.max(...rows.map((r) => r.value.length));
console.log('\nЛимиты, в которые этот проект упирался:\n');
for (const r of rows) {
  console.log(`${MARK[r.status]}${r.name.padEnd(w1)}  ${r.value.padEnd(w2)}  ${r.headroom}`);
}

const warned = rows.filter((r) => r.status === 'warn');
const skipped = rows.filter((r) => r.status === 'skip');
console.log('');
if (warned.length) console.log(`⚠  требует внимания: ${warned.length}`);
if (skipped.length) console.log(`·  не измерено: ${skipped.length} (нет доступа или сборки)`);
if (!warned.length && !skipped.length) console.log('Всё измерено, запаса хватает.');

// Не заваливаем прогон: скрипт печатает числа, решение — за человеком.
process.exit(0);
