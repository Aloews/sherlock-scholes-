export type SupportedMarket = "h2h" | "h2h_2_way" | "spreads" | "totals" | "btts" | "draw_no_bet" | "double_chance" | "correct_score";

export interface MarketOutcome {
  name?: string;
  price?: number;
  point?: number;
}
export interface MarketPayload {
  key?: string;
  outcomes?: MarketOutcome[];
}
export interface BookmakerPayload {
  key?: string;
  markets?: MarketPayload[];
}
export interface OddsEventPayload {
  id?: string;
  home_team?: string;
  away_team?: string;
  bookmakers?: BookmakerPayload[];
}
export interface QuoteRow {
  fixture_id: string;
  taken_at: string;
  provider: string;
  bookmaker: string;
  region: string;
  market_key: SupportedMarket;
  outcome_key: string;
  outcome_name: string;
  point: number;
  price: number;
}

const SUPPORTED = new Set<SupportedMarket>(["h2h", "h2h_2_way", "spreads", "totals", "btts", "draw_no_bet", "double_chance", "correct_score"]);

export function parseMarkets(value: string | undefined): SupportedMarket[] {
  const raw = (value ?? "h2h").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  const invalid = raw.filter((item) => !SUPPORTED.has(item as SupportedMarket));
  if (invalid.length) throw new Error("Unsupported ODDS_MARKETS: " + invalid.join(","));
  return [...new Set(raw as SupportedMarket[])];
}

export function rowsForMarkets(
  event: OddsEventPayload,
  takenAt: string,
  markets: SupportedMarket[],
  region = "eu",
  provider = "the-odds-api",
): QuoteRow[] {
  if (!event.id || !event.home_team || !event.away_team) return [];
  const rows: QuoteRow[] = [];
  for (const bookmaker of event.bookmakers ?? []) {
    if (!bookmaker.key) continue;
    for (const market of bookmaker.markets ?? []) {
      if (!markets.includes(market.key as SupportedMarket)) continue;
      const key = market.key as SupportedMarket;
      for (const outcome of market.outcomes ?? []) {
        if (typeof outcome.price !== "number" || !Number.isFinite(outcome.price) || outcome.price <= 1) continue;
        const name = (outcome.name ?? "").trim();
        const normalized = name.toLowerCase();
        let outcomeKey: string | null = null;
        if (key === "h2h" || key === "h2h_2_way" || key === "draw_no_bet") {
          if (name === event.home_team) outcomeKey = "home";
          else if (name === event.away_team) outcomeKey = "away";
          else if (normalized === "draw") outcomeKey = "draw";
        } else if (key === "double_chance") {
          const compact = normalized.replaceAll(" ", "_").replaceAll("/", "_").replaceAll("-", "_");
          if (["home_or_draw", "1x", "home_draw"].includes(compact) || normalized === `${event.home_team.toLowerCase()} or draw`) outcomeKey = "home_draw";
          else if (["draw_or_away", "x2", "draw_away"].includes(compact) || normalized === `draw or ${event.away_team.toLowerCase()}`) outcomeKey = "draw_away";
          else if (["home_or_away", "12", "home_away"].includes(compact) || normalized === `${event.home_team.toLowerCase()} or ${event.away_team.toLowerCase()}`) outcomeKey = "home_away";
        } else if (key === "correct_score") {
          const score = normalized.replace(":", "-").replaceAll(" ", "");
          if (/^\d{1,3}-\d{1,3}$/.test(score)) outcomeKey = score;
        } else if (key === "spreads") {
          if (name === event.home_team) outcomeKey = "home";
          else if (name === event.away_team) outcomeKey = "away";
        } else if (key === "totals") {
          if (normalized === "over" || normalized.startsWith("over ")) outcomeKey = "over";
          else if (normalized === "under" || normalized.startsWith("under ")) outcomeKey = "under";
        } else if (key === "btts") {
          if (normalized === "yes") outcomeKey = "yes";
          else if (normalized === "no") outcomeKey = "no";
        }
        if (!outcomeKey) continue;
        rows.push({
          fixture_id: event.id,
          taken_at: takenAt,
          provider,
          bookmaker: bookmaker.key,
          region,
          market_key: key,
          outcome_key: outcomeKey,
          outcome_name: name,
          point: typeof outcome.point === "number" && Number.isFinite(outcome.point) ? outcome.point : 0,
          price: outcome.price,
        });
      }
    }
  }
  return rows;
}

const ROTATING_EXTRA_MARKETS: SupportedMarket[] = ["spreads", "totals", "btts"];

/** Budget-neutral default: two h2h collection cycles, then one extra market cycle. */
export function rotatingMarketsForDate(date: Date): SupportedMarket[] {
  const utcDay = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 86400000);
  const runSlot = Math.floor(utcDay / 2);
  if (runSlot % 3 !== 2) return ["h2h"];
  return [ROTATING_EXTRA_MARKETS[Math.floor(runSlot / 3) % ROTATING_EXTRA_MARKETS.length]];
}
