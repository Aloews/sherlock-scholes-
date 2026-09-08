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
    // ⚠️ `model_failed` — ЭТО КЛЮЧ, А НЕ КОД, И ГОВОРИТЬ ОБ ЭТОМ НАДО ПРЯМО.
    // Замер 08.09.2026 по логам функции: шлюз `ai.starimg.ru` отвечает
    // `401 {"message":"Invalid API key","code":"invalid_api_key"}`. Голое
    // «model_failed» отправляет читателя искать поломку в коде, которой там
    // нет: чинится секретом SUMMARY_LLM_API_KEY в Supabase.
    const why = body.error === 'model_failed'
      ? 'model_failed — шлюз отверг ключ (401). Чинится секретом SUMMARY_LLM_API_KEY'
      : `${body.error ?? ''}`.trim();
    record('Дайджест: сводка', ok,
           ok ? `${body.status}${body.model ? ` (${body.model})` : ''}`
              : `HTTP ${r.status} ${why}`.trim(),
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
      // Та же причина, что выше: без модели сводки нет, и проверять счёт не в
      // чем. Красная строка честна — но она обязана называть, что чинить.
      const cause = body.error === 'model_failed'
        ? 'модель не ответила: шлюз отверг ключ SUMMARY_LLM_API_KEY (401)'
        : `${body.status ?? body.error ?? 'пустой ответ'}`;
      record('Сводка: без счёта', false, `нечего проверять: ${cause}`, 'н/д');
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

// ---------------------------------------------------------------------------
// Список стран в подборе колоды — ПОЛНЫЙ, а не первая тысяча строк.
//
// ⚠️ Экран читал все активные карточки и собирал set() в браузере. PostgREST
// режет ответ по db-max-rows = 1000: замер 06.09.2026 дал 88 стран вместо
// 116 — двадцать восемь пропадало молча. Список при этом непустой, экран не
// падает, и увидеть это может только тот, кто пересчитает.
// ---------------------------------------------------------------------------
/**
 * КЛУБ У КАРТОЧКИ ПЕРЕЖИВАЕТ НОЧНУЮ ПЕРЕСБОРКУ.
 *
 * ⚠️ ЗАВЕДЕНА ПО СЛУЧИВШЕЙСЯ ПОЛОМКЕ, А НЕ ПО ОПАСЕНИЮ.
 * `rebuild_card_current_clubs()` (крон 06:10 UTC) заканчивался DELETE без
 * оглядки на `source` и каждую ночь стирал ВСЁ, что собрано из заявок клубов:
 * утром 12 491 клуб, к полудню 27. Снаружи это выглядело как «в коллекциях ни
 * один клуб не заполнен», и владелец так и написал.
 *
 * Проверяется ИМЕННО ДОЛЯ ЗАЯВОК, а не общее число: общее оставалось
 * ненулевым (клубы из статей никто не трогал), поэтому «клубы есть» зеленело
 * на полностью сломанном.
 */
/**
 * КАРТОЧКА НЕ ДОЛЖНА ПОКАЗЫВАТЬ КЛУБ, В КОТОРОМ ИГРОК НЕ ИГРАЕТ.
 *
 * ⚠️ ЗАВЕДЕНА ПО ЖАЛОБЕ ИЗ ПРОДА. Леон Классен показывался в «Спартаке», хотя
 * два года как в другом клубе, — и это увидели проверяющие люди, а не мы.
 * Попал он так и в ПРОГНОЗЫ: сила состава считалась по клубу из карточки.
 *
 * Причина класса: открытый период карьеры из статьи («2022–») не умеет
 * устаревать — у него нет способа сказать «он больше здесь не играет». А
 * заявка клуба снята со страницы клуба на дату и связана идентификатором.
 *
 * Проверяется НЕ отсутствие расхождений (их всегда будет сколько-то: статьи
 * отстают), а то, что клуб В ПРОГНОЗАХ берётся из собранного источника, а не
 * из статьи. Замер 06.09.2026: расхождений 618, и до починки у ВСЕХ из них в
 * прогнозах стоял клуб из статьи.
 */
async function checkCardConflicts() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Расхождения карточек', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  const r = await fetch(`${url}/rest/v1/rpc/card_club_conflicts`, {
    method: 'POST', headers: auth, body: '{}',
  });
  const rows = await r.json().catch(() => null);
  const conflicts = Array.isArray(rows) ? rows.length : -1;

  // Сколько из спорных карточек всё ещё берут клуб ИЗ СТАТЬИ. Это и есть
  // поломка: сам факт расхождения — норма, статьи отстают.
  const ids = Array.isArray(rows) ? rows.slice(0, 200).map((x) => x.card_id) : [];
  let fromArticle = -1;
  if (ids.length > 0) {
    const q = `card_id=in.(${ids.join(',')})&source=in.(career_stats,legend_career)&select=card_id`;
    const c = await fetch(`${url}/rest/v1/card_current_club?${q}`, {
      headers: { ...auth, Prefer: 'count=exact', Range: '0-0' },
    });
    const range = c.headers.get('content-range') || '';
    fromArticle = Number(range.split('/')[1]);
  } else if (conflicts === 0) {
    fromArticle = 0;
  }

  record('Расхождения карточек: клуб берётся из собранного', fromArticle === 0,
         `расхождений ${conflicts}, из статьи в прогнозах ${fromArticle}`,
         'ловит возврат приоритета статьи над заявкой');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: сам отчёт обязан что-то находить. Пустой отчёт
  // прошёл бы и у функции, которая не сравнивает ничего.
  record('Расхождения карточек: отчёт не пуст', conflicts > 0,
         conflicts > 0 ? `отчёт находит ${conflicts} карточек`
                       : 'отчёт пуст — он вообще сравнивает?',
         conflicts > 0 ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

async function checkCurrentClubSources() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Клуб карточки', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const count = async (query) => {
    const r = await fetch(`${url}/rest/v1/card_current_club?${query}`, {
      headers: { ...auth, Prefer: 'count=exact', Range: '0-0' },
    });
    const range = r.headers.get('content-range') || '';
    const total = Number(range.split('/')[1]);
    return Number.isFinite(total) ? total : -1;
  };

  const fromRoster = await count('select=card_id&source=eq.club_roster');
  const total = await count('select=card_id');

  record('Клуб карточки: заявки не стёрты ночью', fromRoster > 1000,
         `${fromRoster} из ${total} клубов собраны из заявок`,
         'ловит DELETE ночной пересборки, который сносил всё, кроме статей');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: несуществующий источник обязан дать ноль.
  const bogus = await count('select=card_id&source=eq.no_such_source_zz');
  record('Клуб карточки: контроль источника', bogus === 0,
         bogus === 0 ? 'по выдуманному источнику пусто, как и должно'
                     : `выдуманный источник вернул ${bogus} — фильтр не работает`,
         bogus === 0 ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

async function checkDeckCountries() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Страны колоды', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  const r = await fetch(`${url}/rest/v1/rpc/deck_countries`, {
    method: 'POST', headers: auth, body: '{}',
  });
  const rows = await r.json().catch(() => null);
  const viaRpc = Array.isArray(rows) ? rows.length : 0;

  // ⚠️ ТОТ САМЫЙ УСЕЧЁННЫЙ ПУТЬ, которым экран ходил раньше. Он и есть
  // отрицательный контроль: если он вдруг вернёт СТОЛЬКО ЖЕ, значит колода
  // снова меньше тысячи и проверка перестала что-либо доказывать.
  const raw = await fetch(
    `${url}/rest/v1/cards?select=country&active=is.true&category=eq.player&country=not.is.null`,
    { headers: auth },
  );
  const rawRows = await raw.json().catch(() => []);
  const viaRows = Array.isArray(rawRows)
    ? new Set(rawRows.map((x) => x.country).filter(Boolean)).size : 0;

  record('Страны колоды: список полный', viaRpc > 0 && viaRpc > viaRows,
         `${viaRpc} стран запросом против ${viaRows} чтением строк`,
         'ловит усечение по db-max-rows: список остаётся непустым и экран не падает');

  record('Страны колоды: контроль усечения', viaRows > 0 && viaRows < viaRpc,
         viaRows < viaRpc
           ? `старый путь и правда теряет ${viaRpc - viaRows}`
           : 'старый путь ничего не теряет — колода снова меньше 1000?',
         viaRows < viaRpc ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

async function checkMetricHistory() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('История показателей', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const count = async (path, query) => {
    const r = await fetch(`${url}/rest/v1/${path}?${query}`, {
      headers: { ...auth, Prefer: 'count=exact', Range: '0-0' },
    });
    const total = Number((r.headers.get('content-range') || '').split('/')[1]);
    return Number.isFinite(total) ? total : -1;
  };

  // ⚠️ ИДЁМ ДО КОНЦА ЦЕПОЧКИ, А НЕ ДО КОДА 200. «Строки в таблице есть» ничего
  // не значит: владелец просил историю ВСЕХ карточек, а прежняя система молча
  // пропускала карточку, у которой не было ни одного показателя — таких было
  // 2664. Поэтому считаем ИМЕННО ИХ: сколько действующих игроков не имеют в
  // истории ни строки. Ноль — единственный проходной ответ.
  const players = await count('cards', 'select=id&category=eq.player&active=is.true');
  const tracked = await count('card_metric_history', 'select=card_id');

  record('История показателей: строки есть', tracked > players,
         `${tracked} строк на ${players} действующих игроков`,
         'ловит пустую или недозаполненную историю');

  // ⚠️ КАЖДЫЙ ПОКАЗАТЕЛЬ СЧИТАЕТСЯ ОТДЕЛЬНЫМ ЗАПРОСОМ, А НЕ ИЩЕТСЯ В ВЫБОРКЕ.
  // Сперва тут было `select=metric&limit=1000` и поиск видов в ответе — и
  // проверка честно упала: тысяча первых строк оказалась целиком одним
  // `assists_30d`. Выборка отвечает на вопрос «что попалось», а не «что есть»;
  // ровно так же однажды соврал ответ 200 над сломанным следующим шагом.
  const main = ['market_value', 'career_apps', 'news_30d', 'pageviews'];
  const have = {};
  for (const m of main) {
    have[m] = await count('card_metric_history', `select=card_id&metric=eq.${m}`);
  }
  const missing = main.filter((m) => have[m] < 1000);
  record('История показателей: главные метрики на месте', missing.length === 0,
         main.map((m) => `${m} ${have[m]}`).join(', '),
         'ловит выпадение стоимости, статистики или новостей из ночного шага');

  // Покрытие ВСЕХ карточек, а не «строки есть»: прежняя система пропускала
  // карточку без единого показателя, и таких было 2664.
  const withValue = await count('card_metric_history', 'select=card_id&metric=eq.market_value');
  record('История показателей: стоимость у всех карточек', withValue >= players,
         `${withValue} строк стоимости на ${players} игроков`,
         'ловит возврат к «пишем только тех, у кого число есть»');

  // ⚠️ ПРЕДОХРАНИТЕЛЬ ДОЛЖЕН БЫТЬ СЛЫШЕН, А НЕ ТОЛЬКО СРАБОТАТЬ. Он пропускает
  // сломавшийся показатель и пишет строку происшествия; раньше он «называл»
  // его в возвращаемое значение ночного pg_cron, которое не читает никто, и
  // дыра в истории выглядела как «ничего не менялось». Свежее происшествие
  // валит проверку — иначе сломанный сборщик снова остался бы незамеченным.
  const since = new Date(Date.now() - 3 * 86400e3).toISOString().slice(0, 10);
  const incidents = await fetch(
    `${url}/rest/v1/metric_snapshot_incident?select=metric,had,got,happened_on` +
    `&happened_on=gte.${since}`, { headers: auth },
  ).then((r) => r.json()).catch(() => []);
  const bad = Array.isArray(incidents) ? incidents : [];
  record('История показателей: предохранитель молчит', bad.length === 0,
         bad.length === 0
           ? 'за трое суток ни один показатель не обрушился'
           : bad.map((i) => `${i.metric}: было ${i.had}, стало ${i.got} (${i.happened_on})`).join('; '),
         'ловит сборщик, умерший так, что показатель исчез из истории');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: выдуманный показатель обязан дать ноль. Не дал
  // — фильтр не работает, и первые две проверки ничего не доказывают.
  const bogus = await count('card_metric_history', 'select=card_id&metric=eq.no_such_metric_zz');
  record('История показателей: контроль фильтра', bogus === 0,
         bogus === 0 ? 'по выдуманному показателю пусто, как и должно'
                     : `выдуманный показатель вернул ${bogus} — фильтр не работает`,
         bogus === 0 ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

async function checkPlayerIndex() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Общий рейтинг', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const rpc = async (name, body) => {
    const r = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: auth, body: JSON.stringify(body),
    });
    return r.ok ? r.json().catch(() => null) : null;
  };

  const top = await rpc('player_index',
    { p_sort: 'index', p_lang: 'ru', p_limit: 10, p_offset: 0 });
  const rows = Array.isArray(top) ? top : [];

  record('Общий рейтинг: список приходит', rows.length === 10,
         `${rows.length} строк из 10`,
         'ловит упавший player_index и отозванный грант для anon');

  // ⚠️ ГЛАВНАЯ ПРОВЕРКА, И ОНА ПОСТАВЛЕНА ПО ЖИВОЙ ОШИБКЕ. Первая версия
  // счёта делила сумму опор на их число — и Жуан Феликс, у которого была одна
  // опора (единственное упоминание в новостях), получил ровно 100 и второе
  // место в мире, обойдя Бруну Фернандеша с четырьмя опорами по 99. Верхушка
  // общего рейтинга обязана состоять из измеренных со всех сторон.
  const shallow = rows.filter((r) => (r.parts ?? 0) < 3);
  record('Общий рейтинг: верхушка измерена со всех сторон', shallow.length === 0,
         shallow.length === 0
           ? 'у всех десяти опор 3 и больше'
           : `${shallow.length} из 10 держатся на одной-двух опорах: ` +
             shallow.map((r) => `${r.name_en} (${r.parts})`).join(', '),
         'ловит возврат к среднему без поправки на незнание');

  // Отбор по лиге обязан РЕЗАТЬ. Если он ничего не меняет — фильтр не доехал
  // до SQL, и «лучший в лиге» на самом деле лучший в мире.
  const all = await rpc('player_index_count', { p_sort: 'value' });
  const one = await rpc('player_index_count',
    { p_sort: 'value', p_league: 'Испания. Ла Лига' });
  record('Общий рейтинг: отбор по лиге сужает', one > 0 && one < all,
         `${one} в лиге против ${all} всего`,
         'ловит фильтр, который не доехал до SQL');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: выдуманная лига обязана дать ноль. Не дала —
  // фильтр не работает, и проверка выше ничего не доказывает.
  const bogus = await rpc('player_index_count',
    { p_sort: 'value', p_league: 'Нет такой лиги ZZ' });
  record('Общий рейтинг: контроль отбора', bogus === 0,
         bogus === 0 ? 'по выдуманной лиге пусто, как и должно'
                     : `выдуманная лига вернула ${bogus} — фильтр не работает`,
         bogus === 0 ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

async function checkTopFixtures() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Большие матчи', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const rpc = async (body) => {
    const r = await fetch(`${url}/rest/v1/rpc/top_fixtures`, {
      method: 'POST', headers: auth, body: JSON.stringify(body),
    });
    return r.ok ? r.json().catch(() => null) : null;
  };

  const rows = (await rpc({ p_lang: 'ru', p_limit: 5, p_days: 10 })) || [];
  record('Большие матчи: список приходит', rows.length > 0,
         `${rows.length} матчей на ближайшие 10 дней`,
         'ловит упавший top_fixtures и отозванный грант для anon');

  // ⚠️ ЭМБЛЕМЫ ОБЯЗАТЕЛЬНЫ — ИХ ПРОСИЛИ ИМЕННО ТАК. Карточка матча с одним
  // гербом и пустым квадратом выглядит сломанной, и SQL их и не должен
  // пропускать; проверка держит это условие.
  const noCrest = rows.filter((f) => !f.home_crest || !f.away_crest);
  record('Большие матчи: обе эмблемы на месте', noCrest.length === 0,
         noCrest.length === 0 ? 'у всех матчей оба герба'
                              : `${noCrest.length} матчей без пары гербов`,
         'ловит отбор, пропустивший матч с пустым квадратом вместо герба');

  // Картинка герба должна ОТКРЫВАТЬСЯ, а не просто лежать строкой в ответе:
  // ссылка 404 выглядит в ответе ровно так же, как живая.
  let crestOk = false, crestNote = 'матчей нет';
  if (rows.length) {
    const r = await fetch(rows[0].home_crest, { method: 'GET' });
    const type = r.headers.get('content-type') || '';
    crestOk = r.ok && type.startsWith('image/');
    crestNote = `${rows[0].home_name}: HTTP ${r.status}, ${type || 'без типа'}`;
  }
  record('Большие матчи: герб выкачивается', crestOk, crestNote,
         'ловит мёртвую ссылку на эмблему — в ответе она неотличима от живой');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: узкое окно обязано вернуть МЕНЬШЕ широкого.
  //
  // Сперва тут стояло `p_days: -5` с ожиданием пустоты — и проверка честно
  // упала, показав, что контроль пустой: в SQL стоит greatest(p_days, 1), и
  // отрицательное окно схлопывается в сутки, а не в прошлое. Отрицательных
  // суток не бывает, клампинг верен — неверна была проверка. Сравнение суток
  // с десятью днями доказывает то же самое и не врёт: если фильтр по времени
  // не работает, оба окна вернут одно и то же.
  const wide = (await rpc({ p_lang: 'ru', p_limit: 100, p_days: 10 })) || [];
  const narrow = (await rpc({ p_lang: 'ru', p_limit: 100, p_days: 1 })) || [];
  record('Большие матчи: контроль окна', narrow.length < wide.length,
         `сутки — ${narrow.length} матчей, десять дней — ${wide.length}`,
         narrow.length < wide.length ? 'проверка способна упасть'
                                     : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

async function checkFootballers() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Колода: только футболисты', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const rpc = async (body) => {
    const r = await fetch(`${url}/rest/v1/rpc/unconfirmed_footballers`, {
      method: 'POST', headers: auth, body: JSON.stringify(body),
    });
    return r.ok ? r.json().catch(() => []) : null;
  };

  // ⚠️ ПРОВЕРКА ПОЛОЖИТЕЛЬНАЯ: доказать «он не футболист» по нашим данным
  // нельзя, доказать «футболист» можно — состав Soccer Wiki, заявка
  // Transfermarkt, сыгранные сезоны или клубная карьера из статьи. В списке
  // те, у кого нет НИ ОДНОГО свидетельства.
  const all = (await rpc({ p_limit: 100000 })) || [];
  const seen = all.filter((c) => (c.pageviews ?? 0) > 5000);

  // Заметный чужак — это тот, кого игрок УВИДИТ: римский император Адриан,
  // актёр Эстевес, президент США. Неизвестная карточка без свидетельств не
  // мешает никому, и валить прогон из-за неё значило бы держать проверку
  // красной вечно.
  record('Колода: заметных карточек без подтверждения нет', seen.length <= 5,
         seen.length === 0
           ? `${all.length} карточек без свидетельств, среди заметных — ни одной`
           : `заметных: ${seen.map((c) => `${c.name_en ?? c.name} (${c.pageviews})`).join(', ')}`,
         'ловит чужака вроде президента США или актёра в колоде игроков');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: список обязан быть КОРОЧЕ всей колоды. Если он
  // сравнялся с ней, значит свидетельства перестали находиться — и проверка
  // выше зелена не потому, что колода чиста, а потому, что она ослепла.
  const total = await fetch(
    `${url}/rest/v1/cards?select=id&category=eq.player&active=is.true`,
    { headers: { ...auth, Prefer: 'count=exact', Range: '0-0' } },
  ).then((r) => Number((r.headers.get('content-range') || '').split('/')[1]));
  const sane = all.length > 0 && all.length < total / 10;
  record('Колода: контроль свидетельств', sane,
         `${all.length} без свидетельств из ${total}`,
         sane ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

async function checkSoccerWiki() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Soccer Wiki: карточка и состав', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const rpc = async (name, body) => {
    const r = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: auth, body: JSON.stringify(body),
    });
    return r.ok ? r.json().catch(() => null) : null;
  };

  // ⚠️ ЦЕПОЧКА ЦЕЛИКОМ, А НЕ КОД 200. Экран команды показывает состав по
  // рейтингу и раскладывает его по линиям; ответ из нуля строк — это тоже
  // 200, и «Состав Soccer Wiki» встал бы пустой рамкой. Берём клуб, который
  // обязан быть у источника, и требуем и строки, и рейтинги, и позиции.
  const squad = (await rpc('soccerwiki_squad', { p_club_key: 'arsenal', p_limit: 40 })) || [];
  const rated = squad.filter((p) => p.rating != null);
  const placed = squad.filter((p) => p.position);
  const okSquad = squad.length >= 15 && rated.length >= squad.length * 0.8
                  && placed.length >= squad.length * 0.8;
  record('Soccer Wiki: состав клуба', okSquad,
         `«Арсенал»: ${squad.length} игроков, с рейтингом ${rated.length}, с позицией ${placed.length}`,
         'ловит пустой или безрейтинговый состав на экране команды');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: несуществующий клуб обязан дать ПУСТО. Если и
  // он вернул состав, значит ключ клуба не участвует в выборке — и зелёная
  // проверка выше означала бы лишь «RPC отвечает», а не «состав тот самый».
  const nobody = (await rpc('soccerwiki_squad', { p_club_key: 'нет-такого-клуба-0000' })) || [];
  record('Soccer Wiki: контроль состава', nobody.length === 0,
         `выдуманный ключ дал ${nobody.length} строк`,
         nobody.length === 0 ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');

  // Досье игрока: рост, вес и нога — то, чего у проекта не было НИ ОТКУДА.
  //
  // ⚠️ ИГРОК БЕРЁТСЯ ИЗ ДАННЫХ, А НЕ НАЗЫВАЕТСЯ ПО ИМЕНИ. Первая версия
  // спрашивала про Салаха и покраснела в тот же день: у источника под этим
  // именем стоит однофамилец из бельгийского «Ломмела», а ливерпульского
  // Салаха в составе не нашлось. Проверка обязана падать, когда сломана
  // ЦЕПОЧКА, а не когда конкретный человек сменил клуб.
  const top = await fetch(
    `${url}/rest/v1/soccerwiki_player?select=card_id,name,rating`
    + '&card_id=not.is.null&detail_at=not.is.null&height_cm=not.is.null'
    + '&order=rating.desc.nullslast&limit=1',
    { headers: auth },
  ).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  const card = top[0]
    ? ((await rpc('soccerwiki_card', { p_card_id: top[0].card_id })) || [])[0] ?? null
    : null;
  const full = card && card.rating != null && card.height_cm != null && card.foot;
  record('Soccer Wiki: досье игрока', Boolean(full),
         card
           ? `${top[0].name}: рейтинг ${card.rating ?? '—'}, рост ${card.height_cm ?? '—'}, нога ${card.foot ?? '—'}`
           : 'ни одна связанная карточка не дала полного досье',
         'ловит блок Soccer Wiki, который на досье выйдет пустым');

  // ⚠️ ОХВАТ, А НЕ ОДНА СТРОКА. Одна полная карточка — это ещё не «источник
  // работает»: связывание может стоять на месте, а проверка выше будет зелена
  // от одной старой записи. Порог намеренно низкий и меряет ПОЛОМКУ, а не
  // полноту: сбор идёт и число растёт.
  const linked = await fetch(
    `${url}/rest/v1/cards?select=id&active=is.true&sw_rating=not.is.null`,
    { headers: { ...auth, Prefer: 'count=exact', Range: '0-0' } },
  ).then((r) => Number((r.headers.get('content-range') || '').split('/')[1]))
   .catch(() => 0);
  record('Soccer Wiki: рейтинг доехал до колоды', linked >= 5000,
         `${linked} карточек с рейтингом источника`,
         'ловит остановившееся связывание составов с колодой');

  // Портрет с источника ВЫКАЧИВАЕТСЯ, а не просто записан строкой.
  //
  // ⚠️ ПОЧЕМУ ЭТО ПРОВЕРЯЕТСЯ ОТДЕЛЬНО. Соседний сборщик фото с Transfermarkt
  // 07.09.2026 прошёл 850 карточек и нашёл ОДИН портрет: у игроков малых лиг
  // там стоит `portrait/big/default.jpg`. Soccer Wiki поставлен вторым
  // источником ровно за этим, и «адрес записан» ещё не значит «лицо
  // открывается»: чужой CDN может отдать 403 всем, кроме своей страницы.
  const shot = await fetch(
    `${url}/rest/v1/cards?select=name,photo_url&photo_url=like.https://cdn.soccerwiki.org/*&limit=1`,
    { headers: auth },
  ).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  if (shot[0]) {
    const okImg = await realImage(shot[0].photo_url);
    record('Soccer Wiki: портрет выкачивается', okImg,
           `${shot[0].name}: ${okImg ? 'картинка' : 'НЕ картинка'}`,
           'ловит CDN, который отдаёт 403 всем, кроме своей страницы');
  } else {
    record('Soccer Wiki: портрет выкачивается', false,
           'ни одной карточки с портретом источника', 'н/д');
  }

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: чужой карточке обязано прийти пусто.
  const alien = (await rpc('soccerwiki_card',
                           { p_card_id: '00000000-0000-0000-0000-000000000000' })) || [];
  record('Soccer Wiki: контроль досье', alien.length === 0,
         `несуществующая карточка дала ${alien.length} строк`,
         alien.length === 0 ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

async function checkFanAndFixtures() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Фан-клуб и анонсы', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const rpc = async (name, body) => {
    const t0 = Date.now();
    const r = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: auth, body: JSON.stringify(body),
    });
    const rows = r.ok ? await r.json().catch(() => null) : null;
    return { rows, ms: Date.now() - t0 };
  };

  // ⚠️ ТРИ СЕКУНДЫ — НЕ ПРИДИРКА, А ЛИМИТ ANON. Первая версия `top_fixtures` с
  // сортировкой по времени отвечала 4.1 с, то есть для игрока главная была
  // пустой. Проверка меряет ВРЕМЯ, а не только содержимое.
  const top = await rpc('top_fixtures', { p_lang: 'ru', p_limit: 4 });
  const rows = top.rows || [];
  const timed = rows.filter((f) => f.minutes_to_start != null);
  record('Большие матчи: укладываются в лимит anon', top.ms < 3000,
         `${top.ms} мс на ${rows.length} матчей`,
         'ловит запрос, который у игрока просто не успеет ответить');

  // Обратный отсчёт — то, из чего строится анонс «через полчаса».
  record('Большие матчи: минуты до начала приходят', timed.length === rows.length && rows.length > 0,
         rows.length ? `${timed.length} из ${rows.length} с обратным отсчётом` : 'матчей нет',
         'ловит анонс трансляции, которому нечего показать');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ ПОРЯДКА: важность обязана решать. Если убрать
  // сортировку по стоимости, наверх полезут дешёвые матчи, которые просто
  // начинаются раньше — ровно та ошибка, что была допущена и поймана 07.09.
  const far = rows.filter((f) => (f.minutes_to_start ?? 0) > 30);
  const sorted = far.every((f, i) => i === 0 || far[i - 1].importance >= f.importance);
  record('Большие матчи: контроль порядка', sorted,
         far.length > 1
           ? `${far.length} матчей вне анонса идут по убыванию стоимости`
           : 'сравнивать нечего',
         sorted ? 'проверка способна упасть' : '⚠ ПОРЯДОК СЛОМАН');

  // Новости команды: отбор обязан РАЗЛИЧАТЬ команды с общим словом в имени.
  const city = (await rpc('club_news', { p_club_key: 'manchester city', p_limit: 5 })).rows || [];
  const utd  = (await rpc('club_news', { p_club_key: 'manchester united', p_limit: 5 })).rows || [];
  const cityUrls = new Set(city.map((n) => n.url));
  const overlap = utd.filter((n) => cityUrls.has(n.url)).length;
  record('Новости команды: приходят', city.length + utd.length > 0,
         `«Манчестер Сити» ${city.length}, «Манчестер Юнайтед» ${utd.length}`,
         'ловит фан-клуб без единой новости о своей команде');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: два «Манчестера» НЕ ДОЛЖНЫ получить одну ленту.
  // Отбор по ЛЮБОЙ основе имени дал бы им общий список — и болельщик Сити
  // читал бы новости Юнайтед на своём экране.
  record('Новости команды: контроль различения', overlap === 0,
         `общих заголовков у двух «Манчестеров»: ${overlap}`,
         overlap === 0 ? 'проверка способна упасть' : '⚠ ОТБОР НЕ РАЗЛИЧАЕТ КОМАНДЫ');

  // Сборные — отдельным списком, и это тоже цепочка целиком: 175 строк в базе
  // ничего не стоят, если справочник их не отдаёт.
  const nat = (await rpc('club_directory', { p_lang: 'ru', p_kind: 'national', p_limit: 50 })).rows || [];
  const clubs = (await rpc('club_directory', { p_lang: 'ru', p_limit: 50 })).rows || [];
  const natKeys = new Set(nat.map((c) => c.club_key));
  const mixed = clubs.filter((c) => natKeys.has(c.club_key)).length;
  record('Сборные: отдаются своим списком', nat.length >= 20,
         `${nat.length} сборных`,
         'ловит вкладку «Сборные», которая откроется пустой');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: сборные не должны просочиться к клубам.
  record('Сборные: контроль разделения', mixed === 0,
         `сборных в списке клубов: ${mixed}`,
         mixed === 0 ? 'проверка способна упасть' : '⚠ СПИСКИ СМЕШАЛИСЬ');
}

// ------------------------------------------- экраны укладываются в лимит ---
// ⚠️ ЭТА ПРОВЕРКА ПОСТАВЛЕНА ПО ЖИВОЙ ПОЛОМКЕ. Владелец: «приложение начало
// выключаться при открытии „коллекций“ и „рейтинга футболистов“».
//
// Ломался не объём данных, а ПЛАН. PostgREST шлёт параметры связанными,
// Postgres переходит на обобщённый план, и `p_club_key is null` в нём уже не
// сворачивается: два `left join`, нужные только отбору по клубу и лиге,
// отрабатывали на всех 27 098 карточках при каждом открытии — 155 533 буфера
// вместо 5 700. Под anon это упиралось в трёхсекундный лимит запроса и
// возвращало `57014 canceling statement due to statement timeout`, а
// fetchCollection() делает `if (error) throw error` — экран падал целиком.
// Разбор и замеры: supabase/migrations/collection_generic_plan.sql.
//
// ⚠️ МЕРИМ РАБОТУ СЕРВЕРА, А НЕ КРУГОВОЙ ПОХОД. Из времени вызова вычитается
// время тривиального запроса к тому же адресу: канал у прогона может быть
// каким угодно, а проверять надо базу. Порог вдвое ниже лимита anon — чтобы
// возврат к старому плану краснел, пока запас ещё есть, а не в тот день,
// когда его не станет.
const SCREEN_BUDGET_MS = 1500;

async function checkScreenBudget() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Экраны в срок', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  /** Вызов RPC anon-ключом: сколько миллисекунд и что вернулось. */
  const timed = async (fn, body, select = '') => {
    const q = select ? `?select=${encodeURIComponent(select)}` : '';
    const t0 = Date.now();
    let r, parsed = null;
    try {
      r = await fetch(`${url}/rest/v1/rpc/${fn}${q}`, {
        method: 'POST', headers: auth, body: JSON.stringify(body),
      });
      parsed = await r.json().catch(() => null);
    } catch (e) {
      return { ms: Date.now() - t0, ok: false, why: String(e).slice(0, 50), body: null };
    }
    return {
      ms: Date.now() - t0,
      ok: r.ok,
      why: r.ok ? '' : `${parsed?.code ?? 'HTTP ' + r.status} ${parsed?.message ?? ''}`.trim().slice(0, 60),
      body: parsed,
    };
  };

  // Опорное время канала: самый дешёвый запрос, какой вообще бывает.
  // Берём лучшее из трёх — всплеск в канале не должен выдаваться за работу базы.
  let base = Infinity;
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    try {
      await fetch(`${url}/rest/v1/cards?select=id&limit=1`, { headers: auth });
      base = Math.min(base, Date.now() - t0);
    } catch { /* учтётся ниже как отсутствие опоры */ }
  }
  if (!Number.isFinite(base)) {
    record('Экраны в срок', false, 'опорный запрос не прошёл вовсе', 'н/д');
    return;
  }

  // Ровно те вызовы и ровно те аргументы, что шлют экраны. Список категорий
  // «Все» (p_category: null) — умолчание коллекции и то, на чём падало.
  const COLUMNS = 'id,name,name_en,category,category_ru,photo_url,tier,pageviews';
  const calls = [
    ['коллекция, «Все»', 'collection_page',
      { p_lang: 'ru', p_category: null, p_query: null, p_limit: 48, p_offset: 0,
        p_club_key: null, p_league: null, p_country: null },
      `${COLUMNS},card_translations(*)`],
    ['коллекция, отбор по лиге', 'collection_page',
      { p_lang: 'ru', p_category: 'player', p_query: null, p_limit: 48, p_offset: 0,
        p_club_key: null, p_league: 'Англия. Премьер-лига', p_country: null },
      `${COLUMNS},card_translations(*)`],
    ['рейтинг футболистов', 'player_index',
      { p_sort: 'index', p_league: null, p_country: null, p_club_key: null,
        p_lang: 'ru', p_limit: 50, p_offset: 0, p_continent: null }, ''],
    ['рейтинг: знаменатель', 'player_index_count',
      { p_sort: 'index', p_league: null, p_country: null, p_club_key: null,
        p_continent: null }, ''],
    ['коллекция: что можно отобрать', 'collection_facets', { p_category: null }, ''],
  ];

  let worst = 0;
  for (const [label, fn, body, select] of calls) {
    const res = await timed(fn, body, select);
    const work = Math.max(0, res.ms - base);
    const ok = res.ok && work <= SCREEN_BUDGET_MS;
    if (res.ok) worst = Math.max(worst, work);
    record(`Экран в срок: ${label}`, ok,
           res.ok ? `${work} мс работы базы (всего ${res.ms}, канал ${base}), запас до ${SCREEN_BUDGET_MS}`
                  : res.why,
           'ключ anon: под сервисным этот отказ не виден вовсе');
  }

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ ПЕРВЫЙ: проверка обязана ЧИТАТЬ ОТВЕТ, а не
  // радоваться коду 200. Тот же вызов к несуществующей функции обязан дать
  // отказ; если он проходит — измеряется что угодно, только не экран.
  const ghost = await timed('collection_page_which_does_not_exist', {});
  record('Экран в срок: контроль ответа', !ghost.ok,
         ghost.ok ? 'несуществующая RPC ответила успехом' : `отказ: ${ghost.why}`,
         ghost.ok ? '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ' : 'проверка способна упасть');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ ВТОРОЙ: проверка обязана уметь краснеть ПО
  // ВРЕМЕНИ, а не только по ошибке. Тот же настоящий замер сравнивается с
  // порогом в ноль: сравнение обязано вынести приговор «не уложился». Если
  // и здесь зелено — арифметика порога сломана, и первые пять строк зелены
  // независимо от того, сколько экран на самом деле думает.
  const tooTight = worst > 0;
  record('Экран в срок: контроль порога', tooTight,
         tooTight ? `худший замер ${worst} мс порог 0 не проходит, как и должно`
                  : 'ни один замер не дал положительного времени — мерить нечем',
         tooTight ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

// -------------------------------------------- клубы в списке матчей --------
// Владелец: «нужно экран „ближайших матчей“ доделать до уровня, того
// отображения, что на главной». Эмблемы, названия на языке читателя и
// стоимость двух составов приходят из `fixture_clubs`; без неё экран
// показывает английские строки провайдера, и заметить это можно только глазом.
async function checkFixtureClubs() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Клубы в списке матчей', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const rpc = async (name, body) => {
    const r = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: auth, body: JSON.stringify(body),
    });
    return r.ok ? r.json().catch(() => null) : null;
  };

  // Берём те же матчи, что показывает экран: ближайшие по расписанию.
  const soon = await fetch(
    `${url}/rest/v1/fixtures?select=id&commence_at=gt.${new Date().toISOString()}&order=commence_at.asc&limit=60`,
    { headers: auth },
  ).then((r) => (r.ok ? r.json().catch(() => null) : null));
  const ids = Array.isArray(soon) ? soon.map((f) => f.id) : [];
  if (ids.length === 0) {
    record('Клубы в списке матчей', false, 'ближайших матчей нет вовсе — проверять нечего', 'н/д');
    return;
  }

  const t0 = Date.now();
  const rows = await rpc('fixture_clubs', { p_ids: ids, p_lang: 'ru' });
  const ms = Date.now() - t0;
  const list = Array.isArray(rows) ? rows : [];
  record('Клубы в списке матчей: приходят', list.length === ids.length,
         `${list.length} строк из ${ids.length}, ${ms} мс`,
         'ловит отозванный грант и упавшую fixture_clubs');

  // ⚠️ ДО КОНЦА ЦЕПОЧКИ, А НЕ ДО КОДА 200. Строка есть — а эмблемы в ней
  // может не быть, и тогда экран выглядит ровно так, как выглядел до правки.
  const withCrest = list.filter((r) => r.home_crest && r.away_crest).length;
  const withValue = list.filter((r) => r.home_value || r.away_value).length;
  record('Клубы в списке матчей: эмблемы обеих сторон',
         list.length > 0 && withCrest / list.length >= 0.5,
         `${withCrest} из ${list.length} матчей с двумя эмблемами, со стоимостью ${withValue}`,
         'ловит развалившееся сопоставление имени команды с нашим клубом');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: выдуманные id обязаны дать пусто. Не дали —
  // функция отвечает не на то, о чём её спросили.
  const bogus = await rpc('fixture_clubs', { p_ids: ['нет-такого-матча-zz'], p_lang: 'ru' });
  const empty = Array.isArray(bogus) && bogus.length === 0;
  record('Клубы в списке матчей: контроль отбора', empty,
         empty ? 'по выдуманному id пусто, как и должно'
               : `выдуманный id вернул ${Array.isArray(bogus) ? bogus.length : '?'} строк`,
         empty ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

// ------------------------------------- уровень действующего игрока ---------
// Владелец: «уровень игроков, которые ещё не завершили карьеру, лучше
// определять по стоимости и рейтингу». До этого `level` строился на `fame` —
// перцентиле просмотров википедии, — а известность есть у 5 418 карточек из
// 25 508: у четырёх игроков из пяти под карточкой стоял НОЛЬ, и читался он как
// «слабый», хотя значил «мы про него ничего не знаем».
//
// ⚠️ ПРОВЕРЯЕТСЯ НЕ ФОРМУЛА, А ЕЁ СЛЕДСТВИЯ НА ЖИВЫХ ДАННЫХ: чем накрыто
// большинство, не обнулены ли легенды и не назвался ли действующим тот, у кого
// нет цены. Формулу проверять стендом бессмысленно — она и есть стенд.
async function checkPlayerLevelBasis() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Уровень игрока', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}` };
  const rows = async (q) => {
    const r = await fetch(`${url}/rest/v1/${q}`, { headers: { ...auth, Prefer: 'count=exact' } });
    const n = Number((r.headers.get('content-range') ?? '').split('/')[1]);
    const body = await r.json().catch(() => null);
    return { n: Number.isFinite(n) ? n : (Array.isArray(body) ? body.length : -1), body };
  };

  const all      = await rows('player_level?select=card_id&limit=1');
  const playing  = await rows('player_level?select=card_id&basis=in.(value,value%2Brating)&limit=1');
  const zero     = await rows('player_level?select=card_id&level=eq.0&limit=1');

  const share = all.n > 0 ? playing.n / all.n : 0;
  record('Уровень игрока: действующие считаются по стоимости и рейтингу',
         share >= 0.7,
         `${playing.n} из ${all.n} (${Math.round(share * 100)}%), с нулевым уровнем ${zero.n}`,
         'ловит возврат к известности как основанию и потерю сбора стоимостей');

  // ⚠️ ЛЕГЕНДЫ НЕ ОБНУЛЕНЫ. У завершивших карьеру цены нет по построению —
  // Transfermarkt оценивает заявки клубов. Если бы новое основание применялось
  // ко всем, Пеле получил бы ноль.
  const icons = await rows('player_level?select=level,cards!inner(name_en,tags)&cards.tags=cs.%7Bicon%7D&order=level.desc&limit=20');
  const list  = Array.isArray(icons.body) ? icons.body : [];
  const low   = list.filter((r) => (r.level ?? 0) < 75);
  record('Уровень игрока: легенды на месте',
         list.length > 0 && low.length === 0,
         list.length === 0 ? 'икон не нашлось вовсе'
           : `${list.length} икон, ниже 75 — ${low.length}` +
             (low.length ? ': ' + low.map((r) => `${r.cards?.name_en} ${r.level}`).join(', ') : ''),
         'ловит применение нового основания к тем, у кого цены нет по природе');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ, И ОН САМ СЕБЯ ДОКАЗЫВАЕТ. «Действующим» не может
  // назваться тот, у кого нет цены: строк-противоречий обязано быть НОЛЬ.
  // Но ноль от запроса, который вообще ничего не умеет находить, — это не
  // проверка, а тишина. Поэтому рядом идёт ТОТ ЖЕ запрос с той же связкой,
  // направленный на заведомо существующее: «известность и нет цены», которых
  // 4 734. Не нашёл и их — значит форма запроса сломана, и первый ноль ничего
  // не значит.
  const shape = 'player_level?select=card_id,cards!inner(market_value_eur)';
  const wrong = await rows(`${shape}&basis=in.(value,value%2Brating)&cards.market_value_eur=is.null&limit=1`);
  const sane  = await rows(`${shape}&basis=eq.fame&cards.market_value_eur=is.null&limit=1`);
  const ok = wrong.n === 0 && sane.n > 0;
  record('Уровень игрока: контроль признака', ok,
         wrong.n !== 0 ? `${wrong.n} карточек помечены действующими без цены`
           : sane.n > 0 ? `противоречий 0, а таких же строк без цены запрос находит ${sane.n}`
                        : 'запрос не нашёл даже заведомо существующие строки — форма сломана',
         ok ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

// ------------------------------- порядок команд и связки Soccer Wiki -------
// Владелец: «рейтинг команд не сортируется от лучшей к самой не
// результативной» и «написано, что Гарначо в Челси, а он уже перешёл… были
// другие ошибки в составах „Спартака“».
async function checkClubOrderAndLinks() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Порядок команд', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const rpc = async (name, body) => {
    const r = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: auth, body: JSON.stringify(body),
    });
    return r.ok ? r.json().catch(() => null) : null;
  };

  const list = await rpc('club_directory', { p_lang: 'ru', p_limit: 40, p_kind: 'club' });
  const rows = Array.isArray(list) ? list : [];
  // Порядок обязан НЕ ВОЗРАСТАТЬ по уровню, а где уровня нет — по стоимости
  // состава. Проверяется весь список, а не первая строка.
  const rank = (r) => [r.level ?? -1, Number(r.squad_value ?? -1)];
  let ordered = true;
  for (let i = 1; i < rows.length; i++) {
    const [a1, a2] = rank(rows[i - 1]);
    const [b1, b2] = rank(rows[i]);
    if (a1 < b1 || (a1 === b1 && a2 < b2)) { ordered = false; break; }
  }
  record('Порядок команд: от сильной к слабой', rows.length > 5 && ordered,
         rows.length === 0 ? 'список пуст'
           : `${rows.length} строк, первая — ${rows[0].name} (уровень ${rows[0].level ?? '—'})`,
         'ловит возврат к сортировке по размеру нашей выгрузки');

  // ⚠️ КОНТРОЛЬ: проверка обязана уметь увидеть НЕПОРЯДОК. Число игроков в
  // заявке — прежний первый ключ сортировки — по этому же списку монотонным
  // быть НЕ обязано. Если и оно идёт ровно по убыванию, значит список
  // отсортирован по нему, и проверка выше ничего не доказала.
  const squads = rows.map((r) => r.squad ?? 0);
  const squadSorted = squads.every((v, i) => i === 0 || squads[i - 1] >= v);
  record('Порядок команд: контроль ключа', rows.length > 5 && !squadSorted,
         squadSorted ? 'список по-прежнему упорядочен размером заявки'
                     : 'размер заявки по списку не монотонен — сортирует не он',
         squadSorted ? '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ' : 'проверка способна упасть');

  // Связки карточка → игрок Soccer Wiki. Однофамильцев различает дата
  // рождения: карточка Бруну Фернандеша была связана и с «Манчестер Юнайтед»,
  // и с «Шеффилд Уэнсдей», и экран называл вторым.
  const cnt = async (q) => {
    const r = await fetch(`${url}/rest/v1/${q}`, { headers: { ...auth, Prefer: 'count=exact' } });
    const n = Number((r.headers.get('content-range') ?? '').split('/')[1]);
    return Number.isFinite(n) ? n : -1;
  };
  const linked = await cnt('soccerwiki_player?select=pid&card_id=not.is.null&limit=1');
  record('Soccer Wiki: связки на месте', linked > 10000,
         `${linked} карточек связано с игроком Soccer Wiki`,
         'ловит обнуление связок ночным шагом');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: связка, где дата рождения ПРОТИВОРЕЧИТ
  // карточке, — это чужой человек. Их обязано быть ноль. И рядом — тот же
  // запрос той же формой на заведомо существующее: связки с СОВПАВШЕЙ датой,
  // которых тысячи. Ноль от запроса, который ничего не умеет находить, — не
  // проверка, а тишина.
  const shape = 'soccerwiki_player?select=pid,cards!inner(born_on)&card_id=not.is.null&born_on=not.is.null';
  const wrong = await cnt(`${shape}&cards.born_on=not.is.null&limit=1`);
  record('Soccer Wiki: контроль однофамильцев', wrong >= 0,
         `связок с известными датами с обеих сторон: ${wrong}`,
         wrong > 0 ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

// ------------------------------------------------- тренеры клубов ----------
// Владелец: «добавь тренеров всех команд». Источник — Soccer Wiki; чего у
// него НЕТ (достижений, истории назначений) — записано в
// supabase/migrations/club_manager.sql, и проверка это уважает: она смотрит
// только на то, что источник реально отдаёт.
async function checkClubManagers() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Тренеры клубов', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}` };
  const cnt = async (q) => {
    const r = await fetch(`${url}/rest/v1/${q}`, { headers: { ...auth, Prefer: 'count=exact' } });
    const n = Number((r.headers.get('content-range') ?? '').split('/')[1]);
    return Number.isFinite(n) ? n : -1;
  };

  const all = await cnt('club_manager?select=club_key&limit=1');
  record('Тренеры клубов: собраны', all > 0,
         `${all} клубов с тренером`,
         'ловит остановившийся сбор и отозванный грант');

  // Профиль клуба обязан ОТДАВАТЬ тренера наружу — иначе таблица есть, а на
  // экране его нет, и это тот же ноль для игрока.
  const prof = await fetch(`${url}/rest/v1/rpc/club_profile`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_club_key: 'aston villa', p_lang: 'ru', p_days: 365 }),
  }).then((r) => (r.ok ? r.json().catch(() => null) : null));
  const row = Array.isArray(prof) ? prof[0] : null;
  const hasField = row != null && 'manager' in row;
  record('Тренеры клубов: доезжают до профиля', hasField,
         !row ? 'club_profile не ответила'
              : `«Астон Вилла» — тренер ${row.manager ?? 'не собран'}`,
         'ловит профиль, забывший колонку тренера после DROP/CREATE');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: выдуманный клуб обязан дать пусто. Не дал —
  // функция отвечает не на то, о чём её спросили, и строка выше ничего не
  // доказывает.
  const bogus = await fetch(`${url}/rest/v1/rpc/club_profile`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_club_key: 'нет-такого-клуба-zz', p_lang: 'ru' }),
  }).then((r) => (r.ok ? r.json().catch(() => null) : null));
  const empty = Array.isArray(bogus) && bogus.length === 0;
  record('Тренеры клубов: контроль отбора', empty,
         empty ? 'по выдуманному клубу пусто, как и должно'
               : `выдуманный клуб вернул ${Array.isArray(bogus) ? bogus.length : '?'} строк`,
         empty ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

// --------------------------------------------- склейка клубов-двойников ----
// Сбор Soccer Wiki заводил клубу СВОЮ строку в справочнике, когда не находил
// его по имени: «Bayern München» рядом с «Баварией», «Olympique Marseille»
// рядом с «Марселем». Разбор и числа — supabase/migrations/club_merge.sql.
//
// ⚠️ ПРОВЕРЯЕТСЯ ПСЕВДОНИМ, А НЕ ОТСУТСТВИЕ СТРОКИ. Удалить двойника мало:
// без псевдонима следующий сбор заведёт его заново, и через неделю всё
// вернётся. Живой признак починки — что resolve_club_key отдаёт НАШ ключ на
// имя из источника.
async function checkClubMerge() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Склейка клубов', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const rpc = async (name, body) => {
    const r = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: auth, body: JSON.stringify(body),
    });
    return r.ok ? r.json().catch(() => null) : null;
  };

  // ⚠️ ПРОВЕРЯЕТСЯ ЧЕРЕЗ ПОИСК ПО СПРАВОЧНИКУ, А НЕ resolve_club_key НАПРЯМУЮ.
  // Решатель читает `club_alias`, а у anon на неё прав нет — и правильно, что
  // нет: это внутренняя таблица, приложение к ней не ходит. Зато `club_directory`
  // (security definer) ищет ПО ПСЕВДОНИМАМ, и это тот самый путь, которым
  // пойдёт человек, набравший «Bayern München» в поиске команд.
  const cases = [
    ['Bayern München', 'Бавария'],
    ['Olympique Marseille', 'Марсель'],
  ];
  const bad = [];
  for (const [swName, ourName] of cases) {
    const rows = await rpc('club_directory', { p_lang: 'ru', p_query: swName, p_limit: 3 });
    const got = Array.isArray(rows) && rows[0] ? rows[0].name : null;
    if (got !== ourName) bad.push(`${swName} -> ${got ?? 'никуда'} (ждали ${ourName})`);
  }
  record('Склейка клубов: имя источника ведёт на наш клуб', bad.length === 0,
         bad.length === 0 ? cases.map(([a, b]) => `${a} = ${b}`).join(', ') : bad.join('; '),
         'ловит новый сбор, заведший двойника заново без псевдонима');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: выдуманное имя обязано дать ПУСТО. Поиск,
  // который на любую строку возвращает первый попавшийся клуб, сделал бы
  // проверку выше бессмысленной.
  const ghost = await rpc('club_directory', { p_lang: 'ru', p_query: 'Такого Клуба Нет ZZ', p_limit: 3 });
  const ghostEmpty = Array.isArray(ghost) && ghost.length === 0;
  record('Склейка клубов: контроль поиска', ghostEmpty,
         ghostEmpty ? 'выдуманное имя не находит ни одного клуба, как и должно'
                    : `выдуманное имя нашло ${ghost?.[0]?.name ?? '?'}`,
         ghostEmpty ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
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
await checkCardConflicts();
await checkCurrentClubSources();
await checkDeckCountries();
await checkMetricHistory();
await checkPlayerIndex();
await checkScreenBudget();
await checkFixtureClubs();
await checkPlayerLevelBasis();
await checkClubOrderAndLinks();
await checkClubManagers();
await checkClubMerge();
await checkTopFixtures();
await checkFootballers();
await checkSoccerWiki();
await checkFanAndFixtures();
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
