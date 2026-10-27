import { discoverFootballPlayers } from "../functions/smart-deck-builder/discovery.ts";

Deno.test("competition goal discovery reads canonical career competition totals", async () => {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const stats = [
    { card_id: "player-1", goals: 150, apps: 220 },
    { card_id: "player-2", goals: 88, apps: 170 },
  ];
  const cards = [{ id: "player-1" }, { id: "player-2" }];

  const supabase = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = (method: string) => (...args: unknown[]) => {
        calls.push({ table, method, args });
        return builder;
      };
      builder.select = chain("select");
      builder.eq = chain("eq");
      builder.gt = chain("gt");
      builder.order = chain("order");
      builder.range = chain("range");
      builder.in = chain("in");
      builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({
          data: table === "football_player_competition_totals" ? stats : cards,
          error: null,
        }).then(resolve, reject);
      return builder;
    },
  };

  const result = await discoverFootballPlayers(supabase, "EPL players with more than 100 goals");
  if (!result.constrained || result.cardIds.length !== 1 || result.cardIds[0] !== "player-1") {
    throw new Error("competition discovery must rank canonical career totals and enforce the goal threshold");
  }
  if (!calls.some((call) => call.table === "football_player_competition_totals")) {
    throw new Error("canonical competition totals view was not queried");
  }
  if (calls.some((call) => call.table === "player_season_stat")) {
    throw new Error("raw provider snapshots must not be used for competition career ranking");
  }
  const selected = calls.find((call) => call.table === "football_player_competition_totals" && call.method === "select");
  if (!selected || selected.args[0] !== "card_id,goals,apps:appearances") {
    throw new Error("discovery must use the canonical appearances field");
  }
});
