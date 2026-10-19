import { aggregateCompetitionRows, aggregateGoalThresholdRows, buildPlayerDiscoveryQuery, exactAgeBirthRange, parseDiscoveryIntent, parseWikidataResults } from "../functions/smart-deck-builder/discovery.ts";
Deno.test("Russian women footballer request extracts country and gender", () => {
  const intent = parseDiscoveryIntent("Футболистки России");
  if (!intent?.women || intent.country?.qid !== "Q159") throw new Error("women/Russia intent missing");
  if (intent.age !== null) throw new Error("unexpected age filter");
});
Deno.test("young Rubin players constrain age and club", () => {
  const intent = parseDiscoveryIntent("16-летние игроки Рубина");
  if (intent?.age !== 16 || intent.clubQuery !== "FC Rubin Kazan") throw new Error("age/club intent missing");
  const query = buildPlayerDiscoveryQuery(intent, "Q123456", new Date("2026-10-18T12:00:00Z"));
  if (!query.includes("wd:Q123456") || !query.includes("wikibase:timePrecision") || !query.includes("FILTER(?dob")) throw new Error("source query misses constraints");
});
Deno.test("age range is date-aware", () => {
  const range = exactAgeBirthRange(16, new Date("2026-10-18T12:00:00Z"));
  if (range?.after !== "2009-10-18" || range.before !== "2010-10-18") throw new Error(JSON.stringify(range));
});
Deno.test("only real Wikidata player entities with stable QIDs are returned", () => {
  const intent = parseDiscoveryIntent("Футболистки России")!;
  const rows = parseWikidataResults({ results: { bindings: [
    { item: { value: "http://www.wikidata.org/entity/Q123" }, nameRu: { value: "Тестовая футболистка" }, nameEn: { value: "Test Footballer" }, dob: { value: "2000-01-01T00:00:00Z" }, countryLabel: { value: "Россия" }, image: { value: "http://commons.wikimedia.org/wiki/Special:FilePath/Test.jpg" } },
    { item: { value: "http://www.wikidata.org/entity/Q0" }, nameRu: { value: "Invalid QID" } },
  ] } }, intent, new Date("2026-10-18T12:00:00Z"));
  if (rows.length !== 1 || rows[0].qid !== "Q123" || !rows[0].photoUrl?.includes("Special:FilePath")) throw new Error("source validation failed");
});

Deno.test("historical club requests capture decade constraints", () => {
  const intent = parseDiscoveryIntent("Real Madrid legends 2000s");
  if (intent?.clubQuery !== "Real Madrid CF" || intent.era?.start !== 2000 || intent.era.end !== 2009) {
    throw new Error("historical club intent missing");
  }
  const query = buildPlayerDiscoveryQuery(intent, "Q123456", new Date("2026-10-18T12:00:00Z"));
  if (!query.includes("pq:P580") || !query.includes("pq:P582") || !query.includes("2000-01-01")) {
    throw new Error("historical club period is not enforced");
  }
});
Deno.test("Russian position-only prompts are discoverable", () => {
  const intent = parseDiscoveryIntent("Вратари России");
  if (intent?.position !== "goalkeeper" || intent.country?.qid !== "Q159") throw new Error("position/country intent missing");
});

Deno.test("English women's-player prompts and additional nationalities remain constrained", () => {
  const intent = parseDiscoveryIntent("women footballers from England");
  if (!intent?.women || intent.country?.qid !== "Q21") {
    throw new Error("English women's-player intent missing");
  }
  const brazil = parseDiscoveryIntent("Brazilian footballers");
  if (brazil?.country?.qid !== "Q155") throw new Error("Brazilian nationality intent missing");
});

Deno.test("English Wikidata position labels can satisfy explicit position filters", () => {
  const intent = parseDiscoveryIntent("Вратари России");
  if (!intent) throw new Error("goalkeeper intent missing");
  const query = buildPlayerDiscoveryQuery(intent, null, new Date("2026-10-18T12:00:00Z"));
  if (!query.includes('LANG(?positionEn) = "en"') || !query.includes("BOUND(?positionEn)")) {
    throw new Error("position filter only supports Russian Wikidata labels");
  }
});

Deno.test("additional club aliases resolve to canonical search labels", () => {
  const intent = parseDiscoveryIntent("Tottenham players");
  if (intent?.clubQuery !== "Tottenham Hotspur") throw new Error("Tottenham alias missing");
  const madrid = parseDiscoveryIntent("Игроки Атлетико Мадрид");
  if (madrid?.clubQuery !== "Atlético Madrid") throw new Error("Atletico Madrid alias missing");
});

Deno.test("EPL goal thresholds use verified competition statistics", () => {
  const intent = parseDiscoveryIntent("Игроки АПЛ с более чем 100 голами");
  if (intent?.goalThreshold?.value !== 100 || intent.goalThreshold.inclusive ||
      intent.competitionId !== "GB1" || intent.clubQuery !== null) {
    throw new Error("EPL goal-threshold intent missing or misclassified");
  }
  const strict = aggregateGoalThresholdRows([
    { card_id: "a", goals: 60 }, { card_id: "a", goals: 45 },
    { card_id: "b", goals: 100 }, { card_id: "c", goals: "invalid" },
  ], 100, false);
  if (strict.length !== 1 || strict[0].cardId !== "a" || strict[0].goals !== 105) {
    throw new Error("strict goal threshold aggregation failed");
  }
  const inclusive = aggregateGoalThresholdRows([
    { card_id: "a", goals: 60 }, { card_id: "a", goals: 45 },
    { card_id: "b", goals: 100 },
  ], 100, true);
  if (inclusive.length !== 2 || inclusive[1].cardId !== "b") {
    throw new Error("inclusive goal threshold aggregation failed");
  }
});

Deno.test("teammate queries require overlapping verified club tenures", () => {
  const intent = parseDiscoveryIntent("Футболисты, выступавшие вместе с Роналду");
  if (!intent || intent.teammateName !== "Cristiano Ronaldo" || intent.clubQuery !== null) {
    throw new Error("teammate intent was mistaken for a club query");
  }
  const query = buildPlayerDiscoveryQuery(intent, null, new Date("2026-10-18T12:00:00Z"), "Q11571");
  if (!query.includes("wd:Q11571 p:P54") || !query.includes("?sharedClub") ||
      !query.includes("?teammateClubStart") || !query.includes("?candidateClubStart") ||
      !query.includes("FILTER(?item != wd:Q11571")) {
    throw new Error("teammate query does not enforce overlapping club tenures");
  }
  if (!query.includes("OPTIONAL { ?item p:P569")) {
    throw new Error("missing birth date should not exclude a player when age is not requested");
  }
});

Deno.test("nationality constraints do not change Ronaldo identity resolution", () => {
  const intent = parseDiscoveryIntent("Brazilian footballers who played with Ronaldo");
  if (!intent || intent.teammateName !== "Cristiano Ronaldo" || intent.country?.qid !== "Q155") {
    throw new Error("nationality was mistaken for Ronaldo Nazário");
  }
});

Deno.test("Brazil country names and national adjectives are both recognized", () => {
  const fromBrazil = parseDiscoveryIntent("Players from Brazil");
  const adjective = parseDiscoveryIntent("Brazilian footballers");
  if (fromBrazil?.country?.qid !== "Q155" || adjective?.country?.qid !== "Q155") {
    throw new Error("Brazil nationality alias missing");
  }
});

Deno.test("English Premier League is not misread as English nationality", () => {
  const league = parseDiscoveryIntent("Players in the English Premier League");
  if (!league || league.competitionId !== "GB1" || league.country !== null || league.clubQuery !== null) {
    throw new Error("league intent was misclassified as nationality or club");
  }
  const rows = aggregateCompetitionRows([
    { card_id: "a", goals: 10, apps: 20 },
    { card_id: "a", goals: 5, apps: 10 },
    { card_id: "b", goals: 3, apps: 50 },
    { card_id: "c", goals: 2, apps: 0 },
  ], null);
  if (rows.length !== 2 || rows[0].cardId !== "b" || rows[0].apps !== 50 || rows[1].goals !== 15) {
    throw new Error("competition aggregate ranking failed");
  }
});
