const BASE = "https://league.cityfootball.ru";
const USER_AGENT = "SherlockScholes/1.0 (+https://github.com/Aloews/sherlock-scholes-)";

export type CityFootballPlayer = {
  sourceKey: string;
  name: string;
  nameEn: string | null;
  bornOn: string | null;
  positionRu: string | null;
  photoUrl: string | null;
  sourceUrl: string;
  teamName: string | null;
  description: string | null;
  stats: Record<string, string | number>;
};

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}

function plainText(value: string): string {
  return decodeHtml(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}

function meta(html: string, key: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const property = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    if (property !== key.toLowerCase()) continue;
    const content = tag.match(/content\s*=\s*["']([^"']*)["']/i)?.[1];
    if (content) return decodeHtml(content.trim());
  }
  return null;
}

function absoluteUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw, BASE);
    if (url.protocol !== "https:" || !["league.cityfootball.ru", "cityfootball.ru", "www.cityfootball.ru"].includes(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function parseCityFootballPlayerPage(html: string, playerId: string): CityFootballPlayer | null {
  if (!/^\d{1,12}$/.test(playerId)) return null;
  const title = plainText(meta(html, "og:title") ?? html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const name = title.replace(/\s*[|—-]\s*(?:CityFootball|Лига CityFootball|Любительская футбольная лига).*$/i, "").trim();
  if (name.length < 2 || name.length > 160 || /^(игрок|player|cityfootball)$/i.test(name)) return null;

  const photoUrl = absoluteUrl(meta(html, "og:image") ??
    html.match(/<img\b[^>]*(?:class|alt)=["'][^"']*(?:player|avatar|фото)[^"']*["'][^>]*src=["']([^"']+)["']/i)?.[1] ?? null);
  const teamMatch = html.match(/<a\b[^>]*href=["'](\/team\/\d+\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i);
  const teamName = teamMatch ? plainText(teamMatch[2]).slice(0, 100) || null : null;
  const positionMatch = plainText(html).match(/(?:Позиция|Амплуа|Position)\s*:?\s*(Вратарь|Защитник|Полузащитник|Нападающий|Goalkeeper|Defender|Midfielder|Forward|Striker)/i);
  const bornMatch = plainText(html).match(/(?:Дата рождения|Родился|Born)\s*:?\s*(\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})/i);
  let bornOn: string | null = null;
  if (bornMatch) {
    const raw = bornMatch[1];
    bornOn = /^\d{4}-/.test(raw) ? raw : raw.split(".").reverse().join("-");
    if (Number.isNaN(Date.parse(bornOn))) bornOn = null;
  }
  const stats: Record<string, string | number> = {};
  const text = plainText(html);
  for (const [label, pattern] of [
    ["matches", /(?:Матчей|Игры|Matches)\s*:?\s*(\d{1,4})/i],
    ["goals", /(?:Голы|Забито|Goals)\s*:?\s*(\d{1,4})/i],
    ["assists", /(?:Голевые передачи|Ассисты|Assists)\s*:?\s*(\d{1,4})/i],
    ["yellow_cards", /(?:Жёлтые карточки|Желтые карточки|Yellow cards)\s*:?\s*(\d{1,4})/i],
    ["red_cards", /(?:Красные карточки|Red cards)\s*:?\s*(\d{1,4})/i],
  ] as Array<[string, RegExp]>) {
    const match = text.match(pattern);
    if (match) stats[label] = Number(match[1]);
  }
  const description = meta(html, "description") ?? meta(html, "og:description");
  return {
    sourceKey: `cityfootball:player:${playerId}`,
    name,
    nameEn: null,
    bornOn,
    positionRu: positionMatch?.[1] ?? null,
    photoUrl,
    sourceUrl: `${BASE}/player/${playerId}`,
    teamName,
    description: description ? plainText(description).slice(0, 1000) : null,
    stats,
  };
}

export function cityFootballPlayerIdsFromPage(html: string): string[] {
  const ids = new Set<string>();
  for (const match of html.matchAll(/href=["'](?:https?:\/\/league\.cityfootball\.ru)?\/player\/(\d+)(?:[/?#][^"']*)?["']/gi)) {
    if (match[1]) ids.add(match[1]);
  }
  return [...ids];
}

export function cityFootballTeamUrlFromPage(html: string): string | null {
  const href = html.match(/href=["'](\/team\/\d+\/profile\/info)["']/i)?.[1];
  return href ? `${BASE}${href}` : null;
}

export async function discoverCityFootballCards(supabase: any, prompt: string): Promise<{ cardIds: string[]; created: number } | null> {
  const profile = prompt.match(/https?:\/\/(?:www\.)?league\.cityfootball\.ru\/(player|team)\/(\d+)(?:\/profile\/info)?(?:[/?#][^\s]*)?/i);
  if (!profile) return null;
  const requestedType = profile[1].toLowerCase();
  const requestedId = profile[2];
  const requestedUrl = requestedType === "player"
    ? `${BASE}/player/${requestedId}`
    : `${BASE}/team/${requestedId}/profile/info`;
  const fetchPage = async (url: string): Promise<string> => {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "ru,en;q=0.8" },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error(`cityfootball_source_http_${response.status}`);
    return response.text();
  };

  const firstPage = await fetchPage(requestedUrl);
  const teamUrl = requestedType === "team" ? requestedUrl : cityFootballTeamUrlFromPage(firstPage);
  let rosterHtml = requestedType === "team" ? firstPage : "";
  if (teamUrl && requestedType === "player") {
    try { rosterHtml = await fetchPage(teamUrl); } catch { /* keep the verified player page */ }
  }
  const playerIds = new Set<string>([...(requestedType === "player" ? [requestedId] : []), ...cityFootballPlayerIdsFromPage(rosterHtml)]);
  const cappedIds = [...playerIds].slice(0, 25);
  const rows: CityFootballPlayer[] = [];
  for (let i = 0; i < cappedIds.length; i += 5) {
    const batch = await Promise.all(cappedIds.slice(i, i + 5).map(async (id) => {
      if (requestedType === "player" && id === requestedId) return parseCityFootballPlayerPage(firstPage, id);
      try { return parseCityFootballPlayerPage(await fetchPage(`${BASE}/player/${id}`), id); }
      catch { return null; }
    }));
    rows.push(...batch.filter((row): row is CityFootballPlayer => row !== null));
  }
  if (!rows.length) throw new Error("cityfootball_no_verified_players");
  const cardIds: string[] = [];
  let created = 0;
  for (const row of rows) {
    const { data: existing } = await supabase.from("cards").select("id")
      .eq("external_source_key", row.sourceKey).maybeSingle();
    const { data, error } = await supabase.rpc("upsert_cityfootball_player_card", {
      p_source_key: row.sourceKey,
      p_name: row.name,
      p_name_en: row.nameEn,
      p_born_on: row.bornOn,
      p_position_ru: row.positionRu,
      p_photo_url: row.photoUrl,
      p_source_url: row.sourceUrl,
      p_team_name: row.teamName,
      p_description: row.description,
      p_stats: row.stats,
    });
    if (error || !data) throw new Error("cityfootball_canonical_card_upsert_failed");
    cardIds.push(String(data));
    if (!existing) created++;
  }
  return { cardIds: [...new Set(cardIds)], created };
}
