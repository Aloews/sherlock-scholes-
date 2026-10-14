// Collect non-1X2 markets under the same hard monthly credit ceiling as scores
// and h2h odds. This endpoint is service-role-only; prices stay internal.
const ODDS_API_KEY = Deno.env.get("ODDS_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const REGION = "eu";
const RESERVE = 80;
const DEFAULT_REQUESTS_PER_RUN = 4;

const SPORTS = [
  "soccer_epl", "soccer_spain_la_liga", "soccer_italy_serie_a",
  "soccer_germany_bundesliga", "soccer_france_ligue_one",
  "soccer_russia_premier_league", "soccer_netherlands_eredivisie",
  "soccer_portugal_primeira_liga", "soccer_uefa_champs_league",
  "soccer_uefa_europa_league",
];
const MARKETS = ["totals", "spreads", "btts", "draw_no_bet"];
const SLOTS = SPORTS.flatMap((sport) => MARKETS.map((market) => ({ sport, market })));
const FETCH_MS = 20_000;
const bareFetch = globalThis.fetch;
const fetch = (input: string | URL | Request, init: RequestInit = {}): Promise<Response> =>
  bareFetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(FETCH_MS) });

interface Outcome { name?: string; price?: number; point?: number }
interface Market { key?: string; outcomes?: Outcome[] }
interface Bookmaker { key?: string; markets?: Market[] }
interface OddsEvent {
  id?: string;
  home_team?: string;
  away_team?: string;
  bookmakers?: Bookmaker[];
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<Response> {
  return fetch(SUPABASE_URL + "/rest/v1/rpc/" + fn, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE,
      Authorization: "Bearer " + SERVICE_ROLE,
    },
    body: JSON.stringify(args),
  });
}

async function creditsLeft(): Promise<number | null> {
  try {
    const response = await rpc("odds_credits_left", {});
    if (!response.ok) return null;
    const value = await response.json();
    return typeof value === "number" ? value : null;
  } catch {
    return null;
  }
}

async function reserveCredit(): Promise<boolean> {
  try {
    const response = await rpc("spend_odds_credits", { p_credits: 1 });
    return response.ok && (await response.json()) === true;
  } catch {
    return false;
  }
}

function selectionFor(market: string, name: string, event: OddsEvent): string | null {
  const value = name.trim().toLowerCase();
  if (market === "totals") return value === "over" || value === "under" ? value : null;
  if (market === "btts") return value === "yes" || value === "no" ? value : null;
  if (market === "spreads" || market === "draw_no_bet") {
    if (name === event.home_team) return "home";
    if (name === event.away_team) return "away";
    return null;
  }
  return null;
}

function canonicalLine(point: number | undefined): { line_key: string; line_value: number | null } {
  if (typeof point !== "number" || !Number.isFinite(point)) return { line_key: "main", line_value: null };
  const normalized = String(Number(point.toFixed(3)));
  return { line_key: normalized, line_value: point };
}

function rowsFor(event: OddsEvent, marketKey: string, observedAt: string) {
  if (!event.id || !event.home_team || !event.away_team) return [];
  const rows: Record<string, unknown>[] = [];
  for (const bookmaker of event.bookmakers ?? []) {
    if (!bookmaker.key) continue;
    const market = (bookmaker.markets ?? []).find((item) => item.key === marketKey);
    if (!market) continue;
    for (const outcome of market.outcomes ?? []) {
      if (!outcome.name || typeof outcome.price !== "number" || !Number.isFinite(outcome.price) || outcome.price <= 1) continue;
      const selection = selectionFor(marketKey, outcome.name, event);
      if (!selection) continue;
      const line = canonicalLine(outcome.point);
      if ((marketKey === "totals" || marketKey === "spreads") && line.line_value === null) continue;
      rows.push({
        fixture_id: event.id,
        observed_at: observedAt,
        provider_key: "the-odds-api",
        region: REGION,
        bookmaker: bookmaker.key,
        market_key: marketKey,
        selection_key: selection,
        line_key: line.line_key,
        line_value: line.line_value,
        price: outcome.price,
        raw_outcome: { name: outcome.name, point: outcome.point ?? null },
      });
    }
  }
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    }});
  }
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  if (!ODDS_API_KEY || !SUPABASE_URL || !SERVICE_ROLE) return reply(500, { error: "not configured" });
  if (req.headers.get("Authorization") !== "Bearer " + SERVICE_ROLE) {
    return reply(401, { error: "service role required" });
  }

  // Fail closed when the budget cannot be read. The reserve is shared with
  // score settlement and the existing h2h collector.
  const left = await creditsLeft();
  if (left === null) return reply(503, { error: "budget unavailable; no provider request made" });
  if (left <= RESERVE) return reply(200, { skipped: "shared budget reserve", credits_left: left });

  const configured = Number(Deno.env.get("MARKET_REQUESTS_PER_RUN") ?? DEFAULT_REQUESTS_PER_RUN);
  const perRun = Number.isFinite(configured) ? Math.min(8, Math.max(1, Math.floor(configured))) : DEFAULT_REQUESTS_PER_RUN;
  const affordable = Math.min(perRun, Math.max(0, left - RESERVE));
  if (affordable < 1) return reply(200, { skipped: "no credits above reserve", credits_left: left });

  let slotsResponse: Response;
  try {
    slotsResponse = await rpc("claim_market_collection_slots", {
      p_slots: SLOTS,
      p_limit: affordable,
    });
  } catch {
    return reply(503, { error: "market rotation state unavailable; no provider request made" });
  }
  if (!slotsResponse.ok) return reply(503, { error: "market rotation state unavailable; no provider request made" });
  const slots = await slotsResponse.json() as { sport: string; market: string }[];
  const observedAt = new Date().toISOString();
  let spent = 0, written = 0, eventsSeen = 0;
  const failures: string[] = [];

  for (const slot of slots) {
    // Reserve immediately before every paid call; concurrent collectors cannot
    // bypass the shared monthly cap.
    if (!(await reserveCredit())) {
      failures.push(slot.sport + "/" + slot.market + ":budget");
      break;
    }
    spent += 1;
    try {
      const url = new URL("https://api.the-odds-api.com/v4/sports/" + slot.sport + "/odds");
      url.searchParams.set("apiKey", ODDS_API_KEY);
      url.searchParams.set("regions", REGION);
      url.searchParams.set("markets", slot.market);
      url.searchParams.set("oddsFormat", "decimal");
      const response = await fetch(url);
      if (!response.ok) {
        failures.push(slot.sport + "/" + slot.market + ":HTTP_" + response.status);
        continue;
      }
      const events = await response.json() as OddsEvent[];
      eventsSeen += events.length;
      const rows = events.flatMap((event) => rowsFor(event, slot.market, observedAt));
      for (let i = 0; i < rows.length; i += 200) {
        const write = await rpc("upsert_market_odds", { p_rows: rows.slice(i, i + 200) });
        if (!write.ok) {
          failures.push(slot.sport + "/" + slot.market + ":db_write_" + write.status);
          break;
        }
        written += Number(await write.json()) || 0;
      }
    } catch (error) {
      failures.push(slot.sport + "/" + slot.market + ":" + (error instanceof Error ? error.name : "request_error"));
    }
  }

  const remaining = await creditsLeft();
  return reply(failures.length ? 207 : 200, {
    requested_slots: slots.length,
    events_seen: eventsSeen,
    quote_rows_written: written,
    credits_spent: spent,
    credits_left: remaining,
    failures,
    note: "Quotes are internal. Unsettleable lines are retained but must not be graded as losses.",
  });
});
