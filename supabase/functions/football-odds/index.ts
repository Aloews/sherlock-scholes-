// football-odds — котировки букмекеров, СЛУЖЕБНЫЙ сигнал.
// ============================================================================
//
// ⚠️ КЛЮЧ НЕ ПОКИДАЕТ ЭТУ ФУНКЦИЮ. `ODDS_API_KEY` — секрет Supabase; он не
// попадает ни в ответ, ни в лог, ни в браузер. Ровно тот же приём, что в
// football-fixtures.
//
// ⚠️ ЧТО С ЭТИМИ ДАННЫМИ МОЖНО, А ЧЕГО НЕЛЬЗЯ — §4.4 docs/LIVE_FOOTBALL_HANDOFF.md.
// Коротко: `fixture_odds` не имеет политики RLS, то есть клиент её не читает
// вовсе, и игроку не показывают ни коэффициентов, ни производных от них.
// Админ — отдельный случай: он видит производные через функцию с проверкой
// пароля персонала, а не через таблицу.
//
// ⚠️ БЮДЖЕТ — ГЛАВНОЕ ОГРАНИЧЕНИЕ, А НЕ ФОРМАЛЬНОСТЬ. `/odds` стоит
// 1 × [рынков] × [регионов] за ЛИГУ за вызов, при потолке 500 кредитов в
// месяц. Замер 20.09.2026: за двадцать дней сентября потрачен 161 кредит —
// около восьми в сутки на живой счёт. Значит на котировки остаётся примерно
// столько же.
//
// Отсюда устройство: ОДИН рынок (h2h), ОДИН регион (eu), десять лиг, один
// обход в сутки — десять кредитов. Плюс резерв: если до конца месяца остаётся
// меньше RESERVE, обход не начинается вовсе. Счёт важнее котировок — он на
// экране, а они внутри.

const ODDS_API_KEY = Deno.env.get("ODDS_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Лиги, по которым спрашиваем цену. Список КОРОЧЕ, чем у расписания, и это
// осознанно: котировка нужна там, где по матчу называется прогноз, а прогнозы
// живут в лигах, по которым у нас есть форма команд. Лига без формы дала бы
// цену, которую не с чем сравнить, и стоила бы того же кредита.
const ODDS_SPORTS = [
  "soccer_epl",
  "soccer_spain_la_liga",
  "soccer_italy_serie_a",
  "soccer_germany_bundesliga",
  "soccer_france_ligue_one",
  "soccer_russia_premier_league",
  "soccer_netherlands_eredivisie",
  "soccer_portugal_primeira_liga",
  "soccer_uefa_champs_league",
  "soccer_uefa_europa_league",
];

// Ниже этого остатка обход не начинается: живому счёту нужно ~8 кредитов в
// сутки, и отнять их у него ради котировок значит поменять то, что на экране,
// на то, что внутри.
const RESERVE = 80;

async function rpc(fn: string, args: Record<string, unknown>): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
    },
    body: JSON.stringify(args),
  });
}

async function creditsLeft(): Promise<number | null> {
  try {
    const r = await rpc("odds_credits_left", {});
    if (!r.ok) return null;
    const v = await r.json();
    return typeof v === "number" ? v : null;
  } catch {
    return null;
  }
}

async function reserve(credits: number): Promise<boolean> {
  try {
    const r = await rpc("spend_odds_credits", { p_credits: credits });
    if (!r.ok) return false;
    return (await r.json()) === true;
  } catch {
    // Отказ при нечитаемом бюджете — безопасная сторона: трата, которую
    // нельзя сосчитать, это ровно то, ради чего потолок и заведён.
    return false;
  }
}

interface Outcome { name?: string; price?: number }
interface Market { key?: string; outcomes?: Outcome[] }
interface Bookmaker { key?: string; title?: string; markets?: Market[] }
interface OddsEvent {
  id?: string;
  home_team?: string;
  away_team?: string;
  bookmakers?: Bookmaker[];
}

/** Строки для одного события: по строке на букмекера. */
function rowsFor(ev: OddsEvent, takenAt: string): Record<string, unknown>[] {
  if (!ev.id || !ev.home_team || !ev.away_team) return [];
  const out: Record<string, unknown>[] = [];
  for (const bk of ev.bookmakers ?? []) {
    const h2h = (bk.markets ?? []).find((m) => m.key === "h2h");
    if (!h2h || !bk.key) continue;
    // ⚠️ ИСХОД ОПРЕДЕЛЯЕТСЯ ПО ИМЕНИ КОМАНДЫ, А НЕ ПО ПОРЯДКУ. Провайдер не
    // обещает, что первым идёт хозяин; ничья вообще приходит как "Draw".
    // Порядок как ключ однажды поменял бы хозяина с гостем местами, и цена
    // фаворита молча стала бы ценой аутсайдера.
    let home: number | null = null, draw: number | null = null, away: number | null = null;
    for (const o of h2h.outcomes ?? []) {
      if (typeof o.price !== "number") continue;
      if (o.name === ev.home_team) home = o.price;
      else if (o.name === ev.away_team) away = o.price;
      else if (o.name === "Draw") draw = o.price;
    }
    if (home == null && draw == null && away == null) continue;
    out.push({
      fixture_id: ev.id, taken_at: takenAt, bookmaker: bk.key,
      home_price: home, draw_price: draw, away_price: away,
    });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status, headers: { ...CORS, "Content-Type": "application/json" },
    });

  if (!ODDS_API_KEY || !SUPABASE_URL || !SERVICE_ROLE) {
    return reply(500, { error: "not configured" });
  }

  const left = await creditsLeft();
  if (left != null && left < RESERVE) {
    return reply(200, { skipped: "budget reserve", left });
  }

  const takenAt = new Date().toISOString();
  let written = 0, spent = 0;
  const failed: string[] = [];

  for (const sport of ODDS_SPORTS) {
    // Кредит резервируется ДО запроса: иначе при обрыве ответа потрачено
    // будет, а посчитано нет, и потолок перестанет быть потолком.
    if (!(await reserve(1))) { failed.push(`${sport}: budget`); break; }
    spent += 1;
    try {
      const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds`
        + `?apiKey=${ODDS_API_KEY}&regions=eu&markets=h2h&oddsFormat=decimal`;
      const r = await fetch(url);
      if (!r.ok) { failed.push(`${sport}: HTTP ${r.status}`); continue; }
      const events = (await r.json()) as OddsEvent[];
      const rows = events.flatMap((e) => rowsFor(e, takenAt));
      if (rows.length === 0) continue;
      // Пачками: одна лига может дать сотни строк, а PostgREST на большом теле
      // отвечает хуже, чем на нескольких средних.
      for (let i = 0; i < rows.length; i += 200) {
        const w = await rpc("upsert_fixture_odds", { p_rows: rows.slice(i, i + 200) });
        if (w.ok) written += Number(await w.json()) || 0;
        else failed.push(`${sport}: write ${w.status}`);
      }
    } catch (e) {
      failed.push(`${sport}: ${e instanceof Error ? e.message : "error"}`);
    }
  }

  return reply(200, { written, spent, left: await creditsLeft(), failed });
});
