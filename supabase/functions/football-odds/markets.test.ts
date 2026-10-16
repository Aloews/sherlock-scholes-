import { creditCostForRequest, normalizeRegions, parseMarkets, rowsForMarkets, rotatingMarketsForDate, type OddsEventPayload } from "./markets.ts";

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

Deno.test("default market rotation preserves quota and cycles through secondary markets", () => {
  const first = rotatingMarketsForDate(new Date("2026-01-01T12:00:00Z"));
  const second = rotatingMarketsForDate(new Date("2026-01-03T12:00:00Z"));
  const third = rotatingMarketsForDate(new Date("2026-01-05T12:00:00Z"));
  const later = rotatingMarketsForDate(new Date("2026-01-17T12:00:00Z"));
  if (first.join(",") !== "h2h" || second.join(",") !== "h2h") throw new Error("h2h should remain the primary market");
  if (third.length !== 1 || !["spreads", "totals", "btts"].includes(third[0])) throw new Error("extra cycle must request one market");
  if (later.join(",") === third.join(",")) throw new Error("extra markets should rotate across cycles");
});

Deno.test("normalizes draw-no-bet, double chance and correct-score markets", () => {
  const event: OddsEventPayload = {
    id: "event-3", home_team: "Home FC", away_team: "Away FC",
    bookmakers: [{ key: "book-b", markets: [
      { key: "draw_no_bet", outcomes: [
        { name: "Home FC", price: 1.7 }, { name: "Away FC", price: 2.2 },
      ] },
      { key: "double_chance", outcomes: [
        { name: "Home FC or Draw", price: 1.3 },
        { name: "Draw or Away FC", price: 1.5 },
        { name: "Home FC or Away FC", price: 1.2 },
      ] },
      { key: "correct_score", outcomes: [
        { name: "2:1", price: 8.5 }, { name: "0-0", price: 7.0 },
      ] },
    ] }],
  };
  const rows = rowsForMarkets(event, "2026-10-14T12:00:00Z",
    ["draw_no_bet", "double_chance", "correct_score"]);
  if (rows.length !== 7) throw new Error("expected seven expanded-market rows, got " + rows.length);
  if (!rows.some((row) => row.market_key === "draw_no_bet" && row.outcome_key === "home")) throw new Error("DNB team mapping failed");
  if (!rows.some((row) => row.market_key === "double_chance" && row.outcome_key === "home_draw")) throw new Error("double-chance mapping failed");
  if (!rows.some((row) => row.market_key === "correct_score" && row.outcome_key === "2-1")) throw new Error("correct-score normalization failed");
});

Deno.test("API credit cost counts unique regions and each requested market", () => {
  if (creditCostForRequest(["h2h", "totals"], "eu, uk,eu") !== 4) throw new Error("region-market credit cost was undercounted");
  if (normalizeRegions(" EU, uk, eu ").join(",") !== "eu,uk") throw new Error("regions were not normalized and deduplicated");
  let threw = false;
  try { creditCostForRequest(["h2h"], " , "); } catch { threw = true; }
  if (!threw) throw new Error("empty region list should fail closed");
});
