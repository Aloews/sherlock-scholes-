#!/usr/bin/env node
// Проверка ПРОДА. Ни одного мока, ни одного стенда.
//
// ⚠️ ЗАЧЕМ ЭТОТ ФАЙЛ СУЩЕСТВУЕТ — прочитайте, прежде чем что-то тут менять.
//
// В проекте 848 юнит-тестов, и они были зелёными ровно тогда, когда владелец
// присылал скриншоты со сломанным ТВ. Так вышло не потому, что тесты плохие, а
// потому, что они проверяли НЕ ТО: каждый из них гонял мой код против моего же
// стенда. Плейлист был подделан, ответы каналов подделаны, сегменты подделаны.
// Такой тест не может упасть по той причине, по которой ломается приложение, —
// он и не падал.
//
// Хуже: «проверка» вручную останавливалась на первом манифесте. Канал отдал
// 200 — значит работает. А ниже первого уровня лежало вот это (замер
// 25.08.2026, боевой каталог):
//
//   Матч! Премьер        master -> variant -> сегмент 1.3 МБ    ЖИВОЙ
//   Setanta Sports 1 HD  master 200 -> variant 404              МЁРТВЫЙ
//   Setanta Sports 2 HD  master 200 -> variant не отвечает      МЁРТВЫЙ
//
// Setanta стояли вторым и третьим в списке. Верхний манифест у них отвечает
// 200, и любая проверка, которая на нём останавливается, называет их живыми.
//
// ПОЭТОМУ ЗДЕСЬ ДВА ПРАВИЛА, И ОНИ НЕ ОБСУЖДАЮТСЯ:
//
//   1. Проверка идёт до КОНЦА цепочки — до байтов видео, а не до кода 200.
//   2. У каждой проверки есть ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: та же проверка,
//      направленная на заведомо сломанное, ОБЯЗАНА упасть. Если не упала —
//      проверка ничего не проверяет, и скрипт называет её ПУСТОЙ. Зелёная
//      пустая проверка хуже красной: она врёт с уверенностью.
//
//   node scripts/check-prod.mjs
//
// Выход: 0 — всё живо и все проверки не пусты; 1 — есть падение или пустая.

import { readFileSync, existsSync } from 'node:fs';

const APP = process.env.PROD_APP_URL ?? 'https://sherlock-scholes.vercel.app';
const TIMEOUT_MS = 25_000;

// Ключи берём из окружения, а при его отсутствии — из .env. Без этого
// проверка дайджеста молча превращалась в «не измерено», то есть в ту самую
// пустую зелень, против которой весь этот файл и написан.
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
    return await fetch(url, { headers, signal: ac.signal, redirect: 'follow' });
  } finally {
    clearTimeout(t);
  }
}

/** Первая строка манифеста, которая не комментарий и не пустая. */
function firstChild(text) {
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (l && !l.startsWith('#')) return l;
  }
  return null;
}

function resolve(parentUrl, child) {
  if (child.startsWith('http')) return child;
  const u = new URL(parentUrl);
  if (child.startsWith('/')) return `${u.origin}${child}`;
  return `${u.origin}${u.pathname.replace(/\/[^/]*$/, '')}/${child}`;
}

/**
 * Пройти HLS-цепочку до настоящих байтов видео.
 *
 * ⚠️ ИМЕННО ЭТО И БЫЛО ПРОПУЩЕНО. Останавливаться на первом манифесте нельзя:
 * у Setanta он отвечает 200, а вариант под ним — 404.
 *
 * `depth` — сколько уровней манифестов пройти. Три хватает: master -> variant
 * -> media, дальше идут сегменты.
 */
async function playableBytes(url, depth = 3) {
  let current = url;
  for (let level = 0; level < depth; level += 1) {
    let res;
    try {
      res = await get(current, { Origin: APP });
    } catch (e) {
      return { ok: false, why: `уровень ${level}: ${String(e).slice(0, 40)}` };
    }
    if (!res.ok) return { ok: false, why: `уровень ${level}: HTTP ${res.status}` };

    const body = await res.arrayBuffer();
    const head = new TextDecoder('utf-8', { fatal: false })
      .decode(body.slice(0, 8)).trimStart();

    // Не манифест — значит это уже медиа. Считаем байты: пустой «сегмент»
    // на 300 байт видео не несёт, и принимать его за успех нельзя.
    if (!head.startsWith('#EXTM3U')) {
      return body.byteLength > 50_000
        ? { ok: true, why: `${Math.round(body.byteLength / 1024)} КБ видео` }
        : { ok: false, why: `сегмент всего ${body.byteLength} байт` };
    }

    const text = new TextDecoder().decode(body);
    const child = firstChild(text);
    if (!child) return { ok: false, why: `уровень ${level}: манифест без ссылок` };
    current = resolve(current, child);
  }
  return { ok: false, why: `не дошли до медиа за ${depth} уровня` };
}

// ---------------------------------------------------------------------------
const results = [];
function record(name, ok, detail, control) {
  results.push({ name, ok, detail, control });
}

// -------------------------------------------------------------- дайджест ---
async function checkDigest() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Дайджест', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  // 1. Сводка — та самая кнопка, которая отвечает «Сводка не собралась».
  try {
    const r = await fetch(`${url}/functions/v1/digest-summary`, {
      method: 'POST', headers: auth, body: JSON.stringify({ lang: 'ru' }),
    });
    const body = await r.json().catch(() => ({}));
    const ok = r.ok && (body.status === 'ok' || body.status === 'no_topics');
    record('Дайджест: сводка', ok,
           ok ? `${body.status}${body.model ? ` (${body.model})` : ''}`
              : `HTTP ${r.status} ${body.error ?? ''}`.trim(),
           'ответ читается целиком, не по коду');
  } catch (e) {
    record('Дайджест: сводка', false, String(e).slice(0, 50), 'н/д');
  }

  // 2. Ролики — то, что на экране под сводкой.
  for (const [label, fn] of [['выходные', 'digest_weekend_goals'], ['неделя', 'digest_week_goals']]) {
    try {
      const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: 'POST', headers: auth, body: JSON.stringify({ p_limit: 40 }),
      });
      const rows = await r.json().catch(() => null);
      const n = Array.isArray(rows) ? rows.length : -1;
      record(`Дайджест: голы (${label})`, n > 0,
             n >= 0 ? `${n} роликов` : `HTTP ${r.status}`,
             'считаем строки, а не код ответа');
    } catch (e) {
      record(`Дайджест: голы (${label})`, false, String(e).slice(0, 50), 'н/д');
    }
  }
}

// --------------------------------------------------- RPC анонимным ключом ---
// ⚠️ ЭТОЙ ПРОВЕРКИ ЗДЕСЬ НЕ БЫЛО, И ИМЕННО ПОЭТОМУ ДВЕ ПОЛОМКИ ЖИЛИ В ПРОДЕ.
//
// Обе не видны ниоткуда, кроме анонимного ключа — того самого, что зашит в
// бандл и которым ходит браузер игрока (замер 03.09.2026):
//
//   fixture_team_rating   через админа 41 строка за 4.7 с, через anon — 57014
//                         «canceling statement due to statement timeout».
//                         У anon лимит 3 с. Рейтинг состава не отдавался
//                         НИ РАЗУ, никому. Лечится MATERIALIZED в CTE.
//   arena_leaderboard     42501 «permission denied for table arena_result».
//                         Таблица заперта нарочно, грант на вызов есть, а сама
//                         функция шла от вызывающего: забыли SECURITY DEFINER.
//
// В обоих случаях psql, MCP и любая проверка «под сервисным ключом» показывают
// зелень. Поэтому ходить надо ИМЕННО anon-ключом и ИМЕННО до строк.
const RPCS = [
  ['fixture_team_rating',    { p_min_depth: 5 },              'рейтинг состава в прогнозах'],
  ['fixture_squad_strength', { p_min_depth: 5 },              'известность состава'],
  ['recent_transfers',       { p_days: 45, p_lang: 'ru' },    'лента трансферов'],
  ['arena_leaderboard',      { p_days: 30, p_limit: 20 },     'таблица рекордов арены'],
  ['digest_news',            {},                              'лента новостей'],
];

async function checkAnonRpc() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('RPC под anon', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  for (const [fn, args, label] of RPCS) {
    try {
      const t0 = Date.now();
      const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: 'POST', headers: auth, body: JSON.stringify(args),
      });
      const ms = Date.now() - t0;
      const body = await r.json().catch(() => null);
      // arena_leaderboard законно пуста, когда за окно не было матчей, поэтому
      // здесь мерим НЕ количество строк, а «вернулся массив, а не код ошибки».
      const ok = r.ok && Array.isArray(body);
      const why = ok ? `${body.length} строк, ${ms} мс`
                     : `${body?.code ?? 'HTTP ' + r.status} ${body?.message ?? ''}`.trim().slice(0, 60);
      record(`RPC anon: ${label}`, ok, why, 'ключ anon, не сервисный; ошибка читается из тела');
    } catch (e) {
      record(`RPC anon: ${label}`, false, String(e).slice(0, 50), 'н/д');
    }
  }

  // ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ. Ровно тот же запрос к заведомо запертой таблице:
  // он ОБЯЗАН получить отказ. Если и он проходит — значит anon-ключ на этом
  // проекте видит всё подряд, и вся проверка выше ничего не стоит.
  let denied = false;
  try {
    const r = await fetch(`${url}/rest/v1/arena_result?select=*&limit=1`, { headers: auth });
    denied = r.status === 401 || r.status === 403 || r.status === 404;
    if (!denied) {
      const b = await r.json().catch(() => null);
      denied = b?.code === '42501';
    }
  } catch { denied = false; }
  record('RPC anon: контроль запертой таблицы', denied,
         denied ? 'arena_result закрыта, как и должна' : 'arena_result ОТКРЫТА anon-ключу',
         denied ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

// ------------------------------------------------ счёт в сводке (запрещён) ---
// ⚠️ ВЛАДЕЛЕЦ: «счета не пиши никогда». Это проверяется здесь, на ЖИВОЙ сводке,
// а не только запретом в подсказке — потому что подсказка уже один раз не
// удержала: модель дописала «Челси обыграл Реал Сосьедад 1:0», матч, которого
// в её данных не было вовсе.
//
// Шаблон тот же, что в самой функции: одна цифра, разделитель, одна цифра, на
// границах слова. «19:00» и «2024–2025» им не ловятся — и это проверено
// отрицательным контролем ниже, иначе проверка падала бы на времени начала
// матча и называла бы поломкой исправный текст.
const SCORE_RE = () => /\s*(?:со\s+сч[её]том\s*)?\b\d\s*[:\-–]\s*\d\b/;

async function checkNoScores() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Сводка: без счёта', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  try {
    const r = await fetch(`${url}/functions/v1/digest-summary`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ lang: 'ru' }),
    });
    const body = await r.json().catch(() => ({}));
    const text = body.summary ?? '';
    if (!text) {
      record('Сводка: без счёта', false,
             `нечего проверять: ${body.status ?? body.error ?? 'пустой ответ'}`, 'н/д');
      return;
    }
    const hit = SCORE_RE().exec(text);
    record('Сводка: без счёта', hit === null,
           hit === null ? `${text.length} символов, счёта нет`
                        : `НАЙДЕН СЧЁТ «${hit[0].trim()}»`,
           'проверяется живой текст, а не подсказка');
  } catch (e) {
    record('Сводка: без счёта', false, String(e).slice(0, 50), 'н/д');
  }

  // ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ, ДВУСТОРОННИЙ. Шаблон обязан ловить настоящий счёт
  // и обязан НЕ ловить время начала матча — пустая проверка получилась бы и
  // из «никогда не срабатывает», и из «срабатывает всегда».
  const ловит = SCORE_RE().test('«Челси» обыграл «Реал Сосьедад» 1:0 и вышел дальше');
  const щадит = !SCORE_RE().test('Матч начнётся в 19:00, сезон 2024–2025');
  record('Сводка: контроль шаблона счёта', ловит && щадит,
         `${ловит ? 'ловит счёт' : 'НЕ ЛОВИТ СЧЁТ'}, ${щадит ? 'не трогает время' : 'ЛОМАЕТ ВРЕМЯ'}`,
         ловит && щадит ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

// ------------------------------------------------------------- бандл --------
async function checkBundle() {
  try {
    const r = await get(APP);
    const html = await r.text();
    const main = /\/assets\/index-[^"]+\.js/.exec(html)?.[0];
    if (!main) { record('Прод: бандл', false, 'не найден index-*.js', 'н/д'); return; }
    const js = await (await get(APP + main)).text();
    // ⚠️ МИШЕНЬ СМЕНИЛАСЬ ВМЕСТЕ С ПЕРЕЕЗДОМ ТВ. Раньше здесь искался чанк
    // `StreamScreen-*.js` и ключ кэша каталога `ss_tv_channels`; экран уехал в
    // Aloews/sherlock-tv, и проверка стала бы падать на «нет чанка ТВ» — то
    // есть краснеть на исправном проде. Теперь она смотрит на кабинет: он
    // ленивый чанк, как и был ТВ, и его ключ пароля так же однозначен.
    const chunk = /AdminScreen-[A-Za-z0-9_-]+\.js/.exec(js)?.[0];
    if (!chunk) { record('Прод: бандл', false, 'нет чанка кабинета', 'н/д'); return; }
    const lazy = await (await get(`${APP}/assets/${chunk}`)).text();

    // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: строки, которой в бандле быть НЕ МОЖЕТ,
    // поиск обязан не найти. Иначе он «находит» что угодно.
    const has = (s) => lazy.includes(s);
    const controlWorks = !has('заведомо-отсутствующая-строка-контроля');

    record('Прод: ленивые чанки выкачены', has('ss_admin_pw'), chunk,
           controlWorks ? 'контроль не нашёл несуществующее' : '⚠ КОНТРОЛЬ НАШЁЛ ЧУШЬ');
  } catch (e) {
    record('Прод: бандл', false, String(e).slice(0, 50), 'н/д');
  }
}

// ------------------------------------------------------- эмблемы клубов ---
// ⚠️ ССЫЛКА НА ГЕРБ — ЭТО ЕЩЁ НЕ ГЕРБ, и здесь это уже стоило владельцу
// скриншота. В справочнике у «Зенита» лежал верный герб с ESPN, а в карточке —
// диаграмма астрономического зенита: два хранилища одного факта разошлись
// молча, и запрос к справочнику отвечал 200 над сломанной колодой. Ровно тот
// же силуэт ошибки, что у ТВ, где мастер-манифест отвечал 200, а вариант 404.
//
// Поэтому проверка идёт до БАЙТОВ картинки: код 200 над `text/html` в один
// байт — это ровно то, чем ESPN отвечает на несуществующий id.
const IMG_MAGIC = [
  ['89504e47', 'PNG'], ['ffd8ff', 'JPEG'], ['47494638', 'GIF'], ['52494646', 'WEBP'],
];

async function realImage(url) {
  let res;
  try {
    res = await get(url);
  } catch (e) {
    return { ok: false, why: String(e).slice(0, 40) };
  }
  if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
  const buf = new Uint8Array(await res.arrayBuffer());
  const head = [...buf.slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const kind = IMG_MAGIC.find(([m]) => head.startsWith(m))?.[1]
    ?? (new TextDecoder().decode(buf.slice(0, 200)).includes('<svg') ? 'SVG' : null);
  if (!kind) return { ok: false, why: `не картинка: ${head} (${buf.byteLength} б)` };
  // Пустая заглушка в пару сотен байт гербом не является.
  if (buf.byteLength < 2_000) return { ok: false, why: `${kind}, но всего ${buf.byteLength} б` };
  return { ok: true, why: `${kind}, ${Math.round(buf.byteLength / 1024)} КБ` };
}

async function checkClubCrests() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Эмблемы клубов', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  let rows = null;
  try {
    const r = await fetch(`${url}/rest/v1/rpc/club_directory`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ p_lang: 'ru', p_query: null, p_limit: 60 }),
    });
    rows = await r.json().catch(() => null);
    if (!r.ok || !Array.isArray(rows)) {
      record('Эмблемы клубов', false,
             `${rows?.code ?? 'HTTP ' + r.status} ${rows?.message ?? ''}`.trim().slice(0, 60), 'н/д');
      return;
    }
  } catch (e) {
    record('Эмблемы клубов', false, String(e).slice(0, 50), 'н/д');
    return;
  }

  const withCrest = rows.filter((c) => c.crest_url);
  const espn = withCrest.filter((c) => c.crest_url.includes('espncdn')).length;
  record('Эмблемы: справочник отдаёт гербы', withCrest.length > 0,
         `${withCrest.length} из ${rows.length} клубов, с ESPN ${espn}`,
         'пустой список уронил бы проверку');

  // До байтов, а не до кода 200 — и у первых клубов экрана, а не у выбранных.
  let bad = null;
  for (const club of withCrest.slice(0, 6)) {
    const img = await realImage(club.crest_url);
    if (!img.ok) { bad = `${club.name}: ${img.why}`; break; }
  }
  record('Эмблемы: картинка выкачивается', !bad,
         bad ?? `${Math.min(withCrest.length, 6)} гербов — настоящие картинки`,
         'скачиваются байты, а не проверяется код ответа');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ. Тот же `realImage` на заведомо несуществующий
  // id ESPN ОБЯЗАН отказать: замер 04.09.2026 — 404, `text/html`, один байт.
  // Если и это сойдёт за герб, проверка выше не значит ничего.
  const control = await realImage('https://a.espncdn.com/i/teamlogos/soccer/500/999999999.png');
  record('Эмблемы: контроль битой ссылки', !control.ok,
         control.ok ? 'битая ссылка ПРИНЯТА за картинку' : `отвергнута: ${control.why}`,
         control.ok ? '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ' : 'проверка способна упасть');
}

// ------------------------------------------------------------- печать -------
console.log(`\nПроверка прода: ${APP}\n`);
await checkDigest();
await checkAnonRpc();
await checkNoScores();
await checkClubCrests();
await checkBundle();

const w = Math.max(...results.map((r) => r.name.length));
console.log('');
for (const r of results) {
  console.log(`${r.ok ? '✓' : '✗'} ${r.name.padEnd(w)}  ${r.detail}`);
  if (r.control.startsWith('⚠')) console.log(`  ${' '.repeat(w)}  ${r.control}`);
}

const failed = results.filter((r) => !r.ok);
const vacuous = results.filter((r) => r.control.startsWith('⚠'));
console.log('');
if (vacuous.length) console.log(`⚠  ПУСТЫХ ПРОВЕРОК: ${vacuous.length} — они не могут упасть, верить им нельзя`);
if (failed.length) console.log(`✗  падений: ${failed.length}`);
if (!failed.length && !vacuous.length) console.log('✓  всё живо, все проверки способны падать');

process.exit(failed.length || vacuous.length ? 1 : 0);
