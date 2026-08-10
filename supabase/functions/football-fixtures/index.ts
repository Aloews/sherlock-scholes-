// ============================================================================
// football-fixtures — the match schedule, from the-odds-api.
//
// WHY THIS ENDPOINT AND NOT ANOTHER. `/events` costs ZERO credits and returns
// the fixture list as structured JSON. That single fact removed the most
// fragile part of the original plan: eight Wikipedia season-table parsers,
// each breaking independently, to produce a worse version of this.
//
// THE BUDGET IS A HARD CEILING, not a soft one. 500 credits a month, and past
// it the provider REFUSES rather than returning less — so a run that is not
// counted on our side is discovered at the end of the month, as an empty
// screen. Every call goes through `spend_odds_credits` BEFORE it is made, even
// the free ones, so there is one place that knows what we spend and no path
// around it. /events reserves zero and can therefore never be blocked by a
// budget it does not consume.
//
// THE KEY NEVER LEAVES THIS FUNCTION. ODDS_API_KEY is a Supabase secret; it is
// not VITE_-prefixed, is not in the repository, and is not echoed in any
// answer or log line. A leaked key is somebody else spending our 500.
//
// WHAT IT DOES NOT DO: scores. That is `/scores`, it costs a credit a call,
// and it is a separate deployment with its own schedule — the handoff is
// explicit that it must not start before the budget guard exists. The guard
// exists now; the schedule is the next decision, not this one.
// ============================================================================

const ODDS_API_KEY = Deno.env.get("ODDS_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

/**
 * The competitions we ask about.
 *
 * Deliberately explicit rather than "every soccer key the provider has":
 * /events is free per call but not free in time, and a fixture from a division
 * nobody here has a card for is a row that will never match a club.
 *
 * NATIONAL-TEAM TOURNAMENTS EARN THEIR PLACE differently from leagues. A club
 * fixture matches a club card; a national one matches nothing in this deck,
 * because we have no country cards — but it is the football people actually
 * talk about while a tournament is on, and a schedule that knows about the
 * league but not the Euros reads as broken rather than as scoped.
 *
 * Every key below was COPIED from the provider's own /sports answer on
 * 10 August 2026, not recalled. Send `{"list": true}` to read it again.
 */
const SPORT_KEYS = [
  // Europe's big five, plus the league this app's audience actually watches.
  "soccer_epl",
  "soccer_spain_la_liga",
  "soccer_italy_serie_a",
  "soccer_germany_bundesliga",
  "soccer_france_ligue_one",
  "soccer_russia_premier_league",
  "soccer_netherlands_eredivisie",
  "soccer_portugal_primeira_liga",
  "soccer_turkey_super_league",

  // ASIA AND THE AMERICAS. These are here for a reason found by counting: the
  // deck holds 1758 European players and 39 Asian ones, and the Asians it does
  // hold average HIGHER fame than the Europeans — the signature of a coverage
  // gap, not of a continent without notable players. These are the leagues
  // those players are in.
  "soccer_japan_j_league",
  "soccer_korea_kleague1",
  "soccer_china_superleague",
  "soccer_usa_mls",
  "soccer_mexico_ligamx",
  "soccer_brazil_campeonato",
  "soccer_argentina_primera_division",

  // Continental club football.
  "soccer_uefa_champs_league_qualification",
  "soccer_conmebol_copa_libertadores",
  "soccer_conmebol_copa_sudamericana",

  // National teams. Only the Nations League is carried right now, because the
  // provider lists a tournament while it is running and not before — see
  // SEASONAL_KEYS below.
  "soccer_uefa_nations_league",
];

/**
 * Tournaments that exist only while they are on.
 *
 * The provider does not carry a World Cup in August, and asking for one is not
 * an error — it is an off-season. Kept out of SPORT_KEYS so a quiet summer
 * does not fill `failures` with noise that hides a real, permanent typo; move
 * one here into SPORT_KEYS when its cycle comes round, or teach this to read
 * `{"list": true}` and decide for itself.
 *
 * Verified against the provider on 10 August 2026: of every national-team
 * competition, only the Nations League was listed. The World Cup had finished
 * in July.
 */
const SEASONAL_KEYS = [
  "soccer_fifa_world_cup",
  "soccer_uefa_european_championship",
  "soccer_conmebol_copa_america",
  "soccer_africa_cup_of_nations",
  "soccer_asian_cup",
  "soccer_concacaf_gold_cup",
];
void SEASONAL_KEYS;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

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

/** One event as the provider sends it. Only the fields we store. */
interface OddsApiEvent {
  id?: string;
  sport_key?: string;
  commence_time?: string;
  home_team?: string;
  away_team?: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  if (!ODDS_API_KEY) {
    // Named rather than silent: an empty key produces a 401 from the provider
    // that reads like our request was wrong, when the truth is that nobody has
    // set the secret.
    console.error("odds_api_not_configured: ODDS_API_KEY is not set");
    return json({ error: "odds_api_not_configured" }, 503);
  }

  // /events costs nothing, so this reserves zero — but it goes through the
  // same door as everything else, so there is exactly one place that decides
  // whether a call may be made.
  const allowed = await reserve(0);
  if (!allowed) return json({ error: "budget_exhausted" }, 429);

  // `{"list": true}` answers with the competitions the provider currently
  // carries, instead of fetching anything. /sports is free too, and this is
  // the only way to choose SPORT_KEYS from fact rather than from guesswork —
  // a key that does not exist fails silently as an empty fixture list.
  const body = await req.json().catch(() => ({})) as { list?: boolean };
  if (body?.list === true) {
    const r = await fetch(`https://api.the-odds-api.com/v4/sports?apiKey=${ODDS_API_KEY}`);
    if (!r.ok) return json({ error: "sports_failed", status: r.status }, 503);
    const all = await r.json() as { key?: string; title?: string; group?: string }[];
    return json({
      soccer: (Array.isArray(all) ? all : [])
        .filter((s) => (s.group ?? "").toLowerCase() === "soccer")
        .map((s) => ({ key: s.key, title: s.title })),
      credits_left: await creditsLeft(),
    });
  }

  const rows: Record<string, unknown>[] = [];
  const failures: { sport: string; reason: string }[] = [];

  for (const sport of SPORT_KEYS) {
    try {
      const events = await fetchEvents(sport);
      for (const event of events) {
        if (!event.id || !event.commence_time || !event.home_team || !event.away_team) continue;
        rows.push({
          id: event.id,
          sport_key: event.sport_key ?? sport,
          commence_at: event.commence_time,
          home_team: event.home_team,
          away_team: event.away_team,
          // Resolved in the database, where club_match_key already lives and
          // already reconciles "Arsenal F.C." with "Arsenal". Doing it here
          // would mean shipping every club name to this function and keeping
          // a second copy of the rule.
          home_card_id: await clubCard(event.home_team),
          away_card_id: await clubCard(event.away_team),
        });
      }
    } catch (err) {
      // One competition failing must not lose the other five. The answer says
      // which, so a persistent failure is visible rather than a quiet gap.
      console.error(`events failed for ${sport}: ${err}`);
      failures.push({ sport, reason: String(err).slice(0, 200) });
    }
  }

  if (rows.length === 0) {
    return json({ error: "no_events", failures }, failures.length > 0 ? 503 : 200);
  }

  const written = await rpc("upsert_fixtures", { p_rows: rows });
  if (!written.ok) {
    console.error(`upsert_fixtures failed: ${written.status}`);
    return json({ error: "write_failed" }, 503);
  }

  const matched = rows.filter((r) => r.home_card_id || r.away_card_id).length;
  return json({
    fixtures: rows.length,
    matched_to_cards: matched,
    sports: SPORT_KEYS.length - failures.length,
    failures,
    credits_left: await creditsLeft(),
  });
});

async function fetchEvents(sport: string): Promise<OddsApiEvent[]> {
  const url = `https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${ODDS_API_KEY}`;
  const r = await fetch(url);
  if (!r.ok) {
    // The body carries the provider's own reason (bad key, unknown sport, quota)
    // and none of it contains the key, which is only ever in the query string.
    throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  }
  const body = await r.json();
  return Array.isArray(body) ? body as OddsApiEvent[] : [];
}

async function clubCard(name: string): Promise<string | null> {
  try {
    const r = await rpc("club_card_by_name", { p_name: name });
    if (!r.ok) return null;
    const id = await r.json();
    return typeof id === "string" ? id : null;
  } catch {
    // An unmatched club is not a failure: the fixture is shown with the
    // provider's own names rather than disappearing.
    return null;
  }
}

async function reserve(credits: number): Promise<boolean> {
  try {
    const r = await rpc("spend_odds_credits", { p_credits: credits });
    if (!r.ok) return false;
    return (await r.json()) === true;
  } catch {
    // Refusing on an unreadable budget is the safe direction: spending we
    // cannot count is exactly what the ceiling exists to prevent.
    return false;
  }
}

async function creditsLeft(): Promise<number | null> {
  try {
    const r = await rpc("odds_credits_left", {});
    if (!r.ok) return null;
    const left = await r.json();
    return typeof left === "number" ? left : null;
  } catch {
    return null;
  }
}
