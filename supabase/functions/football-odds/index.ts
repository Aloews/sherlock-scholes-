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
// По умолчанию собирается один рынок на запрос: h2h в двух из трёх циклов,
// затем spreads/totals/btts по очереди. Это расширяет покрытие без увеличения
// исходной квоты; ODDS_MARKETS явно переопределяет набор, но тратит больше кредитов.
// Каждый запрос оставляет 80 кредитов для более важных live-score вызовов.

import { parseMarkets, rowsForMarkets, rotatingMarketsForDate, type SupportedMarket } from "./markets.ts";

const ODDS_API_KEY = Deno.env.get("ODDS_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const MARKETS_OVERRIDE = Deno.env.get("ODDS_MARKETS");
const FIXED_MARKETS: SupportedMarket[] | null = MARKETS_OVERRIDE === undefined ? null : parseMarkets(MARKETS_OVERRIDE);
const REGION = Deno.env.get("ODDS_REGION") ?? "eu";

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
function marketsForRun(timestamp: string): SupportedMarket[] {
  return FIXED_MARKETS !== null ? FIXED_MARKETS : rotatingMarketsForDate(new Date(timestamp));
}

// Ниже этого остатка обход не начинается: живому счёту нужно ~8 кредитов в
// сутки, и отнять их у него ради котировок значит поменять то, что на экране,
// на то, что внутри.
const RESERVE = 80;


/**
 * ⚠️ СРОК У КАЖДОГО ОБРАЩЕНИЯ НАРУЖУ, И ОН СТАВИТСЯ ОДИН РАЗ НА ВЕСЬ МОДУЛЬ.
 *
 * Запрос без срока НЕ ПАДАЕТ — он висит. Висящий сборщик неотличим от
 * работающего, и ровно этим ночной обход шёл 3 ч 36 мин при бюджете 80 минут;
 * разбор — в CLAUDE.md, «Прогон по расписанию обязан уметь краснеть».
 *
 * ⚠️ ЗАТЕНЕНИЕ `fetch`, А НЕ ПРАВКА КАЖДОГО ВЫЗОВА. Мест вызова в Edge-функциях
 * этого проекта тридцать три; поправить их по одному значит оставить без срока
 * тридцать четвёртый, дописанный завтра. Здесь же новый вызов получает срок
 * просто потому, что написан в этом файле.
 *
 * Свой `signal` у вызова ПОБЕЖДАЕТ: `init.signal ?? …` — то есть место, которому
 * нужен другой срок или отмена по своей причине, ничего не теряет.
 *
 * Двадцать секунд с запасом покрывают любой здоровый ответ: замеры
 * соседних функций — 164–2600 мс.
 */
const FETCH_MS = 20_000;
const bareFetch = globalThis.fetch;
const fetch = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> =>
  bareFetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(FETCH_MS) });

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

async function isMissingRpc(response: Response): Promise<boolean> {
  if (response.status === 404) return true;
  try {
    const body = await response.clone().json();
    return body?.code === "PGRST202" || body?.code === "42883";
  } catch {
    return false;
  }
}

async function reserveRequest(
  requestKey: string, sport: string, requestedMarkets: SupportedMarket[],
): Promise<SupportedMarket[] | null> {
  try {
    const r = await rpc("reserve_odds_api_request", {
      p_request_key: requestKey, p_provider: "the-odds-api", p_sport_key: sport,
      p_region: REGION, p_markets: requestedMarkets, p_credits: requestedMarkets.length,
    });
    if (r.ok) return (await r.json()) === true ? requestedMarkets : null;
    // Safe rollout compatibility before the migration is applied: only retain
    // legacy h2h calls under the old budget RPC. Never request extra markets
    // without the new request ledger and generic quote table.
    if (await isMissingRpc(r)) {
      const legacy = await rpc("spend_odds_credits", { p_credits: 1 });
      return legacy.ok && (await legacy.json()) === true ? ["h2h"] : null;
    }
    return null;
  } catch {
    return null;
  }
}

async function finishRequest(
  requestKey: string, status: "success" | "failed",
  responseCount: number | null, providerRemaining: number | null, errorCode: string | null,
): Promise<void> {
  try {
    await rpc("finish_odds_api_request", {
      p_request_key: requestKey, p_status: status, p_response_count: responseCount,
      p_provider_remaining: providerRemaining, p_error_code: errorCode,
    });
  } catch {
    // The reservation remains auditable as reserved if finalization cannot be recorded.
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

  if (FIXED_MARKETS !== null && FIXED_MARKETS.length === 0) return reply(500, { error: "ODDS_MARKETS must include at least one supported market" });
  for (const sport of ODDS_SPORTS) {
    const requestedMarkets = marketsForRun(takenAt);
    if (requestedMarkets.length === 0) return reply(500, { error: "ODDS_MARKETS must include at least one supported market" });
    // One idempotent reservation per UTC date, sport and market set. Credits are
    // reserved before the provider request; fallback may reduce this to legacy h2h.
    const available = await creditsLeft();
    if (available !== null && available < RESERVE + requestedMarkets.length) {
      failed.push(`${sport}: preserving the ${RESERVE}-credit live-score reserve`);
      break;
    }
    const requestKey = `${new Date().toISOString().slice(0, 10)}:${sport}:${REGION}:${requestedMarkets.join(",")}`;
    const activeMarkets = await reserveRequest(requestKey, sport, requestedMarkets);
    if (!activeMarkets) {
      failed.push(`${sport}: budget exhausted or request already reserved today`);
      break;
    }
    spent += activeMarkets.length;
    try {
      const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds`
        + `?apiKey=${ODDS_API_KEY}&regions=${REGION}&markets=${activeMarkets.join(",")}&oddsFormat=decimal`;
      const r = await fetch(url);
      const remainingHeader = r.headers.get("x-requests-remaining");
      const providerRemaining = remainingHeader && /^\d+$/.test(remainingHeader) ? Number(remainingHeader) : null;
      if (!r.ok) {
        await finishRequest(requestKey, "failed", null, providerRemaining, `http_${r.status}`);
        failed.push(`${sport}: HTTP ${r.status}`);
        continue;
      }
      const events = (await r.json()) as OddsEvent[];
      const quoteRows = events.flatMap((event) => rowsForMarkets(event, takenAt, activeMarkets, REGION));
      let writeFailed = false;
      for (let i = 0; i < quoteRows.length; i += 200) {
        const w = await rpc("upsert_fixture_market_quotes", { p_rows: quoteRows.slice(i, i + 200) });
        if (w.ok) written += Number(await w.json()) || 0;
        else if (!(activeMarkets.length === 1 && activeMarkets[0] === "h2h" && await isMissingRpc(w))) {
          writeFailed = true;
          failed.push(`${sport}: market quote write ${w.status}`);
        }
      }
      // Preserve the legacy 1X2 table used by the existing admin forecast board.
      if (activeMarkets.includes("h2h")) {
        const legacyRows = events.flatMap((event) => rowsFor(event, takenAt));
        for (let i = 0; i < legacyRows.length; i += 200) {
          const w = await rpc("upsert_fixture_odds", { p_rows: legacyRows.slice(i, i + 200) });
          if (w.ok) written += Number(await w.json()) || 0;
          else { writeFailed = true; failed.push(`${sport}: legacy h2h write ${w.status}`); }
        }
      }
      await finishRequest(requestKey, writeFailed ? "failed" : "success", events.length, providerRemaining,
        writeFailed ? "database_write_failed" : null);
    } catch (e) {
      await finishRequest(requestKey, "failed", null, null, "request_or_parse_failed");
      const message = e instanceof Error ? e.message : "error";
      failed.push(`${sport}: ${message.split(ODDS_API_KEY).join("[redacted]")}`);
    }
  }

  return reply(200, { written, spent, left: await creditsLeft(), failed });
});
