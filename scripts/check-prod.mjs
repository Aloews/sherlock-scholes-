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
// UA с контактом, а не подделка под браузер: источник вправе знать, кто ходит.
const UA = 'sherlock-scholes-bot/1.0 (+https://github.com/Aloews/sherlock-scholes-)';

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

// -------------------------------------------- известность дома и в мире ---
// ⚠️ ЧТО ЗДЕСЬ ИДЁТ ДО КОНЦА ЦЕПОЧКИ. Наличие колонок `fame_home`/`fame_world`
// не значит ничего: они появились пустыми и такими бы и остались, если бы
// сбор просмотров не дошёл до языков, которых НЕТ среди девяти локалей
// интерфейса. Ради этого всё и делалось — замер 04.09.2026: у 1452 активных
// игроков из 2918 (49.8 %) не было ни одного просмотра на языке своей страны.
//
// Поэтому проверка спрашивает не «есть ли колонка», а «есть ли ДОМАШНЯЯ
// известность у игроков, чья страна читает НЕ на одном из девяти»: Турция,
// Польша, Сербия, Украина, Греция, Швеция, Норвегия, Дания, Нидерланды,
// Чехия. Ноль здесь — это ровно тот отказ, при котором фича мертва, а
// колонки на месте.
//
// И ходим боевым anon-ключом: у него лимит запроса 3 с, и две функции этого
// проекта уже работали под админом и падали у всех игроков.
const HOME_ONLY_COUNTRIES = ['TR', 'PL', 'RS', 'UA', 'GR', 'SE', 'NO', 'DK', 'NL', 'CZ'];

async function cardsWhere(url, auth, query) {
  const r = await fetch(`${url}/rest/v1/cards?${query}`, { headers: auth });
  const body = await r.json().catch(() => null);
  return { ok: r.ok, rows: Array.isArray(body) ? body : null, status: r.status };
}

async function checkFameAxes() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Известность дома и в мире', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}` };
  const inList = `(${HOME_ONLY_COUNTRIES.join(',')})`;

  // ⚠️ СПРАШИВАЕТСЯ СБОР, А НЕ РАНГ. Это две разные вещи, и путать их нельзя:
  // ранг «дома» считается ВНУТРИ языка и требует когорты (меньше десяти
  // соотечественников — перцентиль не считается, на двоих он выдаёт 0 и 100).
  // А вот собраны ли просмотры на языке страны — ровно то, что закрывает
  // ночной шаг, и ровно то, чего не было: до 04.09.2026 в pageviews_i18n не
  // существовало ни одного ключа `tr`, `pl`, `sv`, `da`, `uk`, `cs`.
  const t0 = Date.now();
  const langsByCountry = {
    TR: 'tr', PL: 'pl', RS: 'sr', UA: 'uk', GR: 'el',
    SE: 'sv', NO: 'no', DK: 'da', NL: 'nl', CZ: 'cs',
  };
  const collected = [];
  for (const [cc, lang] of Object.entries(langsByCountry)) {
    const r = await cardsWhere(url, auth,
      `select=name,country&category=eq.player&active=is.true`
      + `&country=eq.${cc}&pageviews_i18n=cs.{"${lang}":null}&limit=1`);
    // PostgREST не умеет «ключ существует» напрямую; спрашиваем через ->>
    const r2 = r.rows === null || r.rows.length === 0
      ? await cardsWhere(url, auth,
          `select=name,country&category=eq.player&active=is.true`
          + `&country=eq.${cc}&pageviews_i18n->>${lang}=not.is.null&limit=1`)
      : r;
    if (r2.rows && r2.rows.length) collected.push(`${cc}/${lang}`);
  }
  const ms = Date.now() - t0;
  record('Известность дома: собраны языки вне девяти локалей', collected.length > 0,
         collected.length
           ? `${collected.length} из 10 стран уже с домашним языком: ${collected.join(' ')}, ${ms} мс`
           : 'НИ ОДНОЙ — сбор не дошёл до этих языков, и мерить дома нечем',
         'спрашивается СБОР, а не ранг: ранг требует когорты в 10 соотечественников');

  // Две оси, которые всегда совпадают, — это одна ось под двумя именами.
  const apart = await cardsWhere(url, auth,
    `select=id,name,fame_home,fame_world&category=eq.player&active=is.true`
    + `&fame_home=not.is.null&fame_world=not.is.null&limit=200`);
  const differ = (apart.rows ?? []).filter(
    (c) => Math.abs((c.fame_home ?? 0) - (c.fame_world ?? 0)) >= 10).length;
  record('Известность: дома и в мире — РАЗНЫЕ величины', differ > 0,
         differ ? `${differ} из ${(apart.rows ?? []).length} расходятся на 10+ пунктов`
                : 'НИ ОДНОГО расхождения — значит это одна ось под двумя именами',
         'две одинаковые оси хуже одной: они обещают различение');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ. Тот же запрос по заведомо несуществующей
  // стране ОБЯЗАН вернуть пусто. Вернёт строки — фильтр не работает, и
  // проверка выше не значит ничего.
  const control = await cardsWhere(url, auth,
    `select=id&category=eq.player&active=is.true&country=eq.ZZ`
    + `&fame_home=not.is.null&limit=1`);
  const empty = control.ok && (control.rows ?? []).length === 0;
  record('Известность: контроль несуществующей страны', empty,
         empty ? 'по стране ZZ пусто, как и должно' : 'фильтр по стране НЕ работает',
         empty ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

// ------------------------------------------------- стоимость состава ------
// ⚠️ ЗАБЫТАЯ КОЛОНКА ПРИЕЗЖАЕТ КАК `undefined`, А `undefined !== null` ИСТИННО.
// Этот проект уже рисовал «undefined%» ровно так: колонку добавили в одну
// функцию из пары, которые клиент читает одним типом. Поэтому спрашивается не
// значение, а НАЛИЧИЕ ПОЛЯ в ответе club_profile.
async function checkClubValue() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Стоимость состава', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const t0 = Date.now();
  let row = null;
  try {
    const r = await fetch(`${url}/rest/v1/rpc/club_profile`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ p_club_key: 'real madrid', p_lang: 'ru' }),
    });
    const body = await r.json().catch(() => null);
    row = Array.isArray(body) ? body[0] : null;
  } catch (e) {
    record('Стоимость состава', false, String(e).slice(0, 50), 'н/д');
    return;
  }
  const ms = Date.now() - t0;
  const hasFields = row !== null
    && 'market_value_eur' in row && 'market_value_priced' in row;
  record('Стоимость состава: поля есть в ответе', hasFields,
         hasFields
           ? `priced ${row.market_value_priced} из ${row.squad}, ${ms} мс (anon)`
           : 'club_profile НЕ отдаёт market_value_* — колонка приедет undefined',
         'спрашивается наличие поля, а не значение');
  record('Стоимость состава: anon укладывается в 3 с', ms < 3000,
         `${ms} мс`, 'у anon лимит запроса 3 с; сервисный ключ этого не покажет');
}

// ------------------------------------------------- полный состав клуба ----
// ⚠️ ЗДЕСЬ ПРОВЕРЯЕТСЯ ПОЛНОТА, А НЕ НАЛИЧИЕ. «Состав есть» зеленело бы и на
// четырёх игроках из двадцати семи — а собирали мы его ровно затем, что
// прежний, из Викиданных, был неполным: 1362 строки на 294 клуба, полный
// состав у 42. Поэтому спрашивается число игроков и доля с ценой.
//
// И ходим боевым anon-ключом: у него лимит запроса 3 с.
async function checkClubRoster() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Полный состав клуба', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const call = async (name, body) => {
    const r = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: auth, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    return Array.isArray(j) ? j : null;
  };

  const t0 = Date.now();
  const rows = await call('club_roster_list', { p_club_key: 'real madrid' });
  const ms = Date.now() - t0;
  if (rows === null) {
    record('Полный состав клуба', false, 'club_roster_list не отвечает', 'ключ anon');
    return;
  }
  const priced = rows.filter((r) => r.market_value_eur != null).length;
  // Двадцать — заведомо ниже любой настоящей заявки (у «Реала» 27) и заведомо
  // выше того, что давал прежний путь.
  record('Полный состав: заявка целиком', rows.length >= 20,
         `${rows.length} игроков, ${priced} с ценой, ${ms} мс (anon)`,
         'спрашивается ЧИСЛО игроков: «состав есть» зеленело бы и на четырёх');

  // ⚠️ ЗДЕСЬ СТОЯЛА НЕВЕРНАЯ ПРОВЕРКА, И ОНА ЗЕЛЕНЕЛА НА ПОЛОМКЕ. Было
  // «есть игроки без карточки → состав шире колоды»: 4 из 27 у «Реала» —
  // выглядело подтверждением. На деле это была ДЫРА В СВЯЗЫВАНИИ: карточка
  // Беллингема есть, активная, с фото, он стоит в card_current_club у
  // «Реала» и, значит, в фэнтези, — просто ростер связывался только по
  // cards.transfermarkt_id, а его не было у 1783 активных карточек.
  // Проверка, которая радуется отсутствию связи, охраняет поломку.
  //
  // Спрашивать надо обратное: у клуба, оцифрованного полностью, состав
  // должен быть СВЯЗАН с колодой. Несвязанные там — настоящая молодёжь.
  const linked = rows.filter((r) => r.card_id != null).length;
  const share = rows.length ? linked / rows.length : 0;
  record('Полный состав: связан с колодой', share >= 0.8,
         `${linked} из ${rows.length} строк ведут на карточку`,
         'проверка ловит дыру в связывании, а не радуется ей');

  const val = await call('club_roster_value', { p_club_key: 'real madrid' });
  const v = (val && val[0]) || {};
  record('Полный состав: сумма едет с покрытием', 'priced' in v && 'squad' in v,
         'priced' in v ? `${v.priced} из ${v.squad}, ${Math.round((v.total_eur ?? 0) / 1e6)} млн €`
                       : 'club_roster_value не отдаёт покрытие',
         'сумма без знаменателя читается как «столько стоит клуб»');

  // ⚠️ ИГРОК НЕ МОЖЕТ БЫТЬ В ДВУХ ЗАЯВКАХ СРАЗУ, и это единственное, что
  // поймало «Страсбур → verein/631». Мост клуба строится голосованием
  // игроков, у «Страсбура» и «Челси» общий владелец, двое голосовавших уже
  // числились в «Челси» — и «Страсбур» получил заявку «Челси» целиком. 28
  // игроков, у всех цена, состав правдоподобный: ни одна проверка «есть ли
  // состав», «сходится ли сумма», «связан ли он с колодой» этого не видит.
  // Видно только пересечение: Палмер и Эстевао в двух клубах сразу.
  const keys = ['real madrid', 'chelsea', 'barcelona', 'bayern munich',
                'arsenal', 'liverpool'];
  const squads = {};
  for (const k of keys) {
    const r = await call('club_roster_list', { p_club_key: k });
    if (r && r.length) squads[k] = new Set(r.map((x) => x.tm_player_id));
  }
  const overlaps = [];
  const names = Object.keys(squads);
  for (let i = 0; i < names.length; i += 1) {
    for (let j = i + 1; j < names.length; j += 1) {
      const a = squads[names[i]];
      const b = squads[names[j]];
      const both = [...a].filter((x) => b.has(x));
      if (both.length) overlaps.push(`${names[i]} ∩ ${names[j]}: ${both.length}`);
    }
  }
  record('Полный состав: игрок не в двух заявках', overlaps.length === 0,
         overlaps.length ? overlaps.join('; ')
                         : `${names.length} заявок, пересечений нет`,
         'ловит мост, уехавший на чужой клуб; сумма и связь с колодой на нём зелены');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ к ней: заявка, пересечённая сама с собой,
  // обязана дать пересечение. Не дала — проверка сравнивает пустоту.
  const self = squads[names[0]] ? [...squads[names[0]]].filter(
    (x) => squads[names[0]].has(x)).length : 0;
  record('Полный состав: контроль пересечения', self > 0,
         self > 0 ? `заявка «${names[0] ?? '—'}» пересекается с собой на ${self}`
                  : 'сравнение не находит даже самого себя',
         self > 0 ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: у несуществующего клуба состава быть не может.
  const ghost = await call('club_roster_list', { p_club_key: 'клуб-которого-нет' });
  const empty = ghost !== null && ghost.length === 0;
  record('Полный состав: контроль несуществующего клуба', empty,
         empty ? 'пусто, как и должно' : 'состав нашёлся у выдуманного клуба',
         empty ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

// ---------------------------------------------------------------------------
// Счёт из ESPN: источник жив, и цепочка доходит ДО БАЗЫ, а не до кода 200.
//
// ⚠️ Этот путь бесплатен, и потому идёт раз в два часа. Платный (`/scores` у
// the-odds-api) стоит кредит за турнир при потолке 500 в месяц: там каждые
// два часа не «дороже», а невозможно — пять турниров по четыре захода в день
// дают 600 в месяц. Если ESPN отвалится, счёт молча перестанет обновляться, и
// увидеть это можно только отсюда.
// ---------------------------------------------------------------------------
async function checkEspnScores() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Счёт из ESPN', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }

  // 1. ИСТОЧНИК. Настоящий адрес, до разбора счёта, а не до кода 200.
  const board = (slug) =>
    `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard`;
  let games = 0;
  let scored = 0;
  try {
    const r = await fetch(board('eng.1'), { headers: { 'User-Agent': UA } });
    const d = await r.json();
    for (const ev of d.events ?? []) {
      const comp = (ev.competitions ?? [])[0];
      if (!comp) continue;
      games += 1;
      const nums = (comp.competitors ?? []).map((c) => Number(c.score));
      if (nums.length === 2 && nums.every((n) => Number.isFinite(n))) scored += 1;
    }
  } catch {
    games = 0;
  }
  record('Счёт ESPN: источник отдаёт числа', scored > 0,
         `${scored} матчей со счётом из ${games} (eng.1)`,
         'спрашивается СЧЁТ, а не код ответа: 200 над пустым телом ничего не значит');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: у выдуманной лиги счёта быть не может.
  let ghostOk = false;
  try {
    const r = await fetch(board('zz.9'), { headers: { 'User-Agent': UA } });
    const d = await r.json().catch(() => ({}));
    ghostOk = !r.ok || !(d.events ?? []).length;
  } catch {
    ghostOk = true;
  }
  record('Счёт ESPN: контроль выдуманной лиги', ghostOk,
         ghostOk ? 'по лиге zz.9 пусто, как и должно' : 'выдуманная лига отдала матчи',
         ghostOk ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');

  // 2. КОНЕЦ ЦЕПОЧКИ. Матч, отмеченный завершённым, ОБЯЗАН иметь счёт.
  //    Это и ловит запись «completed без счёта»: `completed` снимается только
  //    вручную, потому что по нему уже мог пройти разбор прогнозов.
  const since = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  const q = `${url}/rest/v1/fixtures?select=home_score,away_score,completed`
          + `&completed=is.true&commence_at=gte.${since}&limit=1000`;
  const rr = await fetch(q, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const rows = await rr.json().catch(() => null);
  if (!Array.isArray(rows)) {
    record('Счёт ESPN: завершённый матч со счётом', false, 'fixtures не читаются под anon', 'ключ anon');
    return;
  }
  const blank = rows.filter((r) => r.home_score === null || r.away_score === null).length;
  record('Счёт ESPN: завершённый матч со счётом', rows.length > 0 && blank === 0,
         `${rows.length - blank} из ${rows.length} завершённых за 3 дня со счётом`,
         'ловит «completed без счёта» — снять completed нельзя, по нему считают очки');
}

// ------------------------------------------------------------- печать -------
console.log(`\nПроверка прода: ${APP}\n`);
await checkDigest();
await checkAnonRpc();
await checkNoScores();
await checkClubCrests();
await checkFameAxes();
await checkClubValue();
await checkClubRoster();
await checkEspnScores();
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
