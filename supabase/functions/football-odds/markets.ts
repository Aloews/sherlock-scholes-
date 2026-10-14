export type SupportedMarket = "h2h" | "spreads" | "totals" | "btts";

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

const SUPPORTED = new Set<SupportedMarket>(["h2h", "spreads", "totals", "btts"]);

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
        if (key === "h2h") {
          if (name === event.home_team) outcomeKey = "home";
          else if (name === event.away_team) outcomeKey = "away";
          else if (normalized === "draw") outcomeKey = "draw";
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
