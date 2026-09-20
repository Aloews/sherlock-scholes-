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

// ⚠️ `||`, А НЕ `??`: пустая строка — это «переменную задали пустой», и
// `??` пропустила бы её дальше как настоящий адрес. Так и приходит
// значение из GitHub Actions, когда домен в форме не заполнили.
const APP = process.env.PROD_APP_URL || 'https://sherlock-scholes.vercel.app';
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
// ⚠️ РАЗДЕЛЫ ЗА ПОДПИСКОЙ ПРОВЕРЯЮТСЯ СЕРВИСНЫМ КЛЮЧОМ, И ЭТО НЕ ЛАЗЕЙКА.
// `player_index` закрыт `require_pro()`: аноним получает 401. Проверять его
// анонимом больше нельзя, а бросить проверку — значит потерять единственное
// сквозное подтверждение, что рейтинг вообще считается. Сервисная роль — это
// ключ владельца, он никогда не уезжает в браузер; им ходят бот и ночные
// задания, и ворота его пропускают по построению.
//
// ⚠️ КЛЮЧА НЕТ — ПРОВЕРКА КРАСНАЯ, А НЕ ЗЕЛЁНАЯ. Молча пропустить раздел
// значит получить ту самую зелёную пустоту, против которой написан этот файл.
function serviceKey() {
  return env('SUPABASE_SERVICE_KEY') || env('SUPABASE_KEY');
}

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
  // ⚠️ ЭКРАН РЕЙТИНГА ИГРОКОВ. Он падал у двух игроков из трёх, и снаружи это
  // выглядело как «статистика иногда не загружается»: 500 за 3.9 с при
  // анонимном потолке в три секунды. Причина была в группировке по широким
  // колонкам — агрегат выливался во временные файлы. Проверка ходит сюда
  // ИМЕННО анонимом, потому что под сервисным ключом таймаута нет вовсе.
  ['player_ratings',         { p_days: 7, p_limit: 50 },      'рейтинг игроков'],
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
// СОСТАВЫ: ОДИН ОТВЕТ НА ДВА ЭКРАНА, И В НЁМ СТОИМОСТЬ.
//
// ⚠️ ЗАЧЕМ ОТДЕЛЬНЫЙ РАЗДЕЛ, КОГДА ВЫШЕ УЖЕ ЕСТЬ «Полный состав клуба».
// Тот проверяет `club_roster_list` — заявку с Transfermarkt. Экран матча в
// неё НЕ ХОДИЛ вовсе: он звал `fixture_squads`, а та шла в `club_squad`
// (наши карточки). У «Брайтона» заявка на 30 человек — и зелёная проверка
// заявки ровно ничего не говорила о том, что под матчем состава нет.
//
// Здесь проверяется ТОТ путь, которым идёт экран: имя команды из расписания →
// ключ клуба → состав со стоимостями.
// ---------------------------------------------------------------------------
async function checkFixtureSquads() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Составы матчей', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
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

  // ⚠️ ИМЕННО «БРАЙТОН», И ЭТО НЕ СЛУЧАЙНЫЙ КЛУБ. На нём и было видно
  // расхождение: заявка на 30 человек, а `fixture_squads` отдавала ноль,
  // потому что расписание зовёт его «Brighton and Hove Albion» (ключ
  // `brighton and hove albion`), а заявка лежит под `brighton hove albion`.
  const brighton = await call('club_squad_view', { p_club_key: 'brighton hove albion' });
  const priced = (brighton ?? []).filter((r) => r.market_value_eur != null).length;
  record('Составы: club_squad_view отвечает заявкой', (brighton?.length ?? 0) >= 20,
         `${brighton?.length ?? 0} игроков, ${priced} с ценой`,
         'спрашивается ЧИСЛО: «состав есть» зеленело бы и на четырёх');

  // Ближайшие матчи — на них и смотрит человек.
  const fr = await fetch(
    `${url}/rest/v1/fixtures?select=id,home_team,away_team&commence_at=gt.${new Date().toISOString()}&order=commence_at.asc&limit=40`,
    { headers: auth },
  );
  const fixtures = await fr.json().catch(() => null);
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    record('Составы: ближайшие матчи', false, 'расписание не отдаёт матчей', 'ключ anon');
    return;
  }

  let both = 0;
  let withValue = 0;
  let ms = 0;
  for (const f of fixtures) {
    const t0 = Date.now();
    const rows = await call('fixture_squads', { p_fixture_id: f.id, p_lang: 'ru' });
    ms = Math.max(ms, Date.now() - t0);
    const home = (rows ?? []).filter((r) => r.side === 'home').length;
    const away = (rows ?? []).filter((r) => r.side === 'away').length;
    if (home > 0 && away > 0) both += 1;
    if ((rows ?? []).some((r) => r.market_value_eur != null)) withValue += 1;
  }
  const share = both / fixtures.length;
  // Порог 0.6: на замере 12.09.2026 выходило 0.77, а до правки — 0.56. То
  // есть порог отделяет починенное от сломанного, а не поставлен «с запасом».
  record('Составы: обе стороны у большинства матчей', share >= 0.6,
         `${both} из ${fixtures.length} матчей с обеими сторонами, ${withValue} со стоимостью`,
         'до правки было 56% — порог отделяет починенное от сломанного');

  record('Составы: укладываются в лимит anon', ms < 2500,
         `${ms} мс на самый медленный из ${fixtures.length}`,
         'у ключа anon потолок 3 с, и состав раскрывается по нажатию');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: у выдуманного клуба и выдуманного матча
  // состава быть не может. Без него всё выше зеленело бы и на функции,
  // которая отдаёт что попало.
  const ghostClub = await call('club_squad_view', { p_club_key: 'клуб-которого-нет' });
  const ghostFix = await call('fixture_squads', { p_fixture_id: 'матча-нет', p_lang: 'ru' });
  const empty = ghostClub !== null && ghostClub.length === 0
             && ghostFix !== null && ghostFix.length === 0;
  record('Составы: контроль выдуманного', empty,
         empty ? 'по выдуманным клубу и матчу пусто, как и должно'
               : 'состав нашёлся там, где его нет',
         empty ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');

  // ⚠️ ВТОРОЙ КОНТРОЛЬ — К ПСЕВДОНИМАМ, и он о другом. Выше проверено, что
  // состав находится; здесь — что он находится ИМЕННО ПО ИМЕНИ ИЗ
  // РАСПИСАНИЯ. Без псевдонима `resolve_club_key` отдаёт ключ, которого нет
  // ни в одной заявке, и обе стороны просто пустеют — молча.
  const named = await call('club_squad_view', { p_club_key: 'brighton and hove albion' });
  record('Составы: контроль псевдонима', (named?.length ?? 0) === 0,
         (named?.length ?? 0) === 0
           ? 'сырой ключ из расписания сам по себе состава не даёт — его даёт псевдоним'
           : 'сырой ключ отдал состав: проверка псевдонима ничего не проверяет',
         (named?.length ?? 0) === 0 ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
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
  // player_index ушёл за подписку — см. serviceKey() выше.
  const key = serviceKey();
  if (!url || !key) {
    record('Общий рейтинг', false,
           key ? 'нет VITE_SUPABASE_URL в окружении'
               : 'нет SUPABASE_KEY: раздел за подпиской, анонимом его не проверить',
           'н/д');
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

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: два «Манчестера» НЕ ДОЛЖНЫ получить ОДНУ И ТУ ЖЕ
  // ленту. Отбор по любой основе имени дал бы им общий список — и болельщик
  // Сити читал бы новости Юнайтед на своём экране.
  //
  // ⚠️ НО ОБЩИЙ ЗАГОЛОВОК САМ ПО СЕБЕ НЕ ПОЛОМКА, и раньше проверка считала
  // иначе — требовала `overlap === 0` и краснела на ровном месте. Замер
  // 12.09.2026, оба общих заголовка: «Kings of Manchester: Who will reign when
  // United and City clash?» и «Тренер „Манчестер Сити“ Мареска заявил, что
  // О'Райли готов к дерби с „Манчестер Юнайтед“». Это дерби: в них
  // ДЕЙСТВИТЕЛЬНО обе команды, и выбросить их значило бы спрятать от
  // болельщика главную новость недели.
  //
  // Различает команды не отсутствие пересечения, а наличие СВОЕГО: у каждой
  // стороны обязано быть то, чего нет у другой. Полное совпадение лент —
  // поломка; частичное на дерби — работа.
  const onlyCity = city.filter((n) => !new Set(utd.map((u) => u.url)).has(n.url)).length;
  const onlyUtd = utd.filter((n) => !cityUrls.has(n.url)).length;
  const distinct = city.length > 0 && utd.length > 0 && onlyCity > 0 && onlyUtd > 0;
  record('Новости команды: контроль различения', distinct,
         `своих у «Сити» ${onlyCity}, у «Юнайтед» ${onlyUtd}, общих (дерби) ${overlap}`,
         distinct ? 'проверка способна упасть' : '⚠ ОТБОР НЕ РАЗЛИЧАЕТ КОМАНДЫ');

  // ⚠️ ВТОРОЙ КОНТРОЛЬ, И ОН ПРО ОПАСНУЮ СТОРОНУ ОТБОРА. Пустой набор основ
  // имени НЕ ДОЛЖЕН подходить ко всему подряд: `x @> '{}'` истинно для любой
  // строки, и клуб без имени собрал бы всю ленту целиком. Отсечение пустой
  // стороны в `club_news` сделано через `nullif` — ради индекса, — и эта
  // строка сторожит, что оно не потерялось при следующей правке ради скорости.
  // ⚠️ `rows === null` — ЭТО ОТКАЗ ЗАПРОСА, А НЕ ПУСТОЙ ОТВЕТ, и считать его
  // успехом нельзя: тогда проверка зеленела бы ровно тогда, когда сломана.
  const ghost = (await rpc('club_news', { p_club_key: 'нет-такого-клуба', p_limit: 20 })).rows;
  const ghostOk = Array.isArray(ghost) && ghost.length === 0;
  record('Новости команды: контроль пустого имени', ghostOk,
         ghost === null ? 'запрос club_news отказал — проверить нечего'
           : ghostOk ? 'по выдуманному клубу ноль заметок, как и должно'
                     : `выдуманный клуб получил ${ghost.length} заметок — `
                       + 'пустой набор основ подходит ко всему',
         ghostOk ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');

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

  // ⚠️ ЭТИ ДВА RPC УШЛИ ЗА ПОДПИСКУ, и анонимом они теперь отвечают 401
  // `pro_required`. Мерить их всё равно надо: у подписчика экран обязан
  // открываться в срок, и порог здесь — про скорость, а не про доступ. Ключ
  // владельца ворота пропускают по построению (см. serviceKey выше).
  const PRO_FNS = new Set(['player_index', 'player_index_count']);
  const proKey = serviceKey();
  const authFor = (fn) => {
    if (!PRO_FNS.has(fn) || !proKey) return auth;
    return { apikey: proKey, Authorization: `Bearer ${proKey}`,
             'Content-Type': 'application/json' };
  };

  /** Вызов RPC: сколько миллисекунд и что вернулось. */
  const timed = async (fn, body, select = '') => {
    const q = select ? `?select=${encodeURIComponent(select)}` : '';
    const t0 = Date.now();
    let r, parsed = null;
    try {
      r = await fetch(`${url}/rest/v1/rpc/${fn}${q}`, {
        method: 'POST', headers: authFor(fn), body: JSON.stringify(body),
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
    // ⚠️ КАТЕГОРИИ ПОИМЁННО, И ИМЕННО ЭТИХ ДВУХ ЗДЕСЬ НЕ БЫЛО. Владелец:
    // «„коллекции“ очень сильно зависают, когда нажимаешь на какую либо
    // категорию „термины“ или „клубы“». Замер 12.09.2026 до правки: 1812 мс на
    // `collection_page('term')` и 445 мс на фасеты к ней — при 84 терминах в
    // колоде. Проверка «Все» этого не ловила ВООБЩЕ: там категории нет, и
    // обобщённый план на ней не вредит. Категория, которую никто не измеряет,
    // и была единственной, что ломалась.
    ['коллекция, «Термины»', 'collection_page',
      { p_lang: 'ru', p_category: 'term', p_query: null, p_limit: 48, p_offset: 0,
        p_club_key: null, p_league: null, p_country: null },
      `${COLUMNS},card_translations(*)`],
    ['коллекция, «Клубы»', 'collection_page',
      { p_lang: 'ru', p_category: 'club', p_query: null, p_limit: 48, p_offset: 0,
        p_club_key: null, p_league: null, p_country: null },
      `${COLUMNS},card_translations(*)`],
    ['фасеты категории «Термины»', 'collection_facets', { p_category: 'term' }, ''],
    ['фасеты категории «Клубы»', 'collection_facets', { p_category: 'club' }, ''],
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

// ------------------------------ поиск в коллекции: экранирование ----------
// ⚠️ ЭТА ПРОВЕРКА ПОЯВИЛАСЬ ВМЕСТЕ С ДИНАМИЧЕСКИМ ЗАПРОСОМ, И БЕЗ НЕЁ ЕГО
// НЕЛЬЗЯ БЫЛО БЫ ДЕРЖАТЬ. `collection_page` теперь собирает текст запроса под
// заданные параметры (иначе категория стоила 1812 мс — см.
// collection_dynamic_plan.sql), а строку поиска пишет читатель. Экранирует её
// `format(%L)`, и это надо ПРОВЕРЯТЬ на боевой базе, а не принимать на веру:
// подстановка без экранирования выглядит точно так же и работает ровно до
// первой кавычки.
async function checkCollectionSearchEscaping() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Поиск в коллекции', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const page = async (q) => {
    const r = await fetch(`${url}/rest/v1/rpc/collection_page`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({
        p_lang: 'ru', p_category: 'player', p_query: q, p_limit: 48, p_offset: 0,
        p_club_key: null, p_league: null, p_country: null, p_sort: null,
      }),
    });
    const body = r.ok ? await r.json().catch(() => null) : null;
    return { ok: r.ok, n: Array.isArray(body) ? body.length : -1, status: r.status };
  };

  // Апостроф в имени — не диверсия, а обычный игрок: O'Neill, N'Golo, O'Shea.
  const quote = await page("O'Neill");
  record('Поиск в коллекции: апостроф в имени', quote.ok && quote.n > 0,
         quote.ok ? `${quote.n} карточек по «O'Neill»` : `отказ ${quote.status}`,
         'ловит сломанное экранирование: без него запрос падает с ошибкой разбора');

  // ⚠️ ПОПЫТКА ВПРЫСКА ОБЯЗАНА ДАТЬ ПУСТО, А НЕ ВСЮ КОЛОДУ. Если бы строка
  // склеивалась в текст запроса без `%L`, это условие стало бы истинным для
  // каждой строки и вернуло бы полную страницу — 48 карточек.
  const inject = await page("' or 1=1 --");
  record('Поиск в коллекции: впрыск не проходит', inject.ok && inject.n === 0,
         inject.ok ? `«' or 1=1 --» вернул ${inject.n} карточек`
                   : `отказ ${inject.status}`,
         inject.n === 0 ? 'ловит подстановку без экранирования'
                        : '⚠ СТРОКА ПОИСКА ПОПАДАЕТ В ЗАПРОС КАК КОД');

  // Отрицательный контроль к самой проверке: обычная строка обязана что-то
  // находить, иначе «ноль» выше зелен от того, что поиск сломан вообще.
  const plain = await page('месси');
  record('Поиск в коллекции: контроль различения', plain.ok && plain.n > 0,
         plain.ok ? `обычный запрос «месси» вернул ${plain.n}` : `отказ ${plain.status}`,
         plain.n > 0 ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
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

// ------------------------------------------ обзоры туров на своём языке ----
// Владелец прислал три адреса с обзорами туров РПЛ. Два из трёх недоступны
// (капча Yandex у premierliga.ru, js-challenge у okko.sport — разбор в
// rutube_clips.sql), третий — канал самой лиги на Rutube, и он живой.
//
// ⚠️ ПРОВЕРЯЕТСЯ НЕ «РОЛИКИ ЛЕЖАТ В БАЗЕ», А «ЧИТАТЕЛЬ ИХ УВИДИТ». Именно
// здесь всё и ломалось в первый раз: строки записались, а в общем топе их было
// РОВНО НОЛЬ — просмотры не сравнимы между каналами разного размера. Поэтому
// проверка идёт до того самого вызова, который делает экран.
async function checkLocalGoals() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Обзоры на своём языке', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const rpc = async (name, body) => {
    const r = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: auth, body: JSON.stringify(body),
    });
    return r.ok ? r.json().catch(() => null) : null;
  };

  const t0 = Date.now();
  const ru = await rpc('digest_local_goals', { p_lang: 'ru', p_limit: 12 });
  const ms = Date.now() - t0;
  const list = Array.isArray(ru) ? ru : [];
  record('Обзоры на своём языке: раздел не пуст', list.length > 0,
         `${list.length} роликов на ru, ${ms} мс`,
         'ловит замолчавший канал Rutube и отозванный грант');

  // ⚠️ ДО КОНЦА ЦЕПОЧКИ: строка есть — а ссылка в ней может вести на YouTube
  // по идентификатору Rutube, то есть в никуда. Видно это только по нажатию.
  const rutube = list.filter((r) => String(r.watch_url || '').startsWith('https://rutube.ru/video/'));
  record('Обзоры на своём языке: ссылка ведёт на Rutube',
         list.length > 0 && rutube.length === list.length,
         `${rutube.length} из ${list.length} с адресом Rutube`,
         'ловит возврат к безусловному шаблону youtube.com/watch?v=');

  // Обзор тура обязан читаться как гол/обзор, иначе на карточке встанет
  // пометка «момент» у всего подряд.
  const asGoal = list.filter((r) => r.is_goal).length;
  record('Обзоры на своём языке: разбор заголовка', list.length > 0 && asGoal > 0,
         `${asGoal} из ${list.length} распознаны как гол или обзор`,
         'ловит выпавшие русские слова из looks_like_goal');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ ПЕРВЫЙ: выдуманный язык обязан дать пусто. Не
  // дал — функция отдаёт всё подряд, и «на вашем языке» значит «что угодно».
  const bogus = await rpc('digest_local_goals', { p_lang: 'зз', p_limit: 12 });
  const empty = Array.isArray(bogus) && bogus.length === 0;
  record('Обзоры на своём языке: контроль отбора', empty,
         empty ? 'по выдуманному языку пусто, как и должно'
               : `выдуманный язык вернул ${Array.isArray(bogus) ? bogus.length : '?'} строк`,
         empty ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ ВТОРОЙ, И ОН ПРО NULL. У семнадцати каналов
  // YouTube язык не задан; если бы `lang = null` совпадало с ними, раздел
  // «на вашем языке» показывал бы итальянскую «Серию А» испанцу.
  const nulled = await rpc('digest_local_goals', { p_lang: null, p_limit: 12 });
  const nullEmpty = Array.isArray(nulled) && nulled.length === 0;
  record('Обзоры на своём языке: контроль NULL', nullEmpty,
         nullEmpty ? 'по пустому языку пусто, как и должно'
                   : `пустой язык вернул ${Array.isArray(nulled) ? nulled.length : '?'} строк`,
         nullEmpty ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

// ------------------------------------------------ характер матча ----------
// Владелец: «доделай анализ характера матча по кнопке в прогнозах».
//
// ⚠️ ПРОВЕРЯЕТСЯ НЕ «RPC ОТВЕЧАЕТ», А ТО, ЧТО ОТВЕТ ГОДЕН ДЛЯ ЭКРАНА. Первый
// же боевой прогон этой функции показал по «Барселоне» ТРЕНЕРА ЭКВАДОРСКОГО
// клуба: имя лежало в двух местах, и снимок отставал. Поэтому здесь есть
// отдельная проверка на тренера — она бы это поймала.
async function checkMatchCharacter() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Характер матча', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const rpc = async (name, body) => {
    const r = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: auth, body: JSON.stringify(body),
    });
    return r.ok ? r.json().catch(() => null) : null;
  };

  const soon = await fetch(
    `${url}/rest/v1/fixtures?select=id&commence_at=gt.${new Date().toISOString()}&order=commence_at.asc&limit=40`,
    { headers: auth },
  ).then((r) => (r.ok ? r.json().catch(() => null) : null));
  const ids = Array.isArray(soon) ? soon.map((f) => f.id) : [];
  if (ids.length === 0) {
    record('Характер матча', false, 'ближайших матчей нет вовсе — проверять нечего', 'н/д');
    return;
  }

  // Матчи перебираются по одному, пока не найдётся измеренный: характер есть у
  // 366 клубов, и у доброй половины ближайших матчей одна сторона без него.
  // Это норма, а не поломка, — но проверять содержимое надо на измеренном.
  let measured = null;
  let ms = 0;
  let tried = 0;
  for (const id of ids.slice(0, 12)) {
    const t0 = Date.now();
    const rows = await rpc('match_character', { p_fixture_id: id, p_lang: 'ru' });
    ms = Math.max(ms, Date.now() - t0);
    tried += 1;
    const row = Array.isArray(rows) ? rows[0] : null;
    if (row && row.expected_goals !== null) { measured = row; break; }
  }

  record('Характер матча: измеренный матч находится', measured !== null,
         measured ? `${measured.home_name} — ${measured.away_name}, ожидание ${measured.expected_goals} гола, открытость ${measured.openness}`
                  : `на ${tried} ближайших матчах характера нет ни у одного`,
         'ловит пустой club_character и отозванный грант');

  // ⚠️ ВРЕМЯ, А НЕ ТОЛЬКО СОДЕРЖИМОЕ. Внутри вызова сидят новости обоих клубов
  // (217 мс на клуб), и лимит anon — три секунды. Порог 1500 мс вдвое ниже
  // лимита, чтобы отставание краснело, пока запас ещё есть.
  //
  // ⚠️ ПЕРВЫЙ ЗАХОД ВЫБРАСЫВАЕТСЯ, И ЭТО НЕ ПОБЛАЖКА. В нём сидит установка
  // соединения и TLS — цена ЭТОЙ машины до Supabase, а не цена вызова. Раньше
  // бралcя `Math.max` по всем попыткам, то есть как раз холодная; проверка
  // краснела с 1615 мс там, где установившееся время 840–1220 мс. Замер
  // 13.09.2026 по четырём матчам, четыре захода на каждый.
  //
  // Берётся ХУДШЕЕ из трёх прогретых, а не лучшее: у зрителя бывает и
  // худшее, и запас до лимита нужен именно под него.
  if (measured) {
    const warm = [];
    for (let i = 0; i < 4; i += 1) {
      const t0 = Date.now();
      await rpc('match_character', { p_fixture_id: measured.fixture_id, p_lang: 'ru' });
      if (i > 0) warm.push(Date.now() - t0);
    }
    ms = Math.max(...warm);
  }
  // ⚠️ ПОРОГ СНИЖЕН С 1500 ДО 600, И ЭТО НЕ УЖЕСТОЧЕНИЕ РАДИ УЖЕСТОЧЕНИЯ.
  // 1500 был подобран под ту цену, которую вызов имел с неиндексированным
  // `club_news`: 1.6 секунды на матч, из них 750 мс на клуб. После индекса по
  // `digest_tokens(title)` вызов стоит 164 мс — и прежний порог перестал бы
  // ловить что-либо вовсе: под ним уместился бы даже возврат полного перебора.
  // Порог, который не может сработать, — пустая проверка.
  record('Характер матча: укладывается в лимит anon', ms > 0 && ms < 600,
         `${ms} мс на вызов (худший из трёх прогретых)`,
         'ловит потерянный индекс news_items_tokens_idx и возврат полного перебора');

  // ⚠️ ТРЕНЕР — ОТДЕЛЬНОЙ ПРОВЕРКОЙ, И ВОТ ПОЧЕМУ. Он читается из club_manager;
  // копия в club_character убрана как раз потому, что отставала на 35 клубах.
  // Вернётся копия — вернётся и чужой тренер, а по виду блок будет исправен.
  if (measured) {
    const both = Boolean(measured.home_manager) && Boolean(measured.away_manager);
    record('Характер матча: тренеры обеих сторон', both,
           both ? `${measured.home_manager} и ${measured.away_manager}`
                : `дома «${measured.home_manager ?? '—'}», в гостях «${measured.away_manager ?? '—'}»`,
           'ловит развалившуюся связь club_manager с клубом');
  }

  // ⚠️ ТОЧКА ОТСЧЁТА И ФОРМА — ТО, ЧЕМ ЗАМЕНЕНЫ ОБЩИЕ СЛОВА. Владелец:
  // «Комментарий "Голов ожидаемо столько же, сколько в обычном матче" звучит
  // поиздевательски и несёт очень мало информации… либо просто добавить сухую
  // статистику». Фраза убрана; вместо неё два числа рядом и пять букв формы.
  // Если медиана перестанет считаться, экран тихо вернётся к одному числу без
  // точки отсчёта — то есть ровно к тому, на что жаловались.
  if (measured) {
    record('Характер матча: есть точка отсчёта', measured.goals_median !== null,
           measured.goals_median !== null
             ? `ожидание ${measured.expected_goals} против обычных ${measured.goals_median}`
             : 'медиана не посчиталась — число осталось без сравнения',
           'ловит пустой club_character под медианой');

    const formOk = (v) => v === null || /^[WDL]{0,5}$/.test(v);
    const forms = [measured.home_form, measured.away_form];
    record('Характер матча: форма читается',
           forms.every(formOk) && forms.some((v) => (v ?? '').length > 0),
           `${measured.home_form ?? '—'} / ${measured.away_form ?? '—'}`,
           'ловит чужие буквы из club_match и развалившийся порядок');
  }

  // ⚠️ ГЛАВНАЯ ПРОВЕРКА ЭТОГО РАЗДЕЛА, И ОНА ПО ЖАЛОБЕ ВЛАДЕЛЬЦА: «в „пишут“
  // везде новости об анонсе матча и где его посмотреть». Отбор делает
  // `news_about_play`; здесь он проверяется НА НАСТОЯЩИХ ЗАГОЛОВКАХ, снятых с
  // боевой ленты, и обе половины служат контролем друг другу: если предикат
  // умрёт в ноль — провалится вторая, если начнёт пропускать всё —
  // провалится первая.
  const ANNOUNCEMENTS = [
    '«Леванте» — «Барселона»: во сколько начало матча Ла Лиги, где смотреть трансляцию',
    '«Спартак» — «Ростов»: онлайн-трансляция матча 8-го тура РПЛ-2026/2027 начнётся в 17:00',
    'Celta de Vigo - Málaga, en directo | Sigue en vivo, el partido de LaLiga EA Sports',
    'Coventry vs Brighton team news LIVE!',
    'Rangers v Celtic: Scottish League Cup quarter-final – live',
  ];
  const ABOUT_PLAY = [
    '«Мы показали прекрасную игру». Тренер «Комо» Фабрегас — о матче с «РБ Лейпциг» в ЛЧ',
    '«Мы хотим сделать небо голубым». Буадди — о манчестерском дерби',
    'Le Borussia Mönchengladbach se sépare déjà de son entraîneur',
    'Pep Guardiola explains his new high press',
  ];
  const score = async (title) => rpc('news_about_play', { p_title: title, p_manager: null });

  const passedAnnouncements = [];
  for (const title of ANNOUNCEMENTS) {
    if (Number(await score(title)) > 0) passedAnnouncements.push(title);
  }
  record('Характер матча: анонсы отброшены', passedAnnouncements.length === 0,
         passedAnnouncements.length === 0
           ? `${ANNOUNCEMENTS.length} анонсов, ни один не прошёл`
           : `прошло ${passedAnnouncements.length}: «${passedAnnouncements[0].slice(0, 50)}»`,
         'ловит возврат «где смотреть» в блок про характер игры');

  const droppedPlay = [];
  for (const title of ABOUT_PLAY) {
    if (Number(await score(title)) <= 0) droppedPlay.push(title);
  }
  record('Характер матча: слова тренера проходят', droppedPlay.length === 0,
         droppedPlay.length === 0
           ? `${ABOUT_PLAY.length} заголовков про игру, прошли все`
           : `отброшено ${droppedPlay.length}: «${droppedPlay[0].slice(0, 50)}»`,
         'ловит предикат, который отбрасывает вообще всё');

  // И то же самое, но на том, что ДЕЙСТВИТЕЛЬНО дошло до экрана: ни один
  // показанный заголовок не имеет права быть анонсом.
  let shown = 0;
  const bad = [];
  for (const id of ids.slice(0, 12)) {
    const rows = await rpc('match_character', { p_fixture_id: id, p_lang: 'ru' });
    const r = Array.isArray(rows) ? rows[0] : null;
    for (const [head, sc] of [[r?.home_headline, r?.home_headline_score],
                              [r?.away_headline, r?.away_headline_score]]) {
      if (!head) continue;
      shown += 1;
      if (!(Number(sc) > 0)) bad.push(head);
    }
  }
  record('Характер матча: показанные новости — про игру',
         bad.length === 0,
         shown > 0 ? `${shown} заголовков на 12 матчах, анонсов среди них ${bad.length}`
                   : 'ни одного заголовка не показано — это тоже ответ',
         'ловит заголовок, попавший на экран мимо отбора');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: выдуманный матч обязан дать пусто. Не дал —
  // функция отвечает не на то, о чём её спросили.
  const bogus = await rpc('match_character', { p_fixture_id: 'нет-такого-матча-zz', p_lang: 'ru' });
  const empty = Array.isArray(bogus) && bogus.length === 0;
  record('Характер матча: контроль отбора', empty,
         empty ? 'по выдуманному матчу пусто, как и должно'
               : `выдуманный матч вернул ${Array.isArray(bogus) ? bogus.length : '?'} строк`,
         empty ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

// ------------------------------------------- позвать своих по клубу -------
// Владелец: «возможность добавления в комнату … фанаты команды, той или иной».
//
// ⚠️ ПРОВЕРЯЕТСЯ ИМЕННО ОТКАЗ, И ЭТО ЗДЕСЬ ГЛАВНОЕ. Функция читает `players`
// за игрока (security definer), то есть отдаёт ИМЕНА. Единственное, что стоит
// между ней и перечислением чужих людей, — проверка подписи Telegram. Если
// она отвалится, функция начнёт отвечать, и внешне это будет выглядеть как
// «работает».
async function checkClubFansInvite() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Свои по клубу', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const r = await fetch(`${url}/rest/v1/rpc/club_fans_to_invite`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_init_data: 'подделка',
      p_room_id: '00000000-0000-0000-0000-000000000000',
      p_limit: 5,
    }),
  });
  const body = await r.json().catch(() => null);
  const refused = r.status >= 400 && body && body.code === '28000';
  record('Свои по клубу: подделанная подпись отбита', refused,
         refused ? 'ответ 28000 «invalid init data», как и должно'
                 : `код ${r.status}, тело ${JSON.stringify(body).slice(0, 120)}`,
         refused ? 'ловит отвалившуюся проверку подписи — то есть утечку имён'
                 : '⚠ ФУНКЦИЯ ОТВЕЧАЕТ БЕЗ ПОДПИСИ');

  // Отрицательный контроль к самой проверке: та же ручка с ПУСТЫМ телом
  // обязана отвечать иначе — иначе проверка выше зелена от того, что любой
  // запрос сюда падает, а не от того, что подпись проверяется.
  const r2 = await fetch(`${url}/rest/v1/rpc/club_fans_to_invite`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const b2 = await r2.json().catch(() => null);
  const other = !b2 || b2.code !== '28000';
  record('Свои по клубу: контроль различения', other,
         other ? `без аргументов ответ иной (${r2.status})`
               : 'без аргументов тот же 28000 — проверка не различает причины',
         other ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
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
  // ⚠️ СТОИМОСТЬ И УРОВЕНЬ ОБЯЗАНЫ СМОТРЕТЬ В ОДНУ СТОРОНУ, НО НЕ СОВПАДАТЬ.
  // Сортирует стоимость; уровень считается независимо, и если бы дорогие
  // клубы выходили слабыми, значит сломано одно из двух. Сравниваются средние
  // по верхней и нижней десятке, а не строка со строкой: требовать от
  // округлённого уровня монотонности — значит проверять округление.
  const lv = rows.map((r) => r.level ?? -1).filter((v) => v >= 0);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const topAvg = avg(lv.slice(0, 10));
  const botAvg = avg(lv.slice(-10));
  // ⚠️ ПЕРВЫМ КЛЮЧОМ — СТОИМОСТЬ СОСТАВА. Владелец: «сделаем основным
  // рейтингом всего для всех экранов именно стоимость». Она непрерывна, и
  // порядок по ней проверяется прямо: не возрастает по списку.
  const vals = rows.map((r) => Number(r.squad_value ?? -1));
  let byValue = true;
  for (let i = 1; i < vals.length; i++) if (vals[i - 1] < vals[i]) { byValue = false; break; }
  record('Порядок команд: по стоимости состава', rows.length > 5 && byValue,
         rows.length === 0 ? 'список пуст'
           : `первая — ${rows[0].name}, ${Math.round(vals[0] / 1e6)} млн; последняя ${Math.round(vals[vals.length - 1] / 1e6)} млн`,
         'ловит возврат к сортировке по уровню или по размеру выгрузки');

  record('Порядок команд: дорогие они же и сильные', lv.length >= 20 && topAvg > botAvg,
         lv.length < 20 ? `уровень известен лишь у ${lv.length} клубов списка`
           : `средний уровень верхней десятки ${Math.round(topAvg)}, нижней ${Math.round(botAvg)}`,
         'ловит разъехавшиеся стоимость и уровень — сломано одно из двух');

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
  // ⚠️ СОСТАВ — С SOCCER WIKI. Владелец: «заполни составы с Soccer Wiki, а
  // стоимость отображай с трансфермаркет». Проверяется, что источник стал
  // ГЛАВНЫМ ПО ОБЪЁМУ, а не просто объявлен главным на словах.
  const bySrc = async (src) => {
    const r = await fetch(`${url}/rest/v1/card_current_club?select=card_id&source=eq.${src}&limit=1`,
      { headers: { ...auth, Prefer: 'count=exact' } });
    const n = Number((r.headers.get('content-range') ?? '').split('/')[1]);
    return Number.isFinite(n) ? n : -1;
  };
  const sw = await bySrc('soccerwiki');
  const tm = await bySrc('club_roster');
  record('Состав: Soccer Wiki — главный источник', sw > tm && sw > 5000,
         `soccerwiki ${sw}, заявка Transfermarkt ${tm}`,
         'ловит ночной шаг, переставший заливать составы из Soccer Wiki');

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
  // ⚠️ СРАВНИВАЕТСЯ КЛЮЧ, А НЕ ПОКАЗЫВАЕМОЕ ИМЯ. Имя теперь латиницей и может
  // совпасть с искомой строкой само по себе — тогда проверка ничего не
  // доказывает. Ключ же говорит, на КАКОЙ клуб легло имя: у двойника он был
  // свой, у канонического — наш.
  const cases = [
    ['Bayern München', 'bayern munich'],
    ['Olympique Marseille', 'olympique de marseille'],
    ['Inter Milan', 'internazionale'],
  ];
  const bad = [];
  for (const [swName, ourKey] of cases) {
    const rows = await rpc('club_directory', { p_lang: 'ru', p_query: swName, p_limit: 3 });
    const got = Array.isArray(rows) && rows[0] ? rows[0].club_key : null;
    if (got !== ourKey) bad.push(`${swName} -> ${got ?? 'никуда'} (ждали ${ourKey})`);
  }
  record('Склейка клубов: имя источника ведёт на наш клуб', bad.length === 0,
         bad.length === 0 ? cases.map(([a, b]) => `${a} = ${b}`).join(', ') : bad.join('; '),
         'ловит новый сбор, заведший двойника заново без псевдонима');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: выдуманное имя обязано дать ПУСТО. Поиск,
  // который на любую строку возвращает первый попавшийся клуб, сделал бы
  // проверку выше бессмысленной.
  const ghost = await rpc('club_directory', { p_lang: 'ru', p_query: 'Такого Клуба Нет ZZ', p_limit: 3 });
  const ghostEmpty = Array.isArray(ghost) && ghost.length === 0;
  // ⚠️ ИМЕНА КЛУБОВ — ЛАТИНИЦЕЙ. Владелец: «переводи только интерфейс, имена
  // больше не переводи, пиши их латиницей». Русское имя остаётся запасным для
  // тех, у кого латиницы нет вовсе (639 клубов), поэтому проверяется ДОЛЯ, а
  // не «ни одной кириллической буквы».
  const top = await rpc('club_directory', { p_lang: 'ru', p_limit: 40, p_kind: 'club' });
  const names = Array.isArray(top) ? top.map((r) => r.name ?? '') : [];
  const cyr = names.filter((n) => /[А-Яа-яЁё]/.test(n));
  record('Имена клубов: латиница', names.length > 0 && cyr.length <= names.length * 0.2,
         `${names.length - cyr.length} из ${names.length} латиницей` +
           (cyr.length ? `; кириллицей ещё ${cyr.slice(0, 3).join(', ')}` : ''),
         'ловит возврат club_display_name к переводу имени');

  // ⚠️ ССЫЛКА НА УДАЛЁННЫЙ КЛУБ ХУЖЕ ОТСУТСТВИЯ ССЫЛКИ. Склейка убирает
  // строку-двойника, и всё, что на неё указывало, начинает вести в никуда:
  // карточка показывает пустоту там, где был клуб. Так и вышло — 41 строка
  // card_current_club осталась висеть после первой склейки.
  const orphans = await rpc('orphan_club_refs', {});
  const bad2 = Array.isArray(orphans) ? orphans.filter((r) => (r.сколько ?? 0) > 0) : null;
  record('Склейка клубов: ссылки не в никуда', bad2 != null && bad2.length === 0,
         bad2 == null ? 'orphan_club_refs не ответила'
           : bad2.length === 0 ? `все ${orphans.length} видов ссылок целы`
             : bad2.map((r) => `${r.место}: ${r.сколько}`).join(', '),
         'ловит склейку, забывшую перевести ссылки на канонический ключ');

  record('Склейка клубов: контроль поиска', ghostEmpty,
         ghostEmpty ? 'выдуманное имя не находит ни одного клуба, как и должно'
                    : `выдуманное имя нашло ${ghost?.[0]?.name ?? '?'}`,
         ghostEmpty ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

// ------------------------------------------------- характер команды -------
// Владелец: «характер тренера определяет характер команды, но характера
// тренеров меняются со временем». Поэтому характер не подписан, а СЧИТАЕТСЯ
// из матчей и пересобирается ночью. Разбор — supabase/migrations/club_character.sql.
//
// ⚠️ ПРОВЕРЯЕТСЯ НЕ «ЕСТЬ СТРОКА», А ЧТО СЛОВА СХОДЯТСЯ С ЧИСЛАМИ. Ярлык,
// который не следует из чисел рядом, — это мнение, выданное за наблюдение.
async function checkClubCharacter() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Характер команды', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}` };
  // ⚠️ ПОРЯДОК И ПОЛНЫЙ ОБЪЁМ — НЕ ПЕДАНТИЗМ. Раньше здесь стоял `limit=400`
  // БЕЗ order: PostgREST отдавал первые четыреста строк в физическом порядке
  // таблицы, и контроль редкости ниже получал «атакующих 0 из 400» при 120 из
  // 648 в самой таблице. То есть проверка краснела на ЗДОРОВЫХ данных — а это
  // хуже пустой: по ней перестают смотреть.
  //
  // Предел поднят до тысячи (это потолок PostgREST по db-max-rows) и клубов
  // сейчас 648. Перерастём тысячу — усечение вернётся, и заметит его строка
  // «посчитан»: она печатает, сколько строк пришло.
  const rows = await fetch(
    `${url}/rest/v1/club_character?select=club_key,matches,gf_pm,ga_pm,attack,defence,traits`
    + `&order=club_key.asc&limit=1000`,
    { headers: auth },
  ).then((r) => (r.ok ? r.json().catch(() => null) : null));
  const list = Array.isArray(rows) ? rows : [];

  record('Характер команды: посчитан', list.length >= 100,
         `${list.length} клубов с характером`,
         'ловит остановившуюся ночную пересборку и отозванный грант');

  // Слово обязано следовать из числа: у «атакующего» перцентиль атаки не
  // ниже 70, у «оборонительного» — обороны. Иначе ярлык живёт своей жизнью.
  const wrong = list.filter((r) => {
    const t = r.traits ?? [];
    if (t.includes('attacking') && (r.attack ?? 0) < 70) return true;
    if (t.includes('defensive') && (r.defence ?? 0) < 70) return true;
    if (t.includes('complete') && ((r.attack ?? 0) < 70 || (r.defence ?? 0) < 70)) return true;
    return false;
  });
  record('Характер команды: слова сходятся с числами', wrong.length === 0,
         wrong.length === 0 ? 'у всех черт есть число, из которого они следуют'
                            : `${wrong.length} строк с ярлыком не по числам`,
         'ловит разъехавшиеся пороги в SQL и на экране');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: черта обязана быть РЕДКОЙ. Порог 70/30 и
  // означает, что «атакующих» примерно треть, а не половина и не все. Если
  // ярлык стоит у подавляющего большинства — он ничего не различает, и
  // проверка выше зелена бессмысленно.
  const attacking = list.filter((r) => (r.traits ?? []).includes('attacking')).length;
  const share = list.length ? attacking / list.length : 0;
  record('Характер команды: контроль редкости', list.length > 0 && share > 0 && share < 0.5,
         `«атакующих» ${attacking} из ${list.length} (${Math.round(share * 100)}%)`,
         (share > 0 && share < 0.5) ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

// --------------------------------------- стоимость как мерило игрока -------
// Владелец: «скрой этот показатель [уровень] и основным сделай стоимость, она
// лучше отражает рейтинг игрока; нужно просто записывать изменение стоимости
// в карточке, так будет ясно повышается уровень игрока или нет».
async function checkCardValueTrend() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Стоимость карточки', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const rpc = async (name, body) => {
    const r = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: auth, body: JSON.stringify(body),
    });
    return r.ok ? r.json().catch(() => null) : null;
  };

  // Берём самого дорогого игрока из данных, а не по имени: имя устаревает.
  const top = await fetch(
    `${url}/rest/v1/cards?select=id,name_en,market_value_eur&category=eq.player&active=is.true&market_value_eur=not.is.null&order=market_value_eur.desc&limit=1`,
    { headers: auth },
  ).then((r) => (r.ok ? r.json().catch(() => null) : null));
  const card = Array.isArray(top) ? top[0] : null;
  if (!card) {
    record('Стоимость карточки', false, 'ни одной карточки со стоимостью', 'н/д');
    return;
  }

  const rows = await rpc('card_value_trend', { p_card_id: card.id, p_points: 8 });
  const row = Array.isArray(rows) ? rows[0] : null;
  record('Стоимость карточки: приходит', row != null && Number(row.value_eur) > 0,
         row ? `${card.name_en}: ${Math.round(Number(row.value_eur) / 1e6)} млн на ${row.value_at}` +
               (row.growth != null ? `, рост ${row.growth}` : ', истории роста пока нет')
             : 'card_value_trend не ответила',
         'ловит отозванный грант и опустевшую историю стоимостей');

  // ⚠️ ЭТА ПРОВЕРКА БЫЛА НЕВЕРНОЙ И КРАСНЕЛА НА ЗДОРОВЫХ ДАННЫХ. Она брала
  // последнюю запись `card_metric_history` и требовала, чтобы та была не
  // старше трёх дней — то есть читала ИСТОРИЮ ИЗМЕНЕНИЙ как ежедневный
  // снимок. А `snapshot_card_metrics` пишет строку ТОЛЬКО когда значение
  // изменилось (`l.value is distinct from n.value`): стоимости с
  // Transfermarkt меняются раз в месяц-полтора, и неделя без строк — это
  // нормальная неделя, а не остановившееся задание.
  //
  // Замер: «последняя запись 2026-09-07, 7 дн. назад» — и при этом
  // `card_metrics_today()` в ту же секунду отдавала 20 715 стоимостей. То
  // есть источник был жив, а проверка семь дней кричала о поломке. Красная
  // проверка на здоровых данных хуже пустой: по ней перестают смотреть.
  //
  // Смотреть надо на ЗАДАНИЕ, а не на данные: успевало ли оно отработать.
  const runs = await fetch(
    `${url}/rest/v1/rpc/snapshot_freshness`,
    { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{}' },
  ).then((r) => (r.ok ? r.json().catch(() => null) : null));
  const fresh = Array.isArray(runs) ? runs[0] : null;
  const ranDays = fresh && fresh.last_success ? fresh.hours_ago / 24 : 999;
  record('Снимок показателей: задание отработало', ranDays <= 1.5,
         fresh && fresh.last_success
           ? `snapshot_card_metrics отработал ${Math.round(fresh.hours_ago)} ч назад, `
             + `у ${fresh.measured_today} карточек есть стоимость`
           : 'нет ни одного успешного прогона',
         'ловит остановившийся snapshot_card_metrics — без него роста не будет никогда');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ К НЕМУ: задание может отрабатывать и писать
  // пустоту. Источник обязан отдавать стоимости ПРЯМО СЕЙЧАС — иначе завтра
  // задание запишет нули, и «отработало» будет правдой без смысла.
  record('Снимок показателей: контроль — источник жив',
         !!fresh && Number(fresh.measured_today) > 1000,
         fresh ? `${fresh.measured_today} карточек со стоимостью в cards`
               : 'snapshot_freshness не ответила',
         'ловит живое задание над опустевшим источником');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: выдуманная карточка обязана дать пусто.
  const bogus = await rpc('card_value_trend',
    { p_card_id: '00000000-0000-0000-0000-000000000000', p_points: 4 });
  const b = Array.isArray(bogus) ? bogus[0] : null;
  const empty = b == null || b.value_eur == null;
  record('Стоимость карточки: контроль отбора', empty,
         empty ? 'по выдуманной карточке пусто, как и должно'
               : `выдуманная карточка вернула ${b?.value_eur}`,
         empty ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

// ------------------------------------------------------------- печать -------
console.log(`\nПроверка прода: ${APP}\n`);

// -------------------------------------------------- комната болельщиков ---
// Владелец: «добавь комнату болельщиков для команд, где можно было изучить
// состав команды, новости и обсудить их».
//
// ⚠️ ПРОВЕРЯЕТСЯ ТО, ЧТО СЛОМАТЬ СТРАШНЕЕ ВСЕГО: комната НЕ ОТДАЁТСЯ
// анонимному ключу. В её строках стоят имена и аватары живых людей, а
// анонимный ключ зашит в бандл — то есть открыт всем. `club_news` анониму
// открыт законно (там чужие заголовки из RSS), и разница между ними и есть
// предмет этой проверки.
//
// Читать комнату по-настоящему отсюда нельзя и не нужно: для этого нужна
// подпись Telegram, которую взять неоткуда. Значит проверяется не содержимое,
// а ГРАНИЦА — и она проверяема полностью.
async function checkClubRoom() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Комната болельщиков', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const call = async (fn, body) => {
    const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: auth, body: JSON.stringify(body),
    });
    return { ok: r.ok, status: r.status, rows: r.ok ? await r.json().catch(() => null) : null };
  };

  // Подделка подписи обязана быть отвергнута. Не «вернуть пусто» — именно
  // отвергнута: пустой ответ нельзя отличить от «в комнате пока тихо».
  const read = await call('club_room_posts', {
    p_init_data: 'подделка', p_club: 'real-madrid', p_limit: 5,
  });
  record('Комната: чтение без подписи отбито', !read.ok,
         read.ok ? `ОТДАЛА ${Array.isArray(read.rows) ? read.rows.length : '?'} строк анониму`
                 : `HTTP ${read.status}, как и должно`,
         'ловит снятую проверку tg_validate_init_data на чтении');

  const write = await call('post_club_message', {
    p_init_data: 'подделка', p_club: 'real-madrid', p_body: 'проверка',
  });
  record('Комната: запись без подписи отбита', !write.ok,
         write.ok ? 'ЗАПИСАЛА от имени анонима' : `HTTP ${write.status}, как и должно`,
         'ловит снятую проверку на записи');

  // И сама таблица не должна открываться напрямую, мимо функций.
  const table = await fetch(`${url}/rest/v1/club_post?select=body&limit=1`, { headers: auth });
  record('Комната: таблица закрыта напрямую', !table.ok,
         table.ok ? 'club_post ЧИТАЕТСЯ анонимным ключом' : `HTTP ${table.status}, как и должно`,
         'ловит забытую политику RLS или выданный грант');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ, И БЕЗ НЕГО ТРИ ПРОВЕРКИ ВЫШЕ НИЧЕГО НЕ СТОЯТ:
  // отозванный ключ, кончившийся проект и опечатка в адресе дают ровно те же
  // отказы. Значит надо показать, что этим же ключом открытое — открыто.
  const news = await call('club_news', { p_club_key: 'real-madrid', p_limit: 1 });
  record('Комната: контроль — тем же ключом открытое открыто', news.ok,
         news.ok ? 'club_news отвечает анониму, как и задумано'
                 : `club_news тоже отказал (HTTP ${news.status}) — ключ или адрес не те`,
         news.ok ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}


// ----------------------------------------------------- категории игроков ---
// Владелец: «разбей всех игроков по категориям, дай им ранг».
//
// ⚠️ ПРОВЕРЯЕТСЯ НЕ «ФИЛЬТР ЕСТЬ», А «ФИЛЬТР ФИЛЬТРУЕТ». Параметр, который
// сервер молча игнорирует, выглядит на экране как работающий: кнопка
// нажимается, список меняется (потому что меняется сортировка), и заметить,
// что «нападающие» это те же все, нечем. Поэтому здесь три разных способа
// поймать мёртвый параметр, и каждый способен упасть отдельно.
async function checkPlayerPositions() {
  const url = env('VITE_SUPABASE_URL');
  // player_index_count ушёл за подписку — см. serviceKey() выше.
  const key = serviceKey();
  if (!url || !key) {
    record('Категории игроков', false,
           key ? 'нет VITE_SUPABASE_URL в окружении'
               : 'нет SUPABASE_KEY: раздел за подпиской, анонимом его не проверить',
           'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const rpc = async (name, body) => {
    const r = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: auth, body: JSON.stringify(body),
    });
    return r.ok ? r.json().catch(() => null) : null;
  };
  const count = (pos) => rpc('player_index_count', { p_sort: 'value', p_position: pos });

  const all = await count(null);
  const parts = {};
  for (const p of ['goalkeeper', 'defender', 'midfield', 'attack']) parts[p] = await count(p);
  const sum = Object.values(parts).reduce((a, b) => a + (Number(b) || 0), 0);

  const named = Object.entries(parts).map(([k, v]) => `${k} ${v}`).join(', ');
  record('Категории: все четыре не пусты',
         Object.values(parts).every((n) => Number(n) > 0),
         named, 'ловит пересборку амплуа, которая не прошла');

  // Сумма частей ОБЯЗАНА быть меньше целого: у 1 679 карточек амплуа нет, и
  // если сумма вдруг сравнялась с общим числом — значит кого-то посчитали
  // дважды или «без амплуа» кому-то приписали.
  record('Категории: сумма меньше целого',
         Number(all) > 0 && sum > 0 && sum < Number(all),
         `${sum} из ${all}`,
         'ловит двойной счёт и приписанное наугад амплуа');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ ПЕРВЫЙ: выдуманное амплуа обязано дать НОЛЬ.
  // Мёртвый параметр вернёт здесь всех, и это единственное место, где видно
  // разницу между «фильтр работает» и «фильтр не читается».
  const bogus = await count('нет-такого-амплуа');
  record('Категории: контроль выдуманного',
         Number(bogus) === 0,
         Number(bogus) === 0 ? 'выдуманное амплуа дало ноль, как и должно'
                             : `выдуманное амплуа вернуло ${bogus} игроков`,
         Number(bogus) === 0 ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');

  // Ранг внутри категории: первая тройка нападающих обязана БЫТЬ нападающими.
  const top = await rpc('player_index', {
    p_sort: 'value', p_position: 'attack', p_limit: 3, p_lang: 'ru',
  });
  const rows = Array.isArray(top) ? top : [];
  const clean = rows.length === 3 && rows.every((r) => r.player_position === 'attack');
  record('Категории: ранг считается внутри категории',
         clean && rows[0]?.place === 1,
         rows.length ? `1-й ${rows[0].name} (${rows[0].player_position})` : 'пусто',
         'ловит место, посчитанное по всему списку вместо среза');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ ВТОРОЙ, И ОН ПРО САМУЮ ТИХУЮ ПОЛОМКУ. Если
  // параметр не читается, срез «вратари» совпадёт с общим списком. Вратарь
  // дороже всех нападающих не бывает — значит первые строки обязаны
  // РАЗОЙТИСЬ. Совпали — фильтр мёртв, сколько бы строк он ни вернул.
  const topAll = await rpc('player_index', { p_sort: 'value', p_limit: 1, p_lang: 'ru' });
  const topGk = await rpc('player_index', {
    p_sort: 'value', p_position: 'goalkeeper', p_limit: 1, p_lang: 'ru',
  });
  const a = Array.isArray(topAll) ? topAll[0] : null;
  const g = Array.isArray(topGk) ? topGk[0] : null;
  const differ = !!a && !!g && a.card_id !== g.card_id;
  record('Категории: контроль — срез не равен целому',
         differ,
         differ ? `все: ${a.name}; вратари: ${g.name}`
                : 'первый в срезе тот же, что в общем списке',
         differ ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}


// ------------------------------------------------ кэш рейтинга игроков ----
// Владелец: «статистика иногда не загружается».
//
// ⚠️ КЭШ, ПЕРЕСТАВШИЙ ОБНОВЛЯТЬСЯ, — ЭТО НЕ ОШИБКА НА ЭКРАНЕ, А ПРОШЛАЯ
// НЕДЕЛЯ ВМЕСТО ЭТОЙ. Экран нарисуется, числа будут правдоподобны, и понять,
// что они недельной давности, по нему невозможно. Поэтому свежесть
// проверяется сверкой С ЖИВЫМ РАСЧЁТОМ, а не тем, что таблица не пуста.
async function checkRatingCache() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    record('Кэш рейтинга', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const rpc = async (name, body) => {
    const r = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: auth, body: JSON.stringify(body),
    });
    return r.ok ? r.json().catch(() => null) : null;
  };

  const t0 = Date.now();
  const week = await rpc('player_ratings', { p_days: 7, p_limit: 50 });
  const ms = Date.now() - t0;
  const rows = Array.isArray(week) ? week : [];
  // Потолок анонима — три секунды; здесь вдвое строже, потому что срыв
  // случался именно тогда, когда рядом шёл ночной обход, а не на пустой базе.
  record('Кэш рейтинга: экран укладывается в лимит anon',
         rows.length > 0 && ms < 1500,
         `${rows.length} строк, ${ms} мс`,
         'ловит возврат к расчёту на каждый показ: 33 799 буферов ради 50 строк');

  // ⚠️ СВЕЖЕСТЬ — ЭТО СОВПАДЕНИЕ С ЖИВЫМ, А НЕ НАЛИЧИЕ СТРОК. Окно 365 в
  // кэше есть, а окно 14 — нет; значит один и тот же вопрос можно задать
  // дважды: через кэш и мимо него. Если ночное обновление отвалится, лидеры
  // недели разойдутся с лидерами тех же суток, посчитанными на месте.
  const live = await rpc('player_ratings', { p_days: 14, p_limit: 50 });
  const liveRows = Array.isArray(live) ? live : [];
  record('Кэш рейтинга: окно мимо кэша считается живьём', liveRows.length > 0,
         `${liveRows.length} строк по окну, которого в кэше нет`,
         'ловит кэш, ставший ЕДИНСТВЕННЫМ источником: пустой кэш = пустой экран');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: у РАЗНЫХ окон обязаны быть разные ответы.
  // Совпадение строка в строку значило бы, что `p_days` не читается вовсе —
  // и тогда обе проверки выше зелены, а экран показывает одно и то же
  // независимо от выбранной вкладки.
  const year = await rpc('player_ratings', { p_days: 365, p_limit: 50 });
  const yearRows = Array.isArray(year) ? year : [];
  const sameTop = rows.length > 0 && yearRows.length > 0
    && rows[0].card_id === yearRows[0].card_id
    && rows[0].goals === yearRows[0].goals;
  record('Кэш рейтинга: контроль — окна различаются', !sameTop,
         sameTop ? 'неделя и год дали одного лидера с теми же голами'
                 : `за неделю ${rows[0]?.goals ?? '?'} голов у лидера, за год ${yearRows[0]?.goals ?? '?'}`,
         sameTop ? '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ' : 'проверка способна упасть');
}


// ---------------------------------------- охват статистики: лиги и команды ---
// Владелец: «дособери статистику всех команд и игроков».
//
// ⚠️ ЧЕГО НЕ ВИДНО БЕЗ ЭТОЙ ПРОВЕРКИ. Ни один тест не краснеет от того, что
// лиги НЕТ В СПИСКЕ обхода: код исправен, запросы уходят, ответы разбираются,
// тысяча тестов зелена. Просто игроков этой лиги никто никогда не спрашивал.
// Замер 13.09.2026, до починки: Серия Б — 5% карточек со статистикой, Лига 2 —
// 2%, Чемпионшип — 5%, при 50–68% у тех четырнадцати лиг, что в списке были.
// Разница — одна строка кода на лигу.
//
// ⚠️ ЭТО ЖЕ И ПРОВЕРКА СТАТИСТИКИ КОМАНД. `club_match` ниоткуда отдельно не
// собирается: `rebuild_club_matches()` сворачивает до матчей ровно эти строки.
// Лига вне списка — это не только игроки без голов, но и клубы без формы, без
// разницы мячей и без характера.
async function checkStatsCoverage() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Охват статистики', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const auth = { apikey: key, Authorization: `Bearer ${key}` };
  // ⚠️ СЧЁТ ЗАГОЛОВКОМ, А НЕ ДЛИНОЙ ОТВЕТА. PostgREST режет тело по
  // `db-max-rows` (в этом проекте 1000), и `rows.length` на большой выборке
  // сказал бы «ровно 1000» с уверенностью. `count=exact` считает в базе.
  const count = async (q) => {
    const r = await fetch(`${url}/rest/v1/${q}`, {
      headers: { ...auth, Prefer: 'count=exact', Range: '0-0' },
    });
    const n = Number((r.headers.get('content-range') ?? '').split('/')[1]);
    return Number.isFinite(n) ? n : -1;
  };

  // 1. СПИСОК ЛИГ ЧИТАЕТСЯ ИЗ САМОГО ОБХОДА, А НЕ ПОВТОРЯЕТСЯ ЗДЕСЬ. Копия
  //    списка проверяла бы копию: разойдись они — оба остались бы зелёными.
  const pySrc = existsSync('football_scraper/espn_stats.py')
    ? readFileSync('football_scraper/espn_stats.py', 'utf-8') : '';
  const block = /LEAGUES = \{([\s\S]*?)\n\}/.exec(pySrc);
  const leagues = [...(block?.[1] ?? '').matchAll(/^\s*"([^"]+)":\s*"([^"]+)",/gm)]
    .map(([, code, name]) => ({ code, name }));

  const board = async (code, dates) => {
    try {
      const q = dates ? `?dates=${dates}&limit=1000` : '';
      const r = await get(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/${code}/scoreboard${q}`,
        { 'User-Agent': UA });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  };
  const espnName = async (code) => {
    const d = await board(code);
    return d ? ((d.leagues ?? [])[0]?.name ?? null) : null;
  };
  /** Месяцы `YYYYMM` за последний год, от свежего к старому. */
  const lastMonths = (count) => {
    const out = [];
    const d = new Date();
    d.setUTCDate(1);
    for (let i = 0; i < count; i += 1) {
      out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
      d.setUTCMonth(d.getUTCMonth() - 1);
    }
    return out;
  };

  /** Дата последнего ЗАВЕРШЁННОГО матча лиги за год, или null.
   *  Признак завершённости тот же, что читает сам обход
   *  (`completed_events` в scraper/espn.py): `status.type.completed`, и
   *  никакой другой — идущий матч тоже приходит событием.
   *
   *  ⚠️ СПРАШИВАЕТСЯ ПОМЕСЯЧНО, А НЕ ДИАПАЗОНОМ ДАТ, И ЭТО НЕ СТИЛЬ. Здесь
   *  стояло `dates=ГГГГММДД-ГГГГММДД`, и ESPN перестал такое понимать — 400
   *  на КАЖДУЮ лигу, включая заведомо живую. Проверка от этого не покраснела
   *  честно, а начала врать в одну сторону: 400 читался как «ни одного матча
   *  за год», и живые кубки УЕФА попадали в список брошенных кодов рядом с
   *  настоящей поломкой. Тот же диапазон стоял в самом обходе — там он молча
   *  обнулил ночной сбор, см. espn_stats.py.
   *
   *  Месяцы идут от свежего к старому и обход обрывается на ПЕРВОМ, где матч
   *  нашёлся: у живой лиги это один запрос, тринадцать — только у мёртвой. */
  const lastFinished = async (code, months) => {
    for (const month of months) {
      const d = await board(code, month);
      const days = (d?.events ?? [])
        .filter((e) => e.status?.type?.completed === true)
        .map((e) => String(e.date ?? '').slice(0, 10))
        .filter(Boolean)
        .sort();
      if (days.length) return days[days.length - 1];
    }
    return null;
  };

  // По восемь за раз: полсотни запросов подряд растянули бы прогон, а все разом
  // — повод для источника ответить отказом.
  const answered = [];
  for (let i = 0; i < leagues.length; i += 8) {
    answered.push(...await Promise.all(
      leagues.slice(i, i + 8).map(async (l) => ({ ...l, got: await espnName(l.code) }))));
  }
  const dead    = answered.filter((l) => !l.got);
  const renamed = answered.filter((l) => l.got && l.got !== l.name);
  record('Охват: каждая лига списка отзывается',
         leagues.length >= 45 && dead.length === 0,
         leagues.length === 0 ? 'список лиг не прочитался из espn_stats.py'
           : `${leagues.length} лиг, молчат ${dead.length}` +
             (dead.length ? ': ' + dead.map((l) => l.code).join(', ') : ''),
         'ловит код лиги, переставший существовать: обход по нему молча даёт ноль матчей');

  record('Охват: имя лиги совпадает с записанным',
         leagues.length > 0 && renamed.length === 0,
         renamed.length ? renamed.map((l) => `${l.code}: «${l.name}» -> «${l.got}»`).join('; ')
                        : `все ${answered.length} названий сошлись`,
         'ловит переехавший код: отвечает чужая лига, а обход пишет её матчи как свои');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: у выдуманного кода имени быть не может.
  const ghost = await espnName('zz.9');
  record('Охват: контроль выдуманной лиги', ghost === null,
         ghost === null ? 'по коду zz.9 имени нет, как и должно'
                        : `выдуманная лига назвалась «${ghost}»`,
         ghost === null ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');

  // 2. КОНЕЦ ЦЕПОЧКИ: ответ источника — это ещё не строка в таблице. Спрашивается
  //    ровно то, ради чего всё делалось: СКОЛЬКИМ лигам из списка статистика
  //    действительно дошла до базы за последний месяц.
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const seen = [];
  for (let i = 0; i < leagues.length; i += 8) {
    const part = await Promise.all(leagues.slice(i, i + 8).map(async (l) => ({
      name: l.name,
      n: await count(`player_match_stats?select=card_id&match_date=gte.${since}`
                     + `&tournament=eq.${encodeURIComponent(l.name)}`),
    })));
    seen.push(...part.filter((x) => x.n > 0));
  }
  // Порог ниже измеренного не по робости: у половины списка сезон летний или
  // южноамериканский, и «сколько лиг играет прямо сейчас» — величина сезонная.
  // Двадцать — это заведомо ниже зимнего и летнего дна и заведомо выше тех
  // четырнадцати, что были до починки.
  record('Охват: статистика доходит дальше топ-лиг',
         seen.length >= 20,
         `${seen.length} лиг из ${leagues.length} дали матчи за 30 суток`,
         'ловит возврат к короткому списку: четырнадцать лиг эту планку не берут');

  // ⚠️ ЛИГА, МОЛЧАЩАЯ ГОД, — ЭТО БРОШЕННЫЙ КОД, А НЕ МЕЖСЕЗОНЬЕ, И ОТЛИЧИТЬ
  //    ОДНО ОТ ДРУГОГО МОЖНО ТОЛЬКО ГОДОВЫМ ОКНОМ. Шесть кодов из первого
  //    списка отвечали 200 своим настоящим именем и не публиковали НИЧЕГО:
  //    у tur.2, fin.1, cze.1 и isr.1 ноль матчей за год, у sui.1 последний
  //    28.09.2025, у irl.1 — 01.11.2025. Все шесть играют прямо сейчас, просто
  //    не у ESPN. Проверка «код отзывается» называла их живыми — та же форма
  //    ошибки, что с ТВ: верхний манифест 200, вариант под ним 404.
  //
  //    Годовое окно спрашивается ТОЛЬКО у молчащих последний месяц: у лиги,
  //    которая и так дала строки, спрашивать нечего, а ответ за год по плотной
  //    лиге — это сотни событий в теле. По трёхмесячному окну пусты и кубки
  //    УЕФА, и тайская лига, а у них последний матч в мае и новый сезон на
  //    носу — вот почему окно именно годовое.
  const quiet = leagues.filter((l) => !seen.some((x) => x.name === l.name));
  const year = lastMonths(13);
  //    Считается ПОСЛЕДНЯЯ ДАТА, а не число матчей, и это разница по существу:
  //    у sui.1 за год 8 матчей, у irl.1 — 35, то есть по счётчику обе «живые»,
  //    а последние их матчи 28.09.2025 и 01.11.2025. Девять месяцев не молчит
  //    ни одна лига: у Элитесериен зимний перерыв четыре месяца, у МЛС три,
  //    у России два. Девять — это источник, а не календарь.
  const STALE_DAYS = 270;
  const abandoned = [];
  for (let i = 0; i < quiet.length; i += 4) {
    const part = await Promise.all(quiet.slice(i, i + 4).map(async (l) => ({
      code: l.code, last: await lastFinished(l.code, year),
    })));
    abandoned.push(...part.filter((x) => !x.last
      || (Date.now() - Date.parse(x.last)) / 86400000 > STALE_DAYS));
  }
  record('Охват: молчащие лиги — межсезонье, а не брошенный код',
         abandoned.length === 0,
         quiet.length === 0 ? 'молчащих за месяц нет вовсе'
           : `молчат месяц ${quiet.length}, дольше ${STALE_DAYS} суток — ` +
             (abandoned.length
               ? abandoned.map((x) => `${x.code} (${x.last ?? 'ни одного за год'})`).join(', ')
               : 'ни одна'),
         'ловит код, который отвечает 200 своим именем и не публикует матчей');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ, И ОН ПРО ФОРМУ ЗАПРОСА. Ноль по выдуманному
  // турниру ничего не значит сам по себе: так же ответил бы сломанный фильтр.
  // Рядом — тот же запрос по заведомо существующему.
  const nonsense = await count(
    `player_match_stats?select=card_id&tournament=eq.${encodeURIComponent('Лига Кривых Зеркал')}`);
  const real = seen.length ? seen[0] : { name: '—', n: 0 };
  const filterOk = nonsense === 0 && real.n > 0;
  record('Охват: контроль отбора по турниру', filterOk,
         nonsense !== 0 ? `выдуманный турнир дал ${nonsense} строк`
           : real.n > 0 ? `по выдуманному 0, по «${real.name}» — ${real.n}`
                        : 'запрос не нашёл даже настоящий турнир — форма сломана',
         filterOk ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');

  // 3. КОМАНДЫ. Та же цепочка, последнее звено: матчи клубов — свёртка этих же
  //    строк, и без неё у клуба нет ни формы, ни характера.
  const clubMatches = await count(`club_match?select=home_key&match_date=gte.${since}`);
  record('Охват: матчи команд свёрнуты',
         clubMatches >= 800,
         `${clubMatches} матчей команд за 30 суток`,
         'ловит разрыв player_match_stats -> rebuild_club_matches: игроки есть, команд нет');
}

await checkDigest();
await checkAnonRpc();
await checkNoScores();
await checkClubCrests();
await checkFameAxes();
await checkClubValue();
await checkClubRoster();
await checkFixtureSquads();
await checkEspnScores();
await checkCardConflicts();
await checkCurrentClubSources();
await checkDeckCountries();
await checkMetricHistory();
await checkPlayerIndex();
await checkScreenBudget();
await checkCollectionSearchEscaping();
await checkFixtureClubs();
await checkLocalGoals();
await checkMatchCharacter();
await checkClubFansInvite();
await checkPlayerLevelBasis();
await checkClubOrderAndLinks();
await checkClubManagers();
await checkClubMerge();
await checkClubCharacter();
await checkCardValueTrend();
await checkTopFixtures();
await checkFootballers();
await checkSoccerWiki();
await checkPlayerPositions();

// ------------------------------------------------- точность прогноза --------
// ⚠️ БЛОК «ХАРАКТЕР МАТЧА» ПЕЧАТАЛ ОЖИДАЕМУЮ РЕЗУЛЬТАТИВНОСТЬ, И НИКТО НИ РАЗУ
// НЕ ПРОВЕРИЛ, СБЫВАЕТСЯ ЛИ ОНА. Теперь проверяет `forecast_backtest` — без
// утечки: окно кончается за сутки до матча, медиана точки отсчёта берётся по
// матчам строго до начала месяца. Снимок пишется ночью в `forecast_quality`,
// здесь он только читается: сам обсчёт в потолок анонима (3 с) не помещается.
//
// ⚠️ ЧТО ЗАМЕР ПОКАЗАЛ, И ЭТО НЕ В ПОЛЬЗУ МОДЕЛИ. На 5644 матчах модель 1.3142,
// «всегда называй медиану» 1.3102 — то есть ожидаемая результативность НЕ БЬЁТ
// тривиальную догадку. Поэтому проверка ниже и НЕ требует, чтобы била: она
// требует, чтобы модель не стала заметно ХУЖЕ неё. Требование «обгони» было бы
// красным с первого дня и его бы просто отключили.
async function checkForecastQuality() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Точность прогноза', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const r = await fetch(
    `${url}/rest/v1/forecast_quality?select=*&order=computed_at.desc&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const row = (await r.json().catch(() => []))[0];
  if (!row) {
    record('Точность прогноза: снимок есть', false,
           'forecast_quality пуст — ночной шаг не отработал', 'н/д');
    return;
  }

  const age = (Date.now() - Date.parse(row.computed_at)) / 86400000;
  record('Точность прогноза: снимок свежий',
         age <= 3 && row.matches >= 1000,
         `${row.matches} матчей, посчитано ${age.toFixed(1)} сут. назад`,
         'ловит остановку ночного rebuild_forecast_quality и обвал числа матчей');

  // ЕДИНСТВЕННОЕ, ЧТО ЗАМЕР ПОДТВЕРЖДАЕТ: личность команд что-то несёт.
  // Перепутанный прогноз — те же числа, приклеенные к чужим матчам.
  const t = Number(row.gain) / (Number(row.gain_se) || Infinity);
  record('Точность прогноза: личность команд что-то даёт',
         t >= 2,
         `выигрыш над перепутанным ${Number(row.gain).toFixed(4)} гола, ` +
         `se ${Number(row.gain_se).toFixed(4)}, t = ${t.toFixed(2)}`,
         'ловит вырождение прогноза в шум: t < 2 значит «те же числа в любом порядке»');

  // ⚠️ КОНТРОЛЬ САМОГО КОНТРОЛЯ, И ОН ЗДЕСЬ НЕ ДЛЯ КРАСОТЫ. Строка выше
  // полгода показывала t около двух, и это читалось как замер о футболе:
  // «кто играет — почти неважно». Мерил сломанный контроль. Перестановка
  // бралась как `lag(predicted) over (order by match_date, actual)` — то есть
  // матчи сортировались ПО ОТВЕТУ, и «чужим» оказывался матч с тем же счётом:
  // средний разрыв 0.38 гола, в 79.8 % случаев счёт совпадал буква в букву.
  // После перехода на хеш от даты и клубов: разрыв 1.32, t = 6.8, а сама
  // модель не изменилась ни на тысячную (1.3150 против 1.3152).
  //
  // Порог 1.0 стоит между сломанным (0.38) и честным (1.32): вернуть
  // сортировку по факту, не уронив прогон, теперь нельзя.
  const gap = row.donor_gap == null ? null : Number(row.donor_gap);
  record('Точность прогноза: перепутанный — правда чужой',
         gap != null && gap >= 1.0,
         gap == null ? 'forecast_quality.donor_gap пуст — снимок от старой версии замера'
                     : `донор прогноза отстоит на ${gap.toFixed(2)} гола`,
         'ловит возврат перестановки к сортировке по ответу: тогда разрыв падает до 0.38');

  // ⚠️ ЗАЩИТА ОТ «УЛУЧШЕНИЙ», КОТОРЫЕ УХУДШАЮТ. Проверенная мультипликативная
  // модель (атака x оборона x среднее лиги) дала 1.4474 против 1.3102 у
  // медианы — эта строка поймала бы её сразу. Допуск 0.02 гола: модель уже
  // проигрывает медиане 0.0040, и запрещать это задним числом нечестно.
  const slack = Number(row.mae_model) - Number(row.mae_baseline);
  record('Точность прогноза: не хуже тривиальной догадки',
         slack <= 0.02,
         `модель ${Number(row.mae_model).toFixed(4)}, медиана ` +
         `${Number(row.mae_baseline).toFixed(4)}, разница ${slack.toFixed(4)}; ` +
         `ближе медианы в ${Number(row.pct_closer).toFixed(1)}% матчей`,
         'ловит правку формулы, которая делает прогноз хуже константы');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: перепутанный прогноз ОБЯЗАН быть хуже настоящего.
  // Не хуже — значит замер меряет не то, и верить верхним строкам нельзя.
  const ok = Number(row.mae_shuffled) > Number(row.mae_model);
  record('Точность прогноза: контроль перепутанного', ok,
         ok ? `перепутанный ${Number(row.mae_shuffled).toFixed(4)} хуже настоящего `
              + `${Number(row.mae_model).toFixed(4)}, как и должно`
            : 'перепутанный прогноз не хуже настоящего',
         ok ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}


// ------------------------------------------------ ворота подписки на RPC ---
// ⚠️ СПРЯТАННЫЙ ЭКРАН НЕ ЗАКРЫВАЕТ ДАННЫЕ. Мини-приложение живёт на клиенте:
// кто откроет devtools, позовёт RPC напрямую. Поэтому у платных данных стоят
// СВОИ ворота — `require_pro()` читает подпись Telegram из заголовка
// `x-tg-init-data`, проверяет её ботовым секретом и смотрит `is_pro`.
//
// ⚠️ ПРОВЕРЯЮТСЯ ОБЕ СТОРОНЫ, И ЭТО ВЕСЬ СМЫСЛ. «Аноним получил отказ» само по
// себе ничего не доказывает: ровно так же выглядит сломанная функция, опечатка
// в имени и отозванный грант. Рядом обязан стоять путь, который ПРОХОДИТ.
async function checkProGate() {
  const url = env('VITE_SUPABASE_URL');
  const anon = env('VITE_SUPABASE_ANON_KEY');
  const svc = serviceKey();
  if (!url || !anon) {
    record('Ворота Pro', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const call = async (key, headers = {}) => {
    const r = await fetch(`${url}/rest/v1/rpc/player_index`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`,
                 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ p_sort: 'value', p_lang: 'ru', p_limit: 3 }),
    });
    const body = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, code: body?.code, rows: Array.isArray(body) ? body.length : null };
  };

  const bare = await call(anon);
  record('Ворота Pro: без подписи не пускают',
         !bare.ok && bare.code === '42501',
         bare.ok ? `аноним получил ${bare.rows} строк рейтинга БЕЗ подписки`
                 : `HTTP ${bare.status}, код ${bare.code}`,
         'ловит снятые ворота: рейтинг снова раздаётся даром');

  // ⚠️ ПОДДЕЛКА ОБЯЗАНА НЕ ПРОЙТИ. Заголовок ставит кто угодно; защищает не он,
  // а подпись ботовым секретом внутри него. `hash=deadbeef` это и проверяет.
  const forged = await call(anon, { 'x-tg-init-data': 'user=%7B%22id%22%3A1%7D&hash=deadbeef' });
  record('Ворота Pro: подделка не проходит',
         !forged.ok && forged.code === '42501',
         forged.ok ? `подделанная подпись дала ${forged.rows} строк`
                   : `HTTP ${forged.status}, код ${forged.code}`,
         'ловит ворота, которые смотрят на НАЛИЧИЕ заголовка, а не на его подпись');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: путь, который ОБЯЗАН пройти. Без него два отказа
  // выше одинаково хорошо объясняются сломанной функцией.
  if (!svc) {
    record('Ворота Pro: контроль проходящего пути', false,
           'нет SUPABASE_KEY — проверить, что ворота хоть кого-то пускают, нечем',
           '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
    return;
  }
  const pass = await call(svc);
  record('Ворота Pro: контроль проходящего пути',
         pass.ok && pass.rows > 0,
         pass.ok ? `сервисная роль прошла, ${pass.rows} строк`
                 : `и сервисная роль не прошла: HTTP ${pass.status}, код ${pass.code}`,
         pass.ok ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

/**
 * ДАШБОРД СОСТЯЗАНИЯ ПРОГНОЗИСТОВ.
 *
 * ⚠️ ЭТОТ РАЗДЕЛ СТЕРЕЖЁТ НЕ ДОСТУПНОСТЬ, А ЧЕСТНОСТЬ ЧИСЕЛ. Дашборд врёт не
 * падая: покрытие, потерянное по дороге, превращает «66 % на четырёх матчах
 * из десяти» в «66 %» — и модель, отвечающая на лёгкие вопросы, встаёт рядом
 * с теми, кто отвечает на все.
 */
async function checkForecastDuel() {
  const url = env('VITE_SUPABASE_URL');
  const anon = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !anon) {
    record('Состязание прогнозистов', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const rpc = async (fn, body) => {
    const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, code: j?.code, rows: Array.isArray(j) ? j : [] };
  };

  const models = await rpc('forecast_duel_models', {});
  const by = Object.fromEntries(models.rows.map((m) => [m.model, m]));
  record('Состязание: все пять участников на месте',
         ['own', 'llm', 'fly', 'median', 'current'].every((k) => by[k]),
         models.ok ? `пришло: ${models.rows.map((m) => m.model).join(', ') || 'ничего'}`
                   : `HTTP ${models.status}, код ${models.code}`,
         'ловит пропавшего участника: экран показал бы состязание двоих как состязание троих');

  // ⚠️ ГЛАВНОЕ ЧИСЛО РАЗДЕЛА. «Свой вариант» тем и работает, что молчит; если
  // покрытие вдруг стало единицей, значит молчание потерялось по дороге — а
  // его доля угаданных считается ТОЛЬКО по названным матчам и без молчания
  // становится неправдой.
  const own = by.own;
  record('Состязание: свой вариант действительно молчит',
         !!own && Number(own.coverage) > 0.2 && Number(own.coverage) < 0.95,
         own ? `назвал ${(Number(own.coverage) * 100).toFixed(1)} % матчей`
             : 'своего варианта нет вовсе',
         'ловит потерянное молчание: 66 % на части матчей встали бы рядом с 58 % на всех');

  record('Состязание: у остальных покрытие ровно единица',
         ['llm', 'fly', 'median', 'current'].every((k) => by[k] && Number(by[k].coverage) === 1),
         ['llm', 'fly', 'median', 'current']
           .map((k) => `${k} ${by[k] ? by[k].coverage : '—'}`).join(', '),
         'ловит молчание, приписанное тому, кто отвечает на все матчи');

  record('Состязание: замер на живой выборке, а не на десятке матчей',
         !!own && own.matches >= 200,
         own ? `${own.matches} матчей` : 'нет данных',
         'ловит замер на горстке матчей, где любой процент — совпадение');

  const recent = await rpc('forecast_duel_recent', { p_lang: 'ru', p_limit: 60 });
  const named = recent.rows.filter((r) => r.home_name && r.away_name).length;
  record('Состязание: матчи подписаны клубами',
         recent.ok && recent.rows.length > 0 && named === recent.rows.length,
         recent.ok ? `${named} из ${recent.rows.length} строк с названиями клубов`
                   : `HTTP ${recent.status}, код ${recent.code}`,
         'ловит столбик галочек без подписей: непонятно, к какому матчу прогноз');

  // ⚠️ МОЛЧАНИЕ — НЕ ПРОМАХ. Записать его как false значило бы наказать
  // модель за то, ради чего она сделана, и показать на экране 26 % вместо 66 %.
  const silent = recent.rows.filter((r) => !r.own_called);
  record('Состязание: промолчал — значит null, а не «не угадал»',
         silent.length > 0 && silent.every((r) => r.hit_own === null),
         silent.length === 0 ? 'среди последних матчей ни одного молчания — проверять нечего'
                             : `${silent.length} молчаний, все null`,
         silent.length === 0 ? '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ' : 'ловит молчание, засчитанное промахом');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: попадание обязано совпадать со стороной порога,
  // пересчитанной здесь заново. Если сервер и проверка считают его по-разному,
  // одна из галочек на экране врёт.
  const called = recent.rows.filter((r) => r.own_called);
  const agree = called.every((r) => r.hit_own === ((Number(r.p_own) > 2.5) === (r.total > 2.5)));
  record('Состязание: контроль — галочка пересчитана независимо',
         called.length > 0 && agree,
         called.length === 0 ? 'названных матчей нет — пересчитывать нечего'
                             : `${called.length} названных, расхождений ${agree ? 0 : 'ЕСТЬ'}`,
         called.length === 0 ? '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ' : 'проверка способна упасть');
}

/**
 * ГРОМКОСТЬ ПРОТИВ ИГРЫ.
 *
 * ⚠️ ЭТОТ РАЗДЕЛ СТЕРЕЖЁТ ТРИ ОШИБКИ, КОТОРЫЕ БЫЛИ СДЕЛАНЫ ПРИ ПОСТРОЕНИИ
 * ЭТОЙ ФУНКЦИИ, и каждая называла бы живых людей в лицо: игроки без
 * собранной статистики выглядели как не игравшие, вратари — как «громче,
 * чем играет» (голов у них структурно ноль), а минуты стояли основой
 * игрового времени при том, что их нет у половины строк.
 */
async function checkSpotlight() {
  const url = env('VITE_SUPABASE_URL');
  const anon = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !anon) {
    record('Громкость против игры', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const call = async (mode, limit = 25) => {
    const r = await fetch(`${url}/rest/v1/rpc/player_spotlight`, {
      method: 'POST',
      headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_lang: 'ru', p_limit: limit, p_mode: mode }),
    });
    const j = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, code: j?.code, rows: Array.isArray(j) ? j : [] };
  };

  const loud = await call('loud');
  record('Громкость: список приходит', loud.ok && loud.rows.length >= 10,
         loud.ok ? `${loud.rows.length} строк` : `HTTP ${loud.status}, код ${loud.code}`,
         'ловит отозванный грант и опустевшую статистику матчей');

  // ⚠️ ОШИБКА ПЕРВАЯ: игрок без собранной статистики попадал в список как «не
  // игравший». Первые восемь строк были такими, среди них Эсекьель Барко,
  // который весь год играет.
  const noApps = loud.rows.filter((r) => !(Number(r.apps) > 0));
  record('Громкость: у каждого есть сыгранные матчи', loud.rows.length > 0 && noApps.length === 0,
         noApps.length === 0 ? 'ноль строк без матчей'
                             : `${noApps.length} строк с нулём матчей: ${noApps[0]?.name_en}`,
         'ловит возврат к left join: список дыр в сборе вместо списка игроков');

  // ⚠️ ОШИБКА ВТОРАЯ: без сравнения внутри амплуа КАЖДЫЙ вратарь попадал в
  // «громче, чем играет» — голы у него структурно ноль.
  const keepers = loud.rows.filter((r) => r.player_position === 'goalkeeper').length;
  record('Громкость: вратари не заполняют список',
         loud.rows.length > 0 && keepers / loud.rows.length < 0.4,
         `вратарей ${keepers} из ${loud.rows.length}`,
         'ловит пропавшее сравнение внутри амплуа: список обвинял бы за амплуа');

  record('Громкость: перцентиль считан не из горстки',
         loud.rows.length > 0 && loud.rows.every((r) => Number(r.peers) >= 8),
         loud.rows.length ? `наименьшая группа ровесников ${Math.min(...loud.rows.map((r) => Number(r.peers)))}`
                          : 'строк нет',
         'ловит «выше девяноста процентов», сказанное про семерых');

  record('Громкость: разрыв сходится с двумя числами',
         loud.rows.length > 0 &&
         loud.rows.every((r) => Math.abs((Number(r.attention) - Number(r.output)) - Number(r.gap)) < 0.002),
         'разрыв пересчитан независимо',
         'ловит разъехавшиеся внимание, игру и разрыв');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: обратный режим обязан давать ДРУГИХ людей и
  // разрыв с другим знаком. Одинаковые списки значат, что p_mode не работает.
  const quiet = await call('quiet');
  const loudIds = new Set(loud.rows.map((r) => r.card_id));
  const overlap = quiet.rows.filter((r) => loudIds.has(r.card_id)).length;
  record('Громкость: контроль — обратный режим даёт других',
         quiet.ok && quiet.rows.length > 0 && overlap === 0 &&
         quiet.rows.every((r) => Number(r.gap) <= 0),
         quiet.ok ? `пересечение ${overlap}, разрывы ${quiet.rows.every((r) => Number(r.gap) <= 0) ? 'отрицательные' : 'РАЗНОЗНАКОВЫЕ'}`
                  : `HTTP ${quiet.status}, код ${quiet.code}`,
         'ловит не работающий p_mode: обе вкладки показывали бы одно и то же');
}

/**
 * ЛЮБИТЕЛЬСКИЕ ЛИГИ — единственный раздел, куда пишут пользователи.
 *
 * ⚠️ ЭТОТ РАЗДЕЛ СТЕРЕЖЁТ НЕ РАБОТУ, А ЗАКРЫТОСТЬ. Проверить, что лига
 * заводится, отсюда нельзя: для этого нужна настоящая подпись Telegram, а
 * подделать её мы не можем и не должны. Зато можно проверить то, что важнее:
 * что БЕЗ подписи не заводится ничего и что таблицы не открыты напрямую.
 * Анонимный ключ лежит в каждом браузере, и один забытый грант здесь означает
 * чужие лиги, правимые кем угодно.
 */
async function checkAmateur() {
  const url = env('VITE_SUPABASE_URL');
  const anon = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !anon) {
    record('Любительские лиги', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const h = { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' };
  const rpc = async (fn, body) => {
    const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: h, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, code: j?.code, hint: j?.hint };
  };

  const bad = 'user=%7B%22id%22%3A1%7D&auth_date=1&hash=deadbeef';
  const mk = await rpc('amateur_create_league', { p_init_data: bad, p_name: 'проверка' });
  record('Любительские лиги: без подписи лига не заводится',
         !mk.ok && mk.code === '42501',
         mk.ok ? 'ЛИГА ЗАВЕДЕНА С ПОДДЕЛЬНОЙ ПОДПИСЬЮ' : `HTTP ${mk.status}, код ${mk.code}`,
         'ловит снятую проверку подписи: чужие лиги от чужого имени');

  const join = await rpc('amateur_join_team', {
    p_init_data: bad, p_team_id: '11111111-1111-1111-1111-111111111111',
    p_display_name: 'проверка',
  });
  record('Любительские лиги: без подписи игрок не записывается',
         !join.ok && join.code === '42501',
         join.ok ? 'ИГРОК ЗАПИСАН С ПОДДЕЛЬНОЙ ПОДПИСЬЮ' : `HTTP ${join.status}, код ${join.code}`,
         'ловит запись человека, который о лиге не знает — с именем и номером');

  // ⚠️ ТАБЛИЦЫ НЕ ОТДАЮТСЯ НАПРЯМУЮ. Один грант на select здесь — и коды
  // приглашений всех лиг читаются одним запросом.
  for (const table of ['amateur_league', 'amateur_team', 'amateur_player']) {
    const r = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, { headers: h });
    record(`Любительские лиги: таблица ${table} закрыта`,
           r.status === 401 || r.status === 403 || r.status === 404,
           `HTTP ${r.status}`,
           'ловит грант на чтение: коды приглашений всех лиг одним запросом');
  }

  // ⚠️ ЛОГОТИП: ФУНКЦИЯ ОТКАЗЫВАЕТ ДО ЕДИНОГО БАЙТА НА ДИСКЕ.
  const logo = async (body) => {
    const r = await fetch(`${url}/functions/v1/amateur-logo`, {
      method: 'POST', headers: h, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    return { status: r.status, error: j?.error };
  };
  const uuid = '11111111-1111-1111-1111-111111111111';
  const png = 'iVBORw0KGgoAAAAA';
  const noSig = await logo({ kind: 'league', id: uuid, data: png });
  record('Логотип: без подписи не принимается',
         noSig.status === 401 && noSig.error === 'no_signature',
         `HTTP ${noSig.status}, ${noSig.error}`,
         'ловит открытую загрузку: публичная корзина, куда пишет кто угодно');

  const badSig = await logo({ initData: bad, kind: 'league', id: uuid, data: png });
  record('Логотип: подделанная подпись не принимается',
         badSig.status === 401 && badSig.error === 'bad_signature',
         `HTTP ${badSig.status}, ${badSig.error}`,
         'ловит проверку по НАЛИЧИЮ подписи вместо её сходимости');

  const badId = await logo({ initData: bad, kind: 'league', id: 'not-a-uuid', data: png });
  record('Логотип: путь берётся не из запроса',
         badId.status === 400 && badId.error === 'bad_id',
         `HTTP ${badId.status}, ${badId.error}`,
         'ловит имя файла из запроса — запись поверх чужого логотипа');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: функция вообще живая и отвечает по делу, а не
  // всё подряд отвергает, будучи, например, не выложенной.
  const wrongMethod = await fetch(`${url}/functions/v1/amateur-logo`, { method: 'GET', headers: h });
  const wm = await wrongMethod.json().catch(() => null);
  record('Логотип: контроль — функция выложена и отвечает',
         wrongMethod.status === 405 && wm?.error === 'method_not_allowed',
         `HTTP ${wrongMethod.status}, ${wm?.error}`,
         wrongMethod.status === 405 ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

/**
 * ТАЛАНТЫ: читаются ли страницы тех, кого в колоде ещё нет.
 *
 * ⚠️ ЭТОТ РАЗДЕЛ ПРО ЗАМКНУТУЮ ПЕТЛЮ, КОТОРАЯ МОЛЧАЛА МЕСЯЦАМИ. Сборщик
 * страниц игроков стоял с отбором `card_id=not.is.null` — читал ТОЛЬКО тех, кто
 * уже связан с колодой. Замысел понятен (не тратить длинный прогон на
 * четвёртого вратаря третьего дивизиона), но получилось так: у несвязанного
 * игрока никогда не появлялась дата рождения, а без даты его нечем связать —
 * по имени не выходит, там однофамильцы. Замер 14.09.2026: 57 650 строк,
 * страницы прочитаны у 2 613, и из 42 840 НЕСВЯЗАННЫХ дата была ровно у двух.
 *
 * ⚠️ СНАРУЖИ ЭТО ВЫГЛЯДЕЛО КАК «ВСЁ РАБОТАЕТ»: шаг отрабатывал каждую ночь,
 * что-то читал, ничего не падало. Поэтому проверка смотрит не на «шаг
 * выполнился», а на то, попадают ли в чтение те, ради кого он нужен.
 */
async function checkOdds() {
  const url = env('VITE_SUPABASE_URL');
  const svc = serviceKey();
  if (!url || !svc) {
    record('Котировки', false, 'нет SUPABASE_KEY — таблица закрыта для анонима', 'н/д');
    return;
  }
  // ⚠️ ЧЕРЕЗ ФУНКЦИЮ, А НЕ ЗАПРОСОМ К ТАБЛИЦЕ. У `fixture_odds` намеренно нет
  // грантов вообще, поэтому её не читает даже service_role — и это работающая
  // защита, а не помеха, которую надо обойти. `odds_health` отдаёт три числа
  // и ни одной цены.
  const health = await fetch(`${url}/rest/v1/rpc/odds_health`, {
    method: 'POST',
    headers: { apikey: svc, Authorization: `Bearer ${svc}`,
               'Content-Type': 'application/json' },
    body: '{}',
  });
  const h = health.ok ? (await health.json().catch(() => []))[0] ?? {} : {};

  record('Котировки: сбор дошёл до базы',
         Number(h.rows ?? 0) > 0,
         `${h.rows ?? '?'} строк, ${h.matches ?? '?'} матчей`,
         'ловит сборщик, который отрабатывает и ничего не пишет');

  // ⚠️ СВЕЖЕСТЬ, А НЕ НАЛИЧИЕ. Раз собранные котировки останутся в таблице
  // навсегда, и проверка «строки есть» будет зеленеть годами после того, как
  // сбор умрёт. Обход идёт через день, поэтому порог — четверо суток.
  record('Котировки: не протухли',
         Number(h.fresh_rows ?? 0) > 0,
         `${h.fresh_rows ?? '?'} строк за четверо суток, последние ${
           h.last_taken ? String(h.last_taken).slice(0, 16) : '—'}`,
         'ловит умерший сбор при непустой таблице');

  // ⚠️ ГЛАВНАЯ СТРОКА РАЗДЕЛА — §4.4 LIVE_FOOTBALL_HANDOFF. Таблица обязана
  // быть ЗАКРЫТА для анонима: вся защита «коэффициенты только внутрь» держится
  // на отсутствии политики RLS, а не на обещании не запрашивать.
  const anon = env('VITE_SUPABASE_ANON_KEY');
  let leaked = null;
  if (anon) {
    const r = await fetch(`${url}/rest/v1/fixture_odds?select=fixture_id&limit=1`, {
      headers: { apikey: anon, Authorization: `Bearer ${anon}` },
    });
    const body = r.ok ? await r.json().catch(() => null) : null;
    leaked = Array.isArray(body) && body.length > 0;
  }
  record('Котировки: аноним таблицу НЕ читает',
         anon ? leaked === false : false,
         anon ? (leaked ? '!! отдала строки' : 'закрыта, как и задумано')
              : 'нет анонимного ключа',
         'ловит политику RLS, добавленную по невнимательности');
}

async function checkFameCoverage() {
  const url = env('VITE_SUPABASE_URL');
  const key = env('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) {
    record('Охват известных', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  // Счёт заголовком, а не длиной тела: PostgREST режет ответ по `db-max-rows`,
  // и на выборке в двадцать тысяч `rows.length` сказал бы «ровно 1000».
  const count = async (q) => {
    const r = await fetch(`${url}/rest/v1/${q}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`,
                 Prefer: 'count=exact', Range: '0-0' },
    });
    const n = Number((r.headers.get('content-range') ?? '').split('/')[1]);
    return Number.isFinite(n) ? n : -1;
  };

  const BASE = 'active=eq.true&category=eq.player';
  // ⚠️ ЗНАМЕНАТЕЛЬ — ТОЛЬКО С ТЕКУЩИМ КЛУБОМ, И ЭТО НЕ ПОДГОНКА. Шаг догадки
  // берёт кандидатов из `card_current_club` нарочно, и замер говорит, что он
  // прав: у Тьерри Анри и Серхио Агуэро страницы на sports.ru ЕСТЬ и сверку
  // имени проходят, а сезонов в выборе НОЛЬ — источник не отдаёт матчи
  // завершивших карьеру. Из 474 известных карточек без статистики 429 именно
  // такие: Марадона, Пеле, Зидан, Кройф, Мальдини, плюс тренеры. Считать их в
  // знаменателе значило бы держать проверку вечно красной из-за того, чего
  // источник не отдаёт никому.
  const withClub = 'card_current_club!inner(card_id)';
  const withStats = 'player_match_stats!inner(card_id)';

  const famous = await count(`cards?select=id,${withClub}&${BASE}&fame=gte.80`);
  const famousDone = await count(
    `cards?select=id,${withClub},${withStats}&${BASE}&fame=gte.80`);
  const share = famous > 0 ? famousDone / famous : 0;

  // ⚠️ ЭТА СТРОКА СТОИТ ПРОТИВ ТИХОГО ГОЛОДА, А НЕ ПРОТИВ ПАДЕНИЯ. Шаг
  // догадки отрабатывал каждую ночь, что-то угадывал и не падал — а самых
  // известных карточек не пробовал НИ РАЗУ: у всех непробованных ключ
  // сортировки был одинаков, и внутри группы порядок оставался по `id`.
  // Замер 15.09.2026: у всех тридцати карточек с известностью 70+ без
  // статистики `tried = 0`, среди них Анри, Родриго, Агуэро, Карвахаль.
  // Снаружи это выглядело как «всё работает».
  record('Охват известных: у играющих есть статистика',
         share >= 0.85,
         `${famousDone} из ${famous} (${(share * 100).toFixed(1)}%)`,
         'ловит очередь догадки, которая до известных не доходит');

  // ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: проверка обязана РАЗЛИЧАТЬ срезы. Тот же счёт по
  // карточкам без единого просмотра в википедии обязан дать заметно меньшую
  // долю — иначе строка выше зеленела бы на чём угодно, в том числе на
  // выборке, где известность не участвует вовсе.
  const nameless = await count(`cards?select=id,${withClub}&${BASE}&fame=is.null`);
  const namelessDone = await count(
    `cards?select=id,${withClub},${withStats}&${BASE}&fame=is.null`);
  const namelessShare = nameless > 0 ? namelessDone / nameless : 0;
  record('Охват известных: контроль — срезы различаются',
         famous > 0 && nameless > 0 && share - namelessShare >= 0.2,
         `известные ${(share * 100).toFixed(1)}%, безвестные `
         + `${(namelessShare * 100).toFixed(1)}%`,
         'ловит отбор по известности, который ничего не отбирает');
}

async function checkTalentQueue() {
  const url = env('VITE_SUPABASE_URL');
  const svc = serviceKey();
  if (!url || !svc) {
    record('Таланты', false, 'нет SUPABASE_KEY — очередь закрыта для анонима', 'н/д');
    return;
  }
  const get = async (path) => {
    const r = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: svc, Authorization: `Bearer ${svc}`,
                 Prefer: 'count=exact', Range: '0-0' },
    });
    const cr = r.headers.get('content-range') ?? '';
    const total = Number(cr.split('/')[1]);
    return { ok: r.ok, total: Number.isFinite(total) ? total : null,
             rows: r.ok ? await r.json().catch(() => []) : [] };
  };

  const queue = await get('player_talent_queue?select=pid&order=place.asc');
  record('Таланты: очередь не пуста',
         queue.ok && (queue.total ?? 0) > 0,
         `${queue.total ?? '?'} строк`,
         'ловит развалившийся взгляд: без очереди сборщик снова читает по рейтингу');

  // ⚠️ ГЛАВНАЯ СТРОКА РАЗДЕЛА. Страницы обязаны читаться и у тех, у кого
  // карточки НЕТ, — иначе петля закрыта снова и это никак не видно.
  const unlinkedRead = await get(
    'soccerwiki_player?select=pid&card_id=is.null&detail_at=not.is.null');
  record('Таланты: страницы читаются и без карточки',
         (unlinkedRead.total ?? 0) >= 100,
         `${unlinkedRead.total ?? '?'} несвязанных со страницей`,
         'ловит возврат отбора card_id=not.is.null: даты не появятся, связать нечем');

  const born = await get(
    'soccerwiki_player?select=pid&card_id=is.null&born_on=not.is.null');
  record('Таланты: у несвязанных есть даты рождения',
         (born.total ?? 0) >= 40,
         `${born.total ?? '?'} с датой`,
         'ловит сборщик, который читает страницы, но не достаёт дату');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: считалка вообще различает срезы. Проверки выше
  // смотрят на числа, и если счётчик отдаёт одно и то же на любой запрос, они
  // проходят, ничего не измерив.
  const all = await get('soccerwiki_player?select=pid');
  const distinct = (all.total ?? 0) > (unlinkedRead.total ?? 0)
                && (unlinkedRead.total ?? 0) > 0;
  record('Таланты: контроль — срезы различаются',
         distinct,
         `всего ${all.total ?? '?'}, со страницей и без карточки ${unlinkedRead.total ?? '?'}`,
         distinct ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

/**
 * ПРОГНОЗ ПОБЕДИТЕЛЯ: три прогнозиста, история и дофамин мухи.
 *
 * ⚠️ ГЛАВНОЕ ЗДЕСЬ — НЕ «ЕСТЬ ЛИ ЦИФРЫ», А ЧЕСТНО ЛИ ОНИ ПОЛУЧЕНЫ. Дашборд,
 * который показывает долю угаданных, слишком легко сделать красивым: достаточно
 * дописать прогноз после матча. Поэтому проверяется не точность, а устройство:
 * прогноз записан ДО матча, исход проставлен ОТДЕЛЬНО, дофамин дошёл до мозга.
 */
async function checkForecastWinner() {
  const url = env('VITE_SUPABASE_URL');
  const anon = env('VITE_SUPABASE_ANON_KEY');
  const svc = serviceKey();
  if (!url || !anon) {
    record('Прогноз победителя', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const rpc = async (key, name, body, headers = {}) => {
    const r = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`,
                 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body ?? {}),
    });
    return { status: r.status, rows: r.ok ? await r.json().catch(() => null) : null };
  };

  // ── ворота ────────────────────────────────────────────────────────────────
  const noSig = await rpc(anon, 'forecast_scoreboard', {});
  record('Прогноз: без подписи не отдаётся',
         noSig.status === 401,
         `HTTP ${noSig.status}`,
         'ловит открытый платный дашборд: экран спрятан, а RPC нет');

  if (!svc) {
    record('Прогноз', false, 'нет SUPABASE_KEY — дальше нечем', 'н/д');
    return;
  }

  const board = await rpc(svc, 'forecast_scoreboard', {});
  const rows = Array.isArray(board.rows) ? board.rows : [];
  record('Прогноз: контроль проходящего пути',
         board.status === 200 && rows.length > 0,
         `HTTP ${board.status}, ${rows.length} строк`,
         board.status === 200 ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');

  const models = new Set(rows.map((r) => r.model));
  record('Прогноз: все три прогнозиста на месте',
         ['llm', 'fly', 'own'].every((m) => models.has(m)),
         [...models].join(', ') || 'пусто',
         'ловит молча выпавшую модель: дашборд на двоих выглядит так же');

  // ⚠️ ТОЧКА ОТСЧЁТА ОБЯЗАТЕЛЬНА. «Всегда хозяева» на этой выборке даёт около
  // 44 %; модель, не бьющая её, не умеет ничего — сколько бы нейронов в ней ни
  // было. Порог мягкий (0.40): проверка ловит обвал, а не колебание.
  const worst = rows.reduce((a, r) => Math.min(a, Number(r.accuracy) || 0), 1);
  record('Прогноз: никто не хуже подбрасывания монеты',
         rows.length > 0 && worst >= 0.40,
         rows.map((r) => `${r.model} ${(Number(r.accuracy) * 100).toFixed(1)}%`).join(', '),
         'ловит развалившуюся модель и перепутанные местами исходы');

  const fly = rows.find((r) => r.model === 'fly');
  record('Прогноз: муха получила дофамин',
         !!fly && Number(fly.dopamine) > 0,
         fly ? `${fly.dopamine} исходов дошло до мозга` : 'мухи нет в сводке',
         'ловит остановку обучения: прогнозы идут, а мозг их не видит');

  // ── история ───────────────────────────────────────────────────────────────
  const hist = await rpc(svc, 'forecast_history', { p_limit: 60 });
  const h = Array.isArray(hist.rows) ? hist.rows : [];
  record('Прогноз: история приходит',
         h.length > 0, `${h.length} строк`,
         'ловит пустую историю при непустой сводке');

  // ⚠️ ГЛАВНАЯ СТРОКА РАЗДЕЛА. `correct` обязан СХОДИТЬСЯ с `pick` и `actual`.
  // Разойдись они — и «доля угаданных» перестанет значить что-либо, оставаясь
  // правдоподобной.
  const bad = h.filter((r) => r.correct !== (r.pick === r.actual));
  record('Прогноз: «угадал» пересчитывается независимо',
         h.length > 0 && bad.length === 0,
         bad.length === 0 ? `${h.length} строк сошлись`
                          : `${bad.length} строк расходятся`,
         'ловит галочку, проставленную отдельно от названного и случившегося');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: отбор по модели ДЕЙСТВИТЕЛЬНО отбирает. Без него
  // строка выше проверяла бы выборку, которая всегда одна и та же.
  const onlyFly = await rpc(svc, 'forecast_history', { p_model: 'fly', p_limit: 20 });
  const of = Array.isArray(onlyFly.rows) ? onlyFly.rows : [];
  const pure = of.length > 0 && of.every((r) => r.model === 'fly');
  record('Прогноз: контроль отбора по модели',
         pure, pure ? `${of.length} строк, все от мухи`
                    : `пришло ${of.length}, чужих ${of.filter((r) => r.model !== 'fly').length}`,
         pure ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');

  // ── ближайшие ─────────────────────────────────────────────────────────────
  const soon = await rpc(svc, 'forecast_upcoming', { p_limit: 20 });
  const up = Array.isArray(soon.rows) ? soon.rows : [];
  record('Прогноз: ближайшие матчи названы',
         up.length > 0, `${up.length} матчей`,
         'ловит остановку ночного шага: экран пуст, а сводка выглядит живой');

  // ⚠️ ПРОГНОЗ ОБЯЗАН БЫТЬ СДЕЛАН ДО МАТЧА. Строка, дописанная после, — это уже
  // не прогноз, и именно так дашборды становятся красивыми.
  const late = up.filter((r) => Date.parse(r.commence_at) <= Date.now());
  record('Прогноз: назван до матча, а не после',
         up.length > 0 && late.length === 0,
         late.length === 0 ? 'все названные матчи ещё не начались'
                           : `${late.length} матчей уже начались`,
         'ловит запись прогноза задним числом');

  record('Прогноз: три мнения на матч',
         up.length > 0 && up.every((r) => r.llm_pick && r.fly_pick && r.own_pick),
         `${up.filter((r) => r.llm_pick && r.fly_pick && r.own_pick).length} из ${up.length}`,
         'ловит модель, которая молча перестала называть');

  // ⚠️ САМЫЙ ТИХИЙ ИЗ ВОЗМОЖНЫХ ОТКАЗОВ: сверка и дофамин перестали доезжать.
  // Прогнозы при этом продолжают называться, экран выглядит живым, а история
  // просто не растёт. Так и было: шаг `grade` падал с 403 (нет SELECT на
  // `fixtures` у service_role), а шаг `dopamine` — с 400 (upsert без
  // обязательных колонок вместо PATCH). Ни то, ни другое не видно снаружи.
  //
  // ⚠️ У ПРОВЕРКИ ЕСТЬ ЗАПАС В СУТКИ С ЛИШНИМ, И БЕЗ НЕГО ОНА КРАСНЕЛА БЫ
  // КАЖДЫЙ ВЕЧЕР. Ночной круг идёт раз в сутки; матч, закончившийся в 22:00,
  // будет сверен в 05:00. Первая версия этой проверки так и сделала — поймала
  // три матча, которые просто ещё не дошли до своей очереди. Считаются только
  // те, кто ждёт дольше полного цикла: это разница между поломкой и
  // расписанием.
  const stale = await rpc(svc, 'forecast_starving', {});
  const st = Array.isArray(stale.rows) ? stale.rows[0] : null;
  const queue = st == null ? '?' : `, в очереди на сегодня ${st.waiting_now}`;
  record('Прогноз: сверка не отстаёт',
         st != null && Number(st.ungraded_done) === 0,
         st == null ? 'forecast_starving не ответила'
                    : `${st.ungraded_done} матчей ждут сверки дольше суток${queue}`,
         'ловит шаг grade, который перестал доезжать: история замирает молча');

  record('Прогноз: дофамин не отстаёт',
         st != null && Number(st.starving) === 0,
         st == null ? 'forecast_starving не ответила'
                    : `${st.starving} сверенных матчей не дошли до мозга`,
         'ловит шаг dopamine, который перестал доезжать: муха перестаёт учиться');
}

/**
 * ПРЕДЗАПРОС CORS К EDGE-ФУНКЦИЯМ.
 *
 * ⚠️ ЭТА ПРОВЕРКА ПОЯВИЛАСЬ ПО СЛОМАННОЙ КНОПКЕ, И НИ ОДНА ИЗ СОТНИ ОСТАЛЬНЫХ
 * ЭТОГО НЕ ВИДЕЛА. Владелец: «сводка новостей по кнопке „собрать сводку“ не
 * работает». Прямой POST к `digest-summary` анонимным ключом в ту же минуту
 * отвечал HTTP 200 за 2.6 с — то есть сервер был жив, а кнопка не работала.
 *
 * ПРИЧИНА. Ворота Pro научили клиент Supabase подписывать КАЖДЫЙ запрос
 * заголовком `x-tg-init-data`, и `functions.invoke` пошёл через тот же fetch.
 * На нестандартный заголовок браузер шлёт предзапрос OPTIONS. PostgREST
 * отвечает ЭХОМ — что спросили, то и разрешил, поэтому экраны работали. А у
 * Edge-функций список прибит гвоздями:
 *
 *     access-control-allow-headers: authorization, content-type, apikey, x-client-info
 *
 * `x-tg-init-data` в нём нет — браузер блокировал запрос ЦЕЛИКОМ, ещё до
 * отправки. Сломалось разом всё, что зовётся из браузера: сводка, вход в
 * комнату (livekit-token), ОПЛАТА Pro (tg-pay) и загрузка логотипа.
 *
 * ⚠️ ПОЧИНЕНО НА КЛИЕНТЕ, А НЕ РАСШИРЕНИЕМ СПИСКА, И ЭТО ОСОЗНАННО. Подпись
 * нужна только PostgREST: `require_pro()` читает её из `request.headers`, а
 * Edge-функции получают initData телом запроса. Правило живёт в
 * `src/shared/lib/signatureScope.ts` и проверяется юнит-тестом; расширять
 * CORS ради заголовка, который туда больше не едет, значило бы развести прод
 * и репозиторий ради ничего.
 *
 * ⚠️ CURL ЭТОГО НЕ ПОЙМАЕТ НИКОГДА, И В ЭТОМ ВЕСЬ СМЫСЛ РАЗДЕЛА: предзапрос
 * делает браузер, а не сервер. Проверка обязана спрашивать OPTIONS с
 * `Access-Control-Request-Headers`, как спрашивает браузер.
 */
async function checkFunctionCors() {
  const url = env('VITE_SUPABASE_URL');
  if (!url) {
    record('CORS функций', false, 'нет VITE_SUPABASE_URL в окружении', 'н/д');
    return;
  }

  // Ровно те, что зовёт `supabase.functions.invoke` из кода приложения.
  const FUNCS = ['digest-summary', 'livekit-token', 'tg-pay', 'amateur-logo'];

  // ⚠️ ЭТО НЕ «УДОБНЫЙ НАБОР», А ТО, ЧТО КЛАДЁТ КЛИЕНТ. Расходится с
  // `headersClientSends` в `test/deploy_functions.test.ts` — значит одна из
  // двух проверок врёт.
  const SENDS = ['authorization', 'content-type', 'apikey', 'x-client-info'];

  const preflight = async (name, ask) => {
    const r = await fetch(`${url}/functions/v1/${name}`, {
      method: 'OPTIONS',
      headers: {
        Origin: APP,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': ask.join(', '),
      },
    });
    return (r.headers.get('access-control-allow-headers') ?? '').toLowerCase();
  };

  const bad = [];
  for (const name of FUNCS) {
    try {
      const allow = await preflight(name, SENDS);
      const miss = SENDS.filter((h) => !allow.includes(h));
      if (miss.length) bad.push(`${name}: не пропускает ${miss.join(', ')}`);
    } catch (e) {
      bad.push(`${name}: ${String(e).slice(0, 40)}`);
    }
  }
  record('CORS функций: браузер вправе позвать',
         bad.length === 0,
         bad.length === 0
           ? `${FUNCS.length} функции пропускают всё, что шлёт клиент`
           : bad.join('; '),
         'ловит браузерную блокировку вызова: сервер жив, а кнопка не работает');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ, И ОН ЗДЕСЬ ГЛАВНЫЙ. Сервер, отвечающий ЭХОМ на
  // что угодно (так делает PostgREST), прошёл бы проверку выше, ничего не
  // разрешая на самом деле: браузер спросит ровно то, что ему нужно, и всегда
  // получит «да». Заодно это и есть замер поломки: `x-tg-init-data` в списке
  // НЕТ, и проверка обязана это видеть.
  const echoed = [];
  for (const name of FUNCS) {
    try {
      const allow = await preflight(name, [...SENDS, 'x-tg-init-data']);
      if (allow.includes('x-tg-init-data')) echoed.push(name);
    } catch { /* уже посчитано выше */ }
  }
  record('CORS функций: контроль — список не эхо',
         echoed.length === 0,
         echoed.length === 0
           ? 'незаявленный заголовок не разрешается, значит список настоящий'
           : `эхом отвечают: ${echoed.join(', ')}`,
         echoed.length === 0 ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

/**
 * ТРАНСФЕРЫ: РАСПИСАНИЕ И РЕЙТИНГ ПЕРЕХОДОВ.
 *
 * ⚠️ ГЛАВНОЕ ЗДЕСЬ — ПРОВЕРКА, ЧТО ИСТОРИЯ ВООБЩЕ ОБНОВЛЯЕТСЯ. Она собиралась
 * один раз и навсегда: скрипт был, расписания не было, а его отбор «у кого
 * истории ещё нет» пропускал всех, у кого она есть. Январский переход
 * человека, собранного в сентябре, не пришёл бы никогда.
 */
async function checkTransfers() {
  const url = env('VITE_SUPABASE_URL');
  const anon = env('VITE_SUPABASE_ANON_KEY');
  const svc = serviceKey();
  if (!url || !anon) {
    record('Трансферы', false, 'нет VITE_SUPABASE_* в окружении', 'н/д');
    return;
  }
  const rpc = async (fn, body, key = anon) => {
    const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => null);
    return { ok: r.ok, status: r.status, code: j?.code, rows: Array.isArray(j) ? j : [] };
  };

  const top = await rpc('top_transfers', { p_lang: 'ru', p_limit: 20 });
  record('Переходы: рейтинг приходит', top.ok && top.rows.length >= 10,
         top.ok ? `${top.rows.length} строк, дороже всех ${
           top.rows[0] ? Math.round(Number(top.rows[0].fee_eur) / 1e6) + ' млн' : '—'}`
                : `HTTP ${top.status}, код ${top.code}`,
         'ловит отозванный грант и опустевшую историю переходов');

  record('Переходы: по убыванию суммы',
         top.rows.length > 1 &&
         top.rows.every((r, i) => i === 0 || Number(top.rows[i - 1].fee_eur) >= Number(r.fee_eur)),
         'порядок проверен независимо',
         'ловит потерянный order by: «самые дорогие» перестали бы быть самыми дорогими');

  // ⚠️ ОБЪЯВЛЕННЫЕ ЗАРАНЕЕ НЕ СЧИТАЮТСЯ СОСТОЯВШИМИСЯ. В таблице есть строки
  // с датой 2027-07-01, и без отсечения они бы возглавили рейтинг сделками,
  // которых ещё не было.
  const today = new Date().toISOString().slice(0, 10);
  const future = top.rows.filter((r) => r.moved_on > today);
  record('Переходы: будущее не попадает в состоявшиеся', future.length === 0,
         future.length === 0 ? 'ни одной даты из будущего'
                             : `${future.length} строк с датой позже сегодня`,
         'ловит снятое отсечение: рейтинг возглавили бы несостоявшиеся сделки');

  record('Переходы: у каждой строки есть клубы',
         top.rows.length > 0 && top.rows.every((r) => r.from_club && r.to_club),
         `${top.rows.filter((r) => r.from_club && r.to_club).length} из ${top.rows.length}`,
         'ловит переход «ниоткуда в никуда»: сумма без сторон ничего не значит');

  if (!svc) {
    record('Переходы: доза обновления считается', false,
           'нет SUPABASE_KEY — отбор служебный, анониму он закрыт',
           '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
    return;
  }

  // ⚠️ ОТБОР ОБЯЗАН БРАТЬ УСТАРЕВШИХ, А НЕ ТОЛЬКО НОВИЧКОВ. Без этого
  // «обновление раз в квартал» — пустые слова.
  const stale = await rpc('transfers_to_refresh',
                          { p_min_value: 600000, p_stale_days: 90, p_limit: 150 }, svc);
  record('Переходы: доза обновления считается',
         stale.ok && stale.rows.length > 0,
         stale.ok ? `${stale.rows.length} игроков к обходу за ночь`
                  : `HTTP ${stale.status}, код ${stale.code}`,
         'ловит сломанный отбор: обход шёл бы вхолостую и история замерла бы');

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: срок годности обязан ЧТО-ТО МЕНЯТЬ. «Старше
  // суток» — это почти все собранные, «старше ста лет» — никто, значит одни
  // новички. Числа обязаны разойтись.
  //
  // ⚠️ ПРЕДЕЛ СНЯТ НАРОЧНО, И ЭТО НЕ МЕЛОЧЬ. Первая версия контроля брала обе
  // стороны с `p_limit: 150` и сравнивала 150 со 150 — то есть сравнивала два
  // упора в потолок и краснела на здоровой функции. И первая пара сроков (90
  // дней против 100 лет) тоже не различала: последний сбор был шесть дней
  // назад, устаревших не было вовсе, обе стороны давали 748 новичков.
  //
  // ⚠️ «Старше суток» приходит УСЕЧЁННЫМ до 1000 строк — это db-max-rows
  // PostgREST, а не наш p_limit. Для контроля этого довольно (1000 > 748, и
  // стороны расходятся), но читать это число как настоящее количество нельзя.
  const many = await rpc('transfers_to_refresh',
                         { p_min_value: 600000, p_stale_days: 1, p_limit: 100000 }, svc);
  const few  = await rpc('transfers_to_refresh',
                         { p_min_value: 600000, p_stale_days: 36500, p_limit: 100000 }, svc);
  const works = many.ok && few.ok && few.rows.length < many.rows.length;
  record('Переходы: контроль — срок годности действительно читается', works,
         `старше суток ${many.rows.length}${many.rows.length === 1000 ? ' (усечено PostgREST)' : ''}, `
         + `старше ста лет ${few.rows.length}`,
         works ? 'проверка способна упасть' : '⚠ КОНТРОЛЬ НЕ СРАБОТАЛ');
}

await checkRatingCache();
await checkStatsCoverage();
await checkProGate();
await checkForecastQuality();
await checkForecastDuel();
await checkSpotlight();
await checkAmateur();
await checkFunctionCors();
await checkForecastWinner();
await checkTalentQueue();
await checkFameCoverage();
await checkOdds();
await checkTransfers();
await checkClubRoom();
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
