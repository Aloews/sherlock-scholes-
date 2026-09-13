#!/usr/bin/env node
// ПЕРЕЕЗД НА СВОЙ ДОМЕН — ОДНОЙ КОМАНДОЙ, И ЧЕСТНО О ТОМ, ЧТО ОНА НЕ МОЖЕТ.
//
//   node scripts/set-domain.mjs                       ← аудит: где записан адрес
//   node scripts/set-domain.mjs --domain=example.com  ← переезд
//   node scripts/set-domain.mjs --domain=... --dry-run
//
// ⚠️ «ОДНО НАЖАТИЕ» НЕ ЗНАЧИТ «ВСЁ САМО», И ОБЕЩАТЬ ОБРАТНОЕ НЕЛЬЗЯ. Три вещи
// автоматизируются полностью (домен в Vercel, секрет APP_URL, кнопка меню
// бота), одна — НЕТ: записи DNS заводятся у регистратора, где куплен домен, и
// туда ни у кого, кроме владельца, доступа нет. Скрипт печатает ровно те
// записи, которые надо завести, и ждёт их — а не делает вид, что справился.
//
// ⚠️ ПОЧЕМУ ЭТО ВООБЩЕ ПРОСТО. Адрес приложения зашит в ТРЁХ местах на весь
// репозиторий, и в двух из них он уже перекрывается переменной окружения:
//
//   supabase/functions/tg-pay/index.ts   APP_URL       ← секрет Supabase
//   scripts/check-prod.mjs               PROD_APP_URL  ← переменная прогона
//   docs/DEPLOY_CACHING.md               пример в тексте
//
// Ни одна Edge-функция не пришпилена к домену: `Access-Control-Allow-Origin`
// у всех семи — `*`. То есть переезд не ломает ни один вызов из приложения, и
// это проверено обходом, а не предположено.
//
// ⚠️ ЧЕГО СКРИПТ НЕ ТРОГАЕТ НАМЕРЕННО. Прямую ссылку мини-приложения
// (`t.me/<bot>/<short_name>`) заводит BotFather вручную: Bot API её не
// выставляет. Кнопка меню — выставляет, и она же главный вход, поэтому
// автоматизирована именно она.
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const OLD_HOST = 'sherlock-scholes.vercel.app';
const VERCEL_API = 'https://api.vercel.com';
const SB_API = 'https://api.supabase.com/v1';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const DOMAIN = typeof args.domain === 'string' ? args.domain.replace(/^https?:\/\//, '').replace(/\/$/, '') : null;
const DRY = args['dry-run'] === true;

const env = (n) => process.env[n] || '';
const steps = [];
function step(name, state, detail, next) {
  steps.push({ name, state, detail, next });
  const mark = { ok: '✓', skip: '·', todo: '!', fail: '✗' }[state];
  console.log(`${mark} ${name.padEnd(34)} ${detail}`);
  if (next) console.log(`  ${' '.repeat(34)} ${next}`);
}

// ---------------------------------------------------------------- аудит ----
// Где адрес лежит в самом репозитории. Это не поиск «на всякий случай»: если
// однажды кто-то впишет домен в компонент, переезд сломает экран, и узнать об
// этом надо здесь, а не от игрока.
function auditRepo() {
  let hits = [];
  try {
    const out = execSync(
      `git grep -n -F ${JSON.stringify(OLD_HOST)} -- . ':!dist' ':!node_modules' || true`,
      { encoding: 'utf-8' },
    ).trim();
    hits = out ? out.split('\n') : [];
  } catch { /* git grep вернул 1 — совпадений нет */ }
  const code = hits.filter((h) => /\.(ts|tsx|js|mjs|py)$/.test(h.split(':')[0]));
  step('Адрес в репозитории', hits.length ? 'ok' : 'ok',
       `${hits.length} упоминаний, из них в коде ${code.length}`);
  for (const h of hits) console.log(`  ${' '.repeat(34)} ${h.split(':').slice(0, 2).join(':')}`);
  return hits;
}

// --------------------------------------------------------------- Vercel ----
async function vercel() {
  const token = env('VERCEL_TOKEN');
  const project = env('VERCEL_PROJECT_ID') || 'prj_zPmwoDaqeK57VzUBzFxTJGMjUm65';
  const team = env('VERCEL_TEAM_ID') || 'team_e1o23XoY7tj0C19a4zwqDMhT';
  if (!token) {
    step('Vercel: домен проекта', 'skip', 'нет VERCEL_TOKEN',
         'завести токен: vercel.com/account/tokens → секрет VERCEL_TOKEN');
    return;
  }
  const q = `?teamId=${encodeURIComponent(team)}`;
  const head = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  if (!DOMAIN) {
    const r = await fetch(`${VERCEL_API}/v9/projects/${project}/domains${q}`, { headers: head });
    const j = await r.json().catch(() => ({}));
    const names = (j.domains ?? []).map((d) => d.name);
    step('Vercel: домены проекта', r.ok ? 'ok' : 'fail',
         r.ok ? names.join(', ') : `HTTP ${r.status}`);
    return;
  }

  if (DRY) { step('Vercel: домен проекта', 'skip', `сухой прогон, добавил бы ${DOMAIN}`); return; }

  // Добавление идемпотентно: домен уже привязан — Vercel отвечает 409, и это
  // не ошибка переезда, а его нормальное повторение.
  const add = await fetch(`${VERCEL_API}/v10/projects/${project}/domains${q}`, {
    method: 'POST', headers: head, body: JSON.stringify({ name: DOMAIN }),
  });
  if (!add.ok && add.status !== 409) {
    const t = await add.text();
    step('Vercel: домен проекта', 'fail', `HTTP ${add.status} ${t.slice(0, 160)}`);
    return;
  }

  const check = await fetch(
    `${VERCEL_API}/v9/projects/${project}/domains/${encodeURIComponent(DOMAIN)}${q}`,
    { headers: head });
  const info = await check.json().catch(() => ({}));
  if (info.verified) {
    step('Vercel: домен проекта', 'ok', `${DOMAIN} привязан и подтверждён`);
  } else {
    const recs = (info.verification ?? [])
      .map((v) => `${v.type} ${v.domain} → ${v.value}`);
    step('Vercel: домен проекта', 'todo', `${DOMAIN} привязан, НЕ подтверждён`,
         'заведите у регистратора и запустите снова:');
    for (const rec of recs) console.log(`  ${' '.repeat(34)} ${rec}`);
    if (recs.length === 0) {
      console.log(`  ${' '.repeat(34)} A @ 76.76.21.21  (или CNAME на cname.vercel-dns.com)`);
    }
  }
}

// ------------------------------------------------------------- Supabase ----
// Секрет APP_URL читает tg-pay: это адрес, КУДА ВЕРНУТЬ игрока после оплаты.
// Пока он указывает на старый домен, оплата возвращает на старый домен —
// платёж при этом проходит, а выглядит как «после оплаты выкинуло не туда».
async function supabase() {
  const token = env('SUPABASE_ACCESS_TOKEN');
  const ref = env('SUPABASE_PROJECT_REF') || 'konoavrduynecxblqfvq';
  if (!token) {
    step('Supabase: секрет APP_URL', 'skip', 'нет SUPABASE_ACCESS_TOKEN',
         DOMAIN ? `вручную: supabase secrets set APP_URL=https://${DOMAIN}`
                : 'токен: supabase.com/dashboard/account/tokens');
    return;
  }
  if (!DOMAIN) { step('Supabase: секрет APP_URL', 'skip', 'домен не задан'); return; }
  if (DRY) { step('Supabase: секрет APP_URL', 'skip', `сухой прогон, задал бы https://${DOMAIN}`); return; }

  const r = await fetch(`${SB_API}/projects/${ref}/secrets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ name: 'APP_URL', value: `https://${DOMAIN}` }]),
  });
  step('Supabase: секрет APP_URL', r.ok ? 'ok' : 'fail',
       r.ok ? `APP_URL = https://${DOMAIN}` : `HTTP ${r.status}`);
}

// ------------------------------------------------------------- Telegram ----
// ⚠️ КНОПКА МЕНЮ — ЭТО ГЛАВНЫЙ ВХОД, И ЕЁ Bot API ВЫСТАВЛЯЕТ. Прямую ссылку
// мини-приложения (t.me/<bot>/<short_name>) — НЕ выставляет: её заводит
// BotFather руками. Поэтому здесь делается то, что делается, и печатается то,
// что остаётся человеку.
async function telegram() {
  const token = env('TELEGRAM_BOT_TOKEN');
  if (!token) {
    step('Telegram: кнопка меню', 'skip', 'нет TELEGRAM_BOT_TOKEN',
         DOMAIN ? `вручную: BotFather → Bot Settings → Menu Button → https://${DOMAIN}`
                : 'токен бота от @BotFather');
    return;
  }
  if (!DOMAIN) {
    const r = await fetch(`https://api.telegram.org/bot${token}/getChatMenuButton`);
    const j = await r.json().catch(() => ({}));
    const url = j?.result?.web_app?.url ?? '(не веб-приложение)';
    step('Telegram: кнопка меню', 'ok', url);
    return;
  }
  if (DRY) { step('Telegram: кнопка меню', 'skip', `сухой прогон, поставил бы https://${DOMAIN}`); return; }

  const set = await fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ menu_button: { type: 'web_app', text: 'Sherlock Scholes',
                                          web_app: { url: `https://${DOMAIN}` } } }),
  });
  const sj = await set.json().catch(() => ({}));
  // ⚠️ ЧИТАЕМ ОТВЕТ, А НЕ КОД. Bot API отвечает 200 и на отказ, положив
  // причину в `ok:false` — проверка по коду называла бы успехом отказ.
  if (sj?.ok !== true) {
    step('Telegram: кнопка меню', 'fail', String(sj?.description ?? 'отказ без причины'));
    return;
  }
  const back = await fetch(`https://api.telegram.org/bot${token}/getChatMenuButton`)
    .then((r) => r.json()).catch(() => ({}));
  const got = back?.result?.web_app?.url ?? '';
  step('Telegram: кнопка меню', got.includes(DOMAIN) ? 'ok' : 'fail',
       got || 'адрес не перечитался');
  step('Telegram: прямая ссылка', 'todo', 't.me/<бот>/<имя> — только BotFather',
       `BotFather → /myapps → выберите приложение → Edit Web App URL → https://${DOMAIN}`);
}

// ------------------------------------------------------------- проверка ----
// ⚠️ ДО КОНЦА ЦЕПОЧКИ, А НЕ ДО КОДА 200. Домен может отвечать 200 заглушкой
// регистратора — и это выглядит как рабочий переезд ровно до первого игрока.
// Поэтому в ответе ищется след САМОГО приложения.
async function verifyLive() {
  if (!DOMAIN || DRY) return;
  try {
    const r = await fetch(`https://${DOMAIN}/`, { redirect: 'follow' });
    const html = await r.text();
    const mine = /<div id="root"/.test(html) && /\/assets\/.*\.js/.test(html);
    step('Новый адрес отвечает приложением', r.ok && mine ? 'ok' : 'todo',
         r.ok ? (mine ? `HTTP 200, сборка на месте` : 'HTTP 200, но это НЕ приложение')
              : `HTTP ${r.status}`,
         mine ? '' : 'DNS ещё не разошлись или домен смотрит не туда');
  } catch (e) {
    step('Новый адрес отвечает приложением', 'todo', String(e).slice(0, 80),
         'обычное состояние, пока записи DNS не разошлись');
  }
}

// ---------------------------------------------------------------------------
console.log(DOMAIN ? `\nПереезд на ${DOMAIN}\n` : '\nАудит адреса (домен не задан)\n');
auditRepo();
await vercel();
await supabase();
await telegram();
await verifyLive();

const todo = steps.filter((s) => s.state === 'todo');
const failed = steps.filter((s) => s.state === 'fail');
const skipped = steps.filter((s) => s.state === 'skip');
console.log('');
if (skipped.length) console.log(`·  пропущено без токена: ${skipped.length} — см. подсказки выше`);
if (todo.length) console.log(`!  ждёт человека: ${todo.length}`);
if (failed.length) console.log(`✗  отказов: ${failed.length}`);
if (!todo.length && !failed.length && DOMAIN) console.log('✓  переезд завершён');
process.exit(failed.length ? 1 : 0);
