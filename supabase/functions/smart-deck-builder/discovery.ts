export type DiscoveryIntent = {
  age: number | null;
  women: boolean;
  country: { label: string; qid: string } | null;
  clubQuery: string | null;
};
export type DiscoveredPlayer = {
  qid: string; name: string; nameEn: string | null; bornOn: string | null;
  country: string | null; positionRu: string | null; photoUrl: string | null;
  women: boolean; sourceUrl: string;
};
const COUNTRIES: Array<{ pattern: RegExp; label: string; qid: string }> = [
  { pattern: /росси|russia|russian/i, label: "Россия", qid: "Q159" },
  { pattern: /испан|spain|spanish/i, label: "Испания", qid: "Q29" },
  { pattern: /англи|england|english/i, label: "Англия", qid: "Q21" },
  { pattern: /франц|france|french/i, label: "Франция", qid: "Q142" },
  { pattern: /бразил|brazilian/i, label: "Бразилия", qid: "Q155" },
  { pattern: /аргентин|argentina/i, label: "Аргентина", qid: "Q414" },
  { pattern: /герман|germany|german/i, label: "Германия", qid: "Q183" },
  { pattern: /американ|usa|united states/i, label: "США", qid: "Q30" },
];
const CLUB_ALIASES: Array<{ pattern: RegExp; query: string }> = [
  { pattern: /рубин(а|у|ом)?|rubin kazan/i, query: "FC Rubin Kazan" },
  { pattern: /спартак(а|у|ом)?(?: москв)?|spartak moscow/i, query: "FC Spartak Moscow" },
  { pattern: /зенит(а|у|ом)?|zenit st petersburg/i, query: "FC Zenit Saint Petersburg" },
  { pattern: /цска|cska moscow/i, query: "PFC CSKA Moscow" },
  { pattern: /краснодар(а|у|ом)?|fc krasnodar/i, query: "FC Krasnodar" },
  { pattern: /реал мадрид|реала|real madrid/i, query: "Real Madrid CF" },
  { pattern: /барселон[аыуе]?|барс[аы]?|barcelona|barça/i, query: "FC Barcelona" },
  { pattern: /челси|chelsea/i, query: "Chelsea FC" },
  { pattern: /арсенал[а]?|arsenal/i, query: "Arsenal FC" },
  { pattern: /ливерпул[яь]?|liverpool/i, query: "Liverpool FC" },
  { pattern: /манчестер сити|manchester city/i, query: "Manchester City FC" },
  { pattern: /манчестер юнайтед|manchester united/i, query: "Manchester United FC" },
  { pattern: /бавари[яюи]?|bayern munich/i, query: "FC Bayern Munich" },
  { pattern: /псж|пари сен-жермен|paris saint.germain/i, query: "Paris Saint-Germain FC" },
  { pattern: /ювентус[а]?|juventus/i, query: "Juventus FC" },
  { pattern: /милан[а]?|ac milan/i, query: "AC Milan" },
  { pattern: /интер[а]?|inter milan/i, query: "Inter Milan" },
];
const PLAYER_REQUEST = /футболист|игрок|footballer|players?\b|strikers?\b|goalkeepers?\b|midfielders?\b|defenders?\b/i;
const WOMEN_REQUEST = /футболистк|женщин\w*\s+футбол|женск\w*\s+футбол|women'?s football|female players?|women players?/i;

export function parseDiscoveryIntent(prompt: string): DiscoveryIntent | null {
  if (!PLAYER_REQUEST.test(prompt)) return null;
  const ageMatch = prompt.match(/\b(1[0-9]|[1-9])\s*[- ]?(?:летн\w*|лет|years?\s*old|yo)\b/i);
  const age = ageMatch ? Number(ageMatch[1]) : null;
  const country = COUNTRIES.find((entry) => entry.pattern.test(prompt)) ?? null;
  const club = CLUB_ALIASES.find((entry) => entry.pattern.test(prompt));
  let clubQuery = club?.query ?? null;
  if (!clubQuery && !country) {
    const match = prompt.match(/(?:игроки|игроков|футболисты|футболистки|footballers|players)\s+(?:клуба\s+|of\s+)?[«"']?([\p{L}\p{N} .'-]{2,60})/iu);
    const candidate = match?.[1]?.replace(/\b(?:в возрасте|возрастом|лет|years?|aged|under|over)\b.*$/i, "")
      .replace(/\b20\d{2}(?:[-/–]\d{2,4})?\b.*$/i, "").trim();
    if (candidate && candidate.length >= 2 && !COUNTRIES.some((entry) => entry.pattern.test(candidate))) clubQuery = candidate;
  }
  return { age, women: WOMEN_REQUEST.test(prompt), country, clubQuery };
}
export function exactAgeBirthRange(age: number, now = new Date()): { after: string; before: string } | null {
  if (!Number.isInteger(age) || age < 1 || age > 99) return null;
  const end = new Date(Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(Date.UTC(now.getUTCFullYear() - age - 1, now.getUTCMonth(), now.getUTCDate()));
  return { after: start.toISOString().slice(0, 10), before: end.toISOString().slice(0, 10) };
}
export function buildPlayerDiscoveryQuery(intent: DiscoveryIntent, clubQid: string | null, now = new Date()): string {
  const clauses = [
    "?item wdt:P106/wdt:P279* wd:Q937857.", "?item wdt:P569 ?dob.",
    "OPTIONAL { ?item wdt:P413 ?position. ?position rdfs:label ?positionRu. FILTER(LANG(?positionRu) = \"ru\") }",
    "OPTIONAL { ?item wdt:P18 ?image. }",
    "OPTIONAL { ?item wdt:P27 ?citizenship. ?citizenship rdfs:label ?countryLabel. FILTER(LANG(?countryLabel) = \"ru\") }",
    "OPTIONAL { ?item rdfs:label ?nameRu. FILTER(LANG(?nameRu) = \"ru\") }",
    "OPTIONAL { ?item rdfs:label ?nameEn. FILTER(LANG(?nameEn) = \"en\") }",
  ];
  if (intent.country) clauses.push(`?item wdt:P27 wd:${intent.country.qid}.`);
  if (intent.women) clauses.push("?item wdt:P21 wd:Q6581072.");
  if (clubQid) clauses.push(`?item p:P54 ?clubStatement. ?clubStatement ps:P54 wd:${clubQid}. FILTER NOT EXISTS { ?clubStatement pq:P582 ?clubEnd. }`);
  if (intent.age !== null) {
    const range = exactAgeBirthRange(intent.age, now);
    if (range) clauses.push(`FILTER(?dob > "${range.after}"^^xsd:dateTime && ?dob < "${range.before}T23:59:59Z"^^xsd:dateTime)`);
  }
  return `SELECT DISTINCT ?item ?nameRu ?nameEn ?dob ?countryLabel ?positionRu ?image WHERE {
  ${clauses.join("\n  ")}
} LIMIT 100`;
}
function toDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const date = value.slice(0, 10);
  return Number.isNaN(Date.parse(date)) ? null : date;
}
export function parseWikidataResults(payload: unknown, intent: DiscoveryIntent, now = new Date()): DiscoveredPlayer[] {
  const bindings = (payload as { results?: { bindings?: Array<Record<string, { value?: string }>> } })?.results?.bindings;
  if (!Array.isArray(bindings)) return [];
  const out = new Map<string, DiscoveredPlayer>();
  for (const row of bindings) {
    const qid = (row.item?.value ?? "").match(/\/entity\/(Q[1-9][0-9]*)$/)?.[1];
    const name = row.nameRu?.value?.trim() || row.nameEn?.value?.trim();
    const bornOn = toDate(row.dob?.value);
    if (!qid || !name || name.length > 160) continue;
    if (intent.age !== null) {
      if (!bornOn) continue;
      const date = new Date(`${bornOn}T00:00:00Z`);
      let actualAge = now.getUTCFullYear() - date.getUTCFullYear();
      if (now.getUTCMonth() < date.getUTCMonth() ||
          (now.getUTCMonth() === date.getUTCMonth() && now.getUTCDate() < date.getUTCDate())) actualAge--;
      if (actualAge !== intent.age) continue;
    }
    const image = row.image?.value;
    const photoUrl = image?.startsWith("http://") || image?.startsWith("https://")
      ? `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(image.split("/").pop() ?? "")}`
      : null;
    out.set(qid, {
      qid, name, nameEn: row.nameEn?.value?.trim() || null, bornOn,
      country: row.countryLabel?.value?.trim() || intent.country?.label || null,
      positionRu: row.positionRu?.value?.trim() || null, photoUrl,
      women: intent.women, sourceUrl: `https://www.wikidata.org/wiki/${qid}`,
    });
  }
  return [...out.values()].slice(0, 50);
}
async function resolveClubQid(query: string): Promise<string | null> {
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.search = new URLSearchParams({ action: "wbsearchentities", search: query, language: "en", uselang: "en", type: "item", limit: "8", format: "json" }).toString();
  const response = await fetch(url, { headers: { "User-Agent": "SherlockScholes/1.0 (football player discovery; contact via GitHub)" }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`wikidata_search_http_${response.status}`);
  const payload = await response.json() as { search?: Array<{ id?: string; label?: string; description?: string }> };
  const club = (payload.search ?? []).find((entry) =>
    /^Q[1-9][0-9]*$/.test(entry.id ?? "") &&
    /football club|association football club|women.s football club/i.test(entry.description ?? "")
  );
  return club?.id ?? null;
}
export async function discoverFootballPlayers(supabase: any, prompt: string): Promise<{ discovered: number; created: number; matched: number; cardIds: string[] }> {
  const intent = parseDiscoveryIntent(prompt);
  if (!intent) return { discovered: 0, created: 0, matched: 0, cardIds: [] };
  let clubQid: string | null = null;
  if (intent.clubQuery) {
    clubQid = await resolveClubQid(intent.clubQuery);
    if (!clubQid) return { discovered: 0, created: 0, matched: 0, cardIds: [] };
  }
  const response = await fetch("https://query.wikidata.org/sparql", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "Accept": "application/sparql-results+json", "User-Agent": "SherlockScholes/1.0 (football player discovery; contact via GitHub)" },
    body: new URLSearchParams({ query: buildPlayerDiscoveryQuery(intent, clubQid), format: "json" }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`wikidata_sparql_http_${response.status}`);
  const candidates = parseWikidataResults(await response.json(), intent);
  let created = 0; let matched = 0; const cardIds = new Set<string>();
  for (let i = 0; i < candidates.length; i += 8) {
    await Promise.all(candidates.slice(i, i + 8).map(async (candidate) => {
      const { data: existing, error: lookupError } = await supabase.from("cards").select("id")
        .eq("wikidata_qid", candidate.qid).limit(1).maybeSingle();
      if (lookupError) throw new Error("canonical_card_lookup_failed");
      const { data, error } = await supabase.rpc("upsert_discovered_player_card", {
        p_wikidata_qid: candidate.qid, p_name: candidate.name, p_name_en: candidate.nameEn,
        p_born_on: candidate.bornOn, p_country: candidate.country, p_position_ru: candidate.positionRu,
        p_photo_url: candidate.photoUrl, p_tags: candidate.women ? ["women", "female", "footballer"] : ["footballer"],
        p_facts: { source: "wikidata", source_url: candidate.sourceUrl, verified_at: new Date().toISOString() },
      });
      if (error || !data) throw new Error("canonical_card_upsert_failed");
      cardIds.add(String(data));
      if (existing) matched++; else created++;
    }));
  }
  return { discovered: candidates.length, created, matched, cardIds: [...cardIds] };
}
