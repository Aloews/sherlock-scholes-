import { parseMarkets, rowsForMarkets, type OddsEventPayload } from "./markets.ts";

Deno.test("market list defaults to h2h and deduplicates explicit markets", () => {
  if (parseMarkets(undefined).join(",") !== "h2h") throw new Error("default market changed");
  if (parseMarkets("h2h,totals,h2h,btts").join(",") !== "h2h,totals,btts") throw new Error("dedupe failed");
});

Deno.test("unsupported markets fail closed", () => {
  let threw = false;
  try { parseMarkets("h2h,player_points"); } catch { threw = true; }
  if (!threw) throw new Error("unsupported market was accepted");
});

Deno.test("normalizes outcomes and keeps point lines distinct", () => {
  const event: OddsEventPayload = {
    id: "event-1", home_team: "Home FC", away_team: "Away FC",
    bookmakers: [{ key: "book-a", markets: [
      { key: "h2h", outcomes: [
        { name: "Home FC", price: 2.1 }, { name: "Draw", price: 3.2 }, { name: "Away FC", price: 3.5 },
      ] },
      { key: "totals", outcomes: [
        { name: "Over", point: 2.5, price: 1.9 }, { name: "Under", point: 2.5, price: 1.95 },
      ] },
      { key: "btts", outcomes: [{ name: "Yes", price: 1.8 }, { name: "No", price: 2.0 }] },
    ] }],
  };
  const rows = rowsForMarkets(event, "2026-10-14T12:00:00Z", ["h2h", "totals", "btts"]);
  if (rows.length !== 7) throw new Error("expected seven quote rows, got " + rows.length);
  if (rows.find((row) => row.market_key === "h2h" && row.outcome_key === "draw")?.price !== 3.2) throw new Error("draw mapping failed");
  if (rows.find((row) => row.market_key === "totals" && row.outcome_key === "over")?.point !== 2.5) throw new Error("line point lost");
  if (rows.some((row) => row.price <= 1)) throw new Error("invalid decimal odds leaked");
});

Deno.test("team names, not outcome order, determine home and away", () => {
  const event: OddsEventPayload = {
    id: "event-2", home_team: "Home", away_team: "Away",
    bookmakers: [{ key: "b", markets: [{ key: "spreads", outcomes: [
      { name: "Away", point: -0.5, price: 2.1 }, { name: "Home", point: 0.5, price: 1.8 },
    ] }] }],
  };
  const rows = rowsForMarkets(event, "2026-10-14T12:00:00Z", ["spreads"]);
  if (rows[0]?.outcome_key !== "away" || rows[1]?.outcome_key !== "home") throw new Error("team mapping depends on order");
});
