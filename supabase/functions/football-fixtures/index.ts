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
// SCORES ARE THE OTHER ACTION, AND THEY COST. `{"action":"scores"}` calls
// /scores, one credit per competition, and settles the predictions waiting on
// it. It is DEMAND-DRIVEN rather than scheduled across the board: the database
// answers which competitions actually have an unsettled prediction on a match
// that has plausibly finished (`sports_awaiting_scores`), so a month with no
// predictions costs nothing. Asking all twenty every day would be 600 credits
// against a ceiling of 500 — the schedule alone would exhaust the budget.
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

/**
 * One event from /scores.
 *
 * `scores` is an array of two entries keyed by TEAM NAME, not by home/away, so
 * the side has to be resolved by matching the name back to the event's own
 * home_team/away_team. A positional read works until the provider reorders
 * them, and then it silently inverts every result.
 */
interface OddsApiScore {
  id?: string;
  completed?: boolean;
  home_team?: string;
  away_team?: string;
  scores?: { name?: string; score?: string }[] | null;
}

/** How far back /scores looks. Matches the seven-day floor in the SQL. */
const SCORES_DAYS_FROM = 3;

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
  const body = await req.json().catch(() => ({})) as { list?: boolean; action?: string };

  // Scores, and the settlement that depends on them. Separate action because
  // it SPENDS: one credit per competition, and only for competitions that have
  // somebody's prediction waiting on them.
  if (body?.action === "scores") return await runScores();

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

/**
 * Fetch scores for the competitions that owe somebody an answer, then settle.
 *
 * The order matters: reserve, fetch, write, settle. Reserving after the call
 * would let a failure spend nothing and a success spend nothing either, which
 * is how a 500-credit ceiling turns out to have been decorative.
 */
async function runScores(): Promise<Response> {
  const waiting = await rpc("sports_awaiting_scores", {});
  if (!waiting.ok) {
    console.error(`sports_awaiting_scores failed: ${waiting.status}`);
    return json({ error: "awaiting_failed" }, 503);
  }
  const sports = ((await waiting.json()) as { sport_key?: string }[])
    .map((row) => row.sport_key)
    .filter((key): key is string => typeof key === "string");

  // Nothing is waiting, so nothing is spent. This is the normal answer, not an
  // error: most days nobody has an unsettled prediction on a finished match.
  if (sports.length === 0) {
    return json({ sports: 0, scored: 0, settled: 0, credits_left: await creditsLeft() });
  }

  const rows: Record<string, unknown>[] = [];
  const failures: { sport: string; reason: string }[] = [];
  let spent = 0;

  for (const sport of sports) {
    // One credit, reserved BEFORE the call. A refusal here stops the loop
    // rather than skipping one competition: the budget is gone either way, and
    // continuing would produce a partial answer that looks complete.
    if (!(await reserve(1))) {
      failures.push({ sport, reason: "budget_exhausted" });
      break;
    }
    spent += 1;
    try {
      for (const event of await fetchScores(sport)) {
        const row = readScore(event);
        if (row) rows.push(row);
      }
    } catch (err) {
      console.error(`scores failed for ${sport}: ${err}`);
      failures.push({ sport, reason: String(err).slice(0, 200) });
    }
  }

  let written = 0;
  if (rows.length > 0) {
    const w = await rpc("upsert_fixture_scores", { p_rows: rows });
    if (!w.ok) {
      console.error(`upsert_fixture_scores failed: ${w.status}`);
      return json({ error: "write_failed", credits_spent: spent }, 503);
    }
    written = (await w.json()) as number;
  }

  // Settle even when nothing was written: a previous run may have stored a
  // score and failed here, and settlement is idempotent by construction.
  const settledRes = await rpc("settle_predictions", {});
  const settled = settledRes.ok ? ((await settledRes.json()) as number) : 0;

  return json({
    sports: sports.length,
    credits_spent: spent,
    scored: written,
    settled,
    failures,
    credits_left: await creditsLeft(),
  });
}

/**
 * A finished match, as a row for upsert_fixture_scores — or null.
 *
 * Null for anything still running: the provider reports a live match with
 * `completed: false` and partial or absent scores, and writing those would
 * un-finish a match we had already settled.
 */
function readScore(event: OddsApiScore): Record<string, unknown> | null {
  if (!event.id || event.completed !== true || !Array.isArray(event.scores)) return null;
  // By NAME, not by position — see OddsApiScore.
  const find = (team?: string) =>
    event.scores?.find((s) => s.name === team)?.score;
  const home = Number(find(event.home_team));
  const away = Number(find(event.away_team));
  if (!Number.isInteger(home) || !Number.isInteger(away)) return null;
  return { id: event.id, home_score: home, away_score: away, completed: true };
}

async function fetchScores(sport: string): Promise<OddsApiScore[]> {
  const url = `https://api.the-odds-api.com/v4/sports/${sport}/scores/` +
    `?daysFrom=${SCORES_DAYS_FROM}&apiKey=${ODDS_API_KEY}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  const body = await r.json();
  return Array.isArray(body) ? body as OddsApiScore[] : [];
}

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
