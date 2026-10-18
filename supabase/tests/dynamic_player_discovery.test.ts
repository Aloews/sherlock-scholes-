import { buildPlayerDiscoveryQuery, exactAgeBirthRange, parseDiscoveryIntent, parseWikidataResults } from "../functions/smart-deck-builder/discovery.ts";
Deno.test("Russian women footballer request extracts country and gender", () => {
  const intent = parseDiscoveryIntent("Футболистки России");
  if (!intent?.women || intent.country?.qid !== "Q159") throw new Error("women/Russia intent missing");
  if (intent.age !== null) throw new Error("unexpected age filter");
});
Deno.test("young Rubin players constrain age and club", () => {
  const intent = parseDiscoveryIntent("16-летние игроки Рубина");
  if (intent?.age !== 16 || intent.clubQuery !== "FC Rubin Kazan") throw new Error("age/club intent missing");
  const query = buildPlayerDiscoveryQuery(intent, "Q123456", new Date("2026-10-18T12:00:00Z"));
  if (!query.includes("wd:Q123456") || !query.includes("wdt:P569") || !query.includes("FILTER(?dob")) throw new Error("source query misses constraints");
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
