export type DiscoveryIntent = {
  age: number | null;
  women: boolean;
  country: { label: string; qid: string } | null;
  clubQuery: string | null;
  position: "goalkeeper" | "defender" | "midfielder" | "forward" | null;
  era: { start: number; end: number } | null;
  goalThreshold: { value: number; inclusive: boolean } | null;
  competitionId: string | null;
  teammateName: string | null;
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
  { pattern: /бразил|brazil/i, label: "Бразилия", qid: "Q155" },
  { pattern: /аргентин|argentina/i, label: "Аргентина", qid: "Q414" },
  { pattern: /герман|germany|german/i, label: "Германия", qid: "Q183" },
  { pattern: /американ|usa|united states|\bunited states of america\b/i, label: "США", qid: "Q30" },
  { pattern: /португал|portugal|portuguese/i, label: "Португалия", qid: "Q45" },
  { pattern: /нидерланд|голланд|netherlands|dutch/i, label: "Нидерланды", qid: "Q55" },
  { pattern: /бельги|belgium|belgian/i, label: "Бельгия", qid: "Q31" },
  { pattern: /хорват|croatia|croatian/i, label: "Хорватия", qid: "Q224" },
  { pattern: /уругва|uruguay|uruguayan/i, label: "Уругвай", qid: "Q77" },
  { pattern: /мексик|mexico|mexican/i, label: "Мексика", qid: "Q96" },
  { pattern: /япон|japan|japanese/i, label: "Япония", qid: "Q17" },
  { pattern: /южн(?:ая|ой) коре|south korea|south korean/i, label: "Южная Корея", qid: "Q884" },
  { pattern: /нигери|nigeria|nigerian/i, label: "Нигерия", qid: "Q1033" },
  { pattern: /швед|sweden|swedish/i, label: "Швеция", qid: "Q34" },
  { pattern: /норвег|norway|norwegian/i, label: "Норвегия", qid: "Q20" },
  { pattern: /датчан|дания|denmark|danish/i, label: "Дания", qid: "Q35" },
  { pattern: /польш|poland|polish/i, label: "Польша", qid: "Q36" },
  { pattern: /украин|ukraine|ukrainian/i, label: "Украина", qid: "Q212" },
  { pattern: /марокк|morocco|moroccan/i, label: "Марокко", qid: "Q1028" },
  { pattern: /египет|egypt|egyptian/i, label: "Египет", qid: "Q79" },
  { pattern: /сенегал|senegalese/i, label: "Сенегал", qid: "Q1041" },
  { pattern: /кот-д.?иву|ivory coast|ivorian|côte d.?ivoire/i, label: "Кот-д’Ивуар", qid: "Q1008" },
  { pattern: /ган[ае]|ghana|ghanaian/i, label: "Гана", qid: "Q117" },
  { pattern: /камерун|cameroon|cameroonian/i, label: "Камерун", qid: "Q1009" },
  { pattern: /колумби|colombia|colombian/i, label: "Колумбия", qid: "Q739" },
  { pattern: /чили|chile|chilean/i, label: "Чили", qid: "Q298" },
  { pattern: /турци|турция|turkey|turkish/i, label: "Турция", qid: "Q43" },
  { pattern: /швейцар|switzerland|swiss/i, label: "Швейцария", qid: "Q39" },
  { pattern: /австри|austria|austrian/i, label: "Австрия", qid: "Q40" },
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
  { pattern: /атлетико мадрид|атлетико|atlético madrid|atletico madrid/i, query: "Atlético Madrid" },
  { pattern: /тоттенх[эе]м|tottenham/i, query: "Tottenham Hotspur" },
  { pattern: /борусси[яи] дортмунд|дортмунд|borussia dortmund/i, query: "Borussia Dortmund" },
  { pattern: /brighton|брайтон/i, query: "Brighton & Hove Albion FC" },
  { pattern: /аякс|ajax/i, query: "AFC Ajax" },
  { pattern: /наполи|napoli/i, query: "SSC Napoli" },
  { pattern: /рома|as roma/i, query: "AS Roma" },
  { pattern: /порту(?:гал)?|fc porto/i, query: "FC Porto" },
  { pattern: /бенфика|benfica/i, query: "SL Benfica" },
  { pattern: /севилья|sevilla/i, query: "Sevilla FC" },
  { pattern: /валенсия|valencia cf/i, query: "Valencia CF" },
  { pattern: /лион|olympique lyonnais|lyon/i, query: "Olympique Lyonnais" },
  { pattern: /марсель|olympique de marseille|marseille/i, query: "Olympique de Marseille" },
];
const PLAYER_REQUEST = /футболист|игрок|вратар|голкипер|защитник|полузащитник|нападающ|форвард|footballer|players?\b|strikers?\b|goalkeepers?\b|midfielders?\b|defenders?\b|легенд[а-яё]*|legends?\b/i;
const WOMEN_REQUEST = /футболистк|женщин[а-яё]*\s+футбол|женск[а-яё]*\s+футбол|women\x27?s football|female (?:footballers?|players?)|women (?:footballers?|players?)/i;

export function parseDiscoveryIntent(prompt: string): DiscoveryIntent | null {
  if (!PLAYER_REQUEST.test(prompt)) return null;
  const ageMatch = prompt.match(/\b(1[0-9]|[1-9])\s*[- ]?(?:летн[а-яё]*|лет|years?\s*old|yo)(?=\s|$|[.,!?])/i);
  const age = ageMatch ? Number(ageMatch[1]) : null;
  const countryPrompt = prompt.replace(/\benglish premier league\b/ig, " ").replace(/премьер-лиг[а-яё]*\s+англи[а-яё]*/ig, " ");
  const country = COUNTRIES.find((entry) => entry.pattern.test(countryPrompt)) ?? null;
  const club = CLUB_ALIASES.find((entry) => entry.pattern.test(prompt));
  let clubQuery = club?.query ?? null;
  const position = /вратар|голкипер|goalkeeper|keeper/i.test(prompt) ? "goalkeeper"
    : /защитник|защитники|defender/i.test(prompt) ? "defender"
    : /полузащитник|опорник|midfielder/i.test(prompt) ? "midfielder"
    : /нападающ|форвард|striker|forward/i.test(prompt) ? "forward" : null;
  const decade = prompt.match(/\b(19|20)(\d)0(?:-?х|s)\b/i);
  const era = decade ? { start: Number(`${decade[1]}${decade[2]}0`), end: Number(`${decade[1]}${decade[2]}9`) } : null;
  const goalMatch = prompt.match(/\b(?:more than|over|greater than|at least)\s+(\d{1,4})\s+goals?\b|(?:более(?:\s+чем)?|свыше|больше(?:\s+чем)?|не менее)\s*(\d{1,4})\s*гол(?:а|ов|ами)?/i);
  const goalValue = goalMatch ? Number(goalMatch[1] ?? goalMatch[2]) : null;
  const goalThreshold = goalValue !== null && Number.isFinite(goalValue)
    ? { value: goalValue, inclusive: /(?:at least|не менее|>=)/i.test(prompt) }
    : null;
  const competitionId = /\b(?:epl|english premier league)\b|апл|премьер-лиг[а-яё]* англи/i.test(prompt) ? "GB1" : null;
  const teammateName = /(?:выступавш[а-яё]*\s+вместе\s+с|игравш[а-яё]*\s+вместе\s+с|вместе\s+с|played\s+with|played\s+alongside|teammates?\s+with)\s+(?:криштиану\s+)?(?:роналду|ronaldo|назарио)/i.test(prompt)
    ? (/(?:роналдо\s+)?назарио|nazario|brazilian\s+ronaldo/i.test(prompt) ? "Ronaldo Nazário" : "Cristiano Ronaldo")
    : null;
  if (!clubQuery && !goalThreshold && !teammateName && !competitionId) {
    const match = prompt.match(/(?:игроки|игроков|футболисты|футболистки|footballers|players)\s+(?:клуба\s+|of\s+)?[«"']?([\p{L}\p{N} .'-]{2,60})/iu);
    const candidate = match?.[1]?.replace(/\b(?:в возрасте|возрастом|лет|years?|aged|under|over)\b.*$/i, "")
      .replace(/\b20\d{2}(?:[-/–]\d{2,4})?\b.*$/i, "").trim();
    if (candidate && candidate.length >= 2 && !COUNTRIES.some((entry) => entry.pattern.test(candidate))) clubQuery = candidate;
  }
  return { age, women: WOMEN_REQUEST.test(prompt), country, clubQuery, position, era, goalThreshold, competitionId, teammateName };
}
export function exactAgeBirthRange(age: number, now = new Date()): { after: string; before: string } | null {
  if (!Number.isInteger(age) || age < 1 || age > 99) return null;
  const end = new Date(Date.UTC(now.getUTCFullYear() - age, now.getUTCMonth(), now.getUTCDate()));
  const start = new Date(Date.UTC(now.getUTCFullYear() - age - 1, now.getUTCMonth(), now.getUTCDate()));
  return { after: start.toISOString().slice(0, 10), before: end.toISOString().slice(0, 10) };
}
export function buildPlayerDiscoveryQuery(intent: DiscoveryIntent, clubQid: string | null, now = new Date(), teammateQid: string | null = null): string {
  const clauses = [
    "?item wdt:P106/wdt:P279* wd:Q937857.",
    "OPTIONAL { ?item wdt:P413 ?position. OPTIONAL { ?position rdfs:label ?positionRu. FILTER(LANG(?positionRu) = \"ru\") } OPTIONAL { ?position rdfs:label ?positionEn. FILTER(LANG(?positionEn) = \"en\") } }",
    "OPTIONAL { ?item wdt:P18 ?image. }",
    "OPTIONAL { ?item wdt:P27 ?citizenship. ?citizenship rdfs:label ?countryLabel. FILTER(LANG(?countryLabel) = \"ru\") }",
    "OPTIONAL { ?item rdfs:label ?nameRu. FILTER(LANG(?nameRu) = \"ru\") }",
    "OPTIONAL { ?item rdfs:label ?nameEn. FILTER(LANG(?nameEn) = \"en\") }",
  ];
  if (intent.age !== null) {
    clauses.push("?item p:P569 ?dobStatement. ?dobStatement ps:P569 ?dob; wikibase:timePrecision ?dobPrecision. FILTER(?dobPrecision >= 11).");
  } else {
    clauses.push("OPTIONAL { ?item p:P569 ?dobStatement. ?dobStatement ps:P569 ?dob; wikibase:timePrecision ?dobPrecision. FILTER(?dobPrecision >= 11). }");
  }
  if (teammateQid) {
    clauses.push(`wd:${teammateQid} p:P54 ?teammateClubStatement.
      ?teammateClubStatement ps:P54 ?sharedClub; pq:P580 ?teammateClubStart.
      ?item p:P54 ?candidateClubStatement.
      ?candidateClubStatement ps:P54 ?sharedClub; pq:P580 ?candidateClubStart.
      OPTIONAL { ?teammateClubStatement pq:P582 ?teammateClubEnd. }
      OPTIONAL { ?candidateClubStatement pq:P582 ?candidateClubEnd. }
      FILTER(?item != wd:${teammateQid}
        && (!BOUND(?teammateClubEnd) || ?teammateClubEnd >= ?candidateClubStart)
        && (!BOUND(?candidateClubEnd) || ?candidateClubEnd >= ?teammateClubStart))`);
  }
  if (intent.country) clauses.push(`?item wdt:P27 wd:${intent.country.qid}.`);
  if (intent.women) clauses.push("?item wdt:P21 wd:Q6581072.");
  if (clubQid && intent.era) {
    const nextYear = intent.era.end + 1;
    clauses.push(`?item p:P54 ?clubStatement. ?clubStatement ps:P54 wd:${clubQid}.
      OPTIONAL { ?clubStatement pq:P580 ?clubStart. }
      OPTIONAL { ?clubStatement pq:P582 ?clubEnd. }
      FILTER((!BOUND(?clubStart) || ?clubStart < "${nextYear}-01-01T00:00:00Z"^^xsd:dateTime)
        && (!BOUND(?clubEnd) || ?clubEnd >= "${intent.era.start}-01-01T00:00:00Z"^^xsd:dateTime))`);
  } else if (clubQid) {
    clauses.push(`?item p:P54 ?clubStatement. ?clubStatement ps:P54 wd:${clubQid}. FILTER NOT EXISTS { ?clubStatement pq:P582 ?clubEnd. }`);
  }
  if (intent.position) {
    const patterns = { goalkeeper: "вратар|голкипер", defender: "защит|defend|defence|defense|centre.?back|center.?back|full.?back|left.?back|right.?back|wing.?back", midfielder: "полузащит|опорник|midfield", forward: "нападающ|форвард|striker|forward" };
    clauses.push(`FILTER((BOUND(?positionRu) && REGEX(LCASE(STR(?positionRu)), "${patterns[intent.position]}")) || (BOUND(?positionEn) && REGEX(LCASE(STR(?positionEn)), "${patterns[intent.position]}")))`);
  }
  if (intent.age !== null) {
    const range = exactAgeBirthRange(intent.age, now);
    if (range) clauses.push(`FILTER(?dob > "${range.after}T00:00:00Z"^^xsd:dateTime && ?dob < "${range.before}T23:59:59Z"^^xsd:dateTime)`);
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
function normalizeClubName(value: string): string[] {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/)
    .filter((token) => !["fc", "cf", "afc", "sc", "pfc", "club", "football", "the"].includes(token));
}
function normalizeEntityName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
async function resolvePlayerQid(query: string): Promise<string | null> {
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.search = new URLSearchParams({ action: "wbsearchentities", search: query, language: "en", uselang: "en", type: "item", limit: "8", format: "json" }).toString();
  const response = await fetch(url, { headers: { "User-Agent": "SherlockScholes/1.0 (football player discovery; contact via GitHub)" }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`wikidata_player_search_http_${response.status}`);
  const payload = await response.json() as { search?: Array<{ id?: string; label?: string; description?: string }> };
  const person = (payload.search ?? []).find((entry) =>
    /^Q[1-9][0-9]*$/.test(entry.id ?? "") &&
    normalizeEntityName(entry.label ?? "") === normalizeEntityName(query) &&
    /footballer|football player|association football/i.test(entry.description ?? "")
  );
  return person?.id ?? null;
}
async function resolveClubQid(query: string): Promise<string | null> {
  const url = new URL("https://www.wikidata.org/w/api.php");
  url.search = new URLSearchParams({ action: "wbsearchentities", search: query, language: "en", uselang: "en", type: "item", limit: "8", format: "json" }).toString();
  const response = await fetch(url, { headers: { "User-Agent": "SherlockScholes/1.0 (football player discovery; contact via GitHub)" }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`wikidata_search_http_${response.status}`);
  const payload = await response.json() as { search?: Array<{ id?: string; label?: string; description?: string }> };
  const queryTokens = normalizeClubName(query);
  const club = (payload.search ?? []).find((entry) => {
    if (!/^Q[1-9][0-9]*$/.test(entry.id ?? "") ||
      !/football club|association football club|women.s football club/i.test(entry.description ?? "")) return false;
    const labelTokens = normalizeClubName(entry.label ?? "");
    return labelTokens.length > 0 && labelTokens.length === queryTokens.length &&
      labelTokens.every((token) => queryTokens.includes(token));
  });
  return club?.id ?? null;
}
export function aggregateGoalThresholdRows(
  rows: Array<{ card_id?: unknown; goals?: unknown }>,
  threshold: number,
  inclusive: boolean,
): Array<{ cardId: string; goals: number }> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (typeof row.card_id !== "string" || !row.card_id) continue;
    const goals = Number(row.goals ?? 0);
    if (!Number.isFinite(goals) || goals < 0) continue;
    totals.set(row.card_id, (totals.get(row.card_id) ?? 0) + goals);
  }
  return [...totals.entries()]
    .map(([cardId, goals]) => ({ cardId, goals }))
    .filter((row) => inclusive ? row.goals >= threshold : row.goals > threshold)
    .sort((a, b) => b.goals - a.goals);
}
export function aggregateCompetitionRows(
  rows: Array<{ card_id?: unknown; goals?: unknown; apps?: unknown }>,
  threshold: { value: number; inclusive: boolean } | null,
): Array<{ cardId: string; goals: number; apps: number }> {
  const totals = new Map<string, { goals: number; apps: number }>();
  for (const row of rows) {
    if (typeof row.card_id !== "string" || !row.card_id) continue;
    const goals = Number(row.goals ?? 0);
    const apps = Number(row.apps ?? 0);
    if (!Number.isFinite(goals) || goals < 0 || !Number.isFinite(apps) || apps <= 0) continue;
    const total = totals.get(row.card_id) ?? { goals: 0, apps: 0 };
    total.goals += goals;
    total.apps += apps;
    totals.set(row.card_id, total);
  }
  return [...totals.entries()]
    .map(([cardId, total]) => ({ cardId, ...total }))
    .filter((row) => !threshold || (threshold.inclusive ? row.goals >= threshold.value : row.goals > threshold.value))
    .sort((a, b) => threshold ? b.goals - a.goals : b.apps - a.apps || b.goals - a.goals);
}
async function loadCompetitionStatRows(supabase: any, competitionId: string) {
  const rows: Array<{ card_id?: unknown; goals?: unknown; apps?: unknown }> = [];
  const pageSize = 1000;
  for (let offset = 0; offset < 10000; offset += pageSize) {
    const { data, error } = await supabase.from("player_season_stat").select("card_id,goals,apps")
      .eq("competition_id", competitionId).gt("apps", 0)
      .order("tm_player_id", { ascending: true }).order("season_id", { ascending: true })
      .order("club_id", { ascending: true }).range(offset, offset + pageSize - 1);
    if (error) throw new Error("player_stats_discovery_failed");
    if (!Array.isArray(data)) return null;
    rows.push(...data);
    if (data.length < pageSize) return rows;
  }
  return null;
}
async function discoverByCompetitionStats(supabase: any, intent: DiscoveryIntent) {
  const empty = { discovered: 0, created: 0, matched: 0, cardIds: [] as string[], constrained: true };
  if (intent.competitionId !== "GB1" || intent.teammateName ||
      intent.age !== null || intent.women || intent.country || intent.clubQuery || intent.position || intent.era) return empty;
  const data = await loadCompetitionStatRows(supabase, intent.competitionId);
  if (!data) return empty;
  const ranked = aggregateCompetitionRows(data, intent.goalThreshold);
  if (!ranked.length) return empty;
  const candidates = ranked.slice(0, 100);
  const { data: cards, error: cardsError } = await supabase.from("cards").select("id")
    .eq("active", true).eq("category", "player").in("id", candidates.map((row) => row.cardId));
  if (cardsError) throw new Error("player_stats_card_lookup_failed");
  const activeIds = new Set((cards ?? []).map((card: { id: string }) => card.id));
  const cardIds = candidates.filter((row) => activeIds.has(row.cardId)).map((row) => row.cardId);
  return { discovered: cardIds.length, created: 0, matched: cardIds.length, cardIds, constrained: true };
}
export async function discoverFootballPlayers(supabase: any, prompt: string): Promise<{ discovered: number; created: number; matched: number; cardIds: string[]; constrained: boolean }> {
  const intent = parseDiscoveryIntent(prompt);
  if (!intent) return { discovered: 0, created: 0, matched: 0, cardIds: [], constrained: false };
  const constrained = intent.age !== null || intent.women || intent.country !== null || intent.clubQuery !== null || intent.position !== null || intent.era !== null || intent.goalThreshold !== null || intent.competitionId !== null || intent.teammateName !== null;
  if (!constrained) return { discovered: 0, created: 0, matched: 0, cardIds: [], constrained: false };
  if (intent.goalThreshold && !intent.competitionId) {
    return { discovered: 0, created: 0, matched: 0, cardIds: [], constrained: true };
  }
  if (intent.competitionId) return discoverByCompetitionStats(supabase, intent);
  let teammateQid: string | null = null;
  if (intent.teammateName) {
    teammateQid = await resolvePlayerQid(intent.teammateName);
    if (!teammateQid) return { discovered: 0, created: 0, matched: 0, cardIds: [], constrained: true };
  }
  let clubQid: string | null = null;
  if (intent.clubQuery) {
    clubQid = await resolveClubQid(intent.clubQuery);
    if (!clubQid) return { discovered: 0, created: 0, matched: 0, cardIds: [], constrained: true };
  }
  const response = await fetch("https://query.wikidata.org/sparql", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "Accept": "application/sparql-results+json", "User-Agent": "SherlockScholes/1.0 (football player discovery; contact via GitHub)" },
    body: new URLSearchParams({ query: buildPlayerDiscoveryQuery(intent, clubQid, new Date(), teammateQid), format: "json" }),
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
  return { discovered: candidates.length, created, matched, cardIds: [...cardIds], constrained: true };
}
