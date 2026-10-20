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
    const validSite = ["league.cityfootball.ru", "cityfootball.ru", "www.cityfootball.ru"].includes(url.hostname);
    const validTeamLogo = url.hostname === "hb.bizmrg.com" &&
      /^\/st\.cityfootball\.ru\/team\/\d+\/logo\//i.test(url.pathname);
    const validPlayerPhoto = url.hostname === "hb.bizmrg.com" &&
      /^\/st\.cityfootball\.ru\/player\/\d+\//i.test(url.pathname);
    if (url.protocol !== "https:" || (!validSite && !validTeamLogo && !validPlayerPhoto)) return null;
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

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("ru")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

export function teamIdFromPrompt(prompt: string): string | null {
  const explicit = prompt.match(/https?:\/\/(?:www\.)?league\.cityfootball\.ru\/team\/(\d+)(?:\/profile\/info)?/i);
  if (explicit) return explicit[1];
  // Archived profile confirmed by the user; it is absent from the current-season team directory.
  if (/\bSMB\b/i.test(prompt) && /city\s*football|cityfootball|любительск/i.test(prompt)) return "25194";
  return null;
}

export function parseCityFootballTeamPage(html: string, teamId: string) {
  if (!/^\d{1,12}$/.test(teamId)) return null;
  const heading = plainText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
  const title = plainText(meta(html, "og:title") ?? html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const name = (heading || title.replace(/\s*[|—-].*$/, "")).trim();
  if (name.length < 2 || name.length > 160 || /^(команды|участники|cityfootball)$/i.test(name)) return null;
  const logoRaw = html.match(/(?:src|data-src)=["']([^"']*\/team\/\d+\/logo\/[^"']+)["']/i)?.[1] ??
    html.match(/(?:src|data-src)=["']([^"']*logo[^"']*400x400[^"']*)["']/i)?.[1] ?? null;
  const logoUrl = absoluteUrl(logoRaw);
  const text = plainText(html);
  const stats: Record<string, string | number> = {};
  const patterns: Array<[string, RegExp]> = [
    ["matches", /(?:Матчей|Игры|Matches)\s*:?\s*(\d{1,4})/i],
    ["wins", /(?:Победы|Выигрыши|Wins)\s*:?\s*(\d{1,4})/i],
    ["draws", /(?:Ничьи|Draws)\s*:?\s*(\d{1,4})/i],
    ["losses", /(?:Поражения|Losses)\s*:?\s*(\d{1,4})/i],
    ["goals_for", /(?:Забито|Голы забитые|Goals for)\s*:?\s*(\d{1,4})/i],
    ["goals_against", /(?:Пропущено|Goals against)\s*:?\s*(\d{1,4})/i],
    ["points", /(?:Очки|Points)\s*:?\s*(\d{1,4})/i],
  ];
  for (const [key, pattern] of patterns) {
    const match = text.match(pattern);
    if (match) stats[key] = Number(match[1]);
  }
  return {
    sourceKey: "cityfootball:team:" + teamId, name, logoUrl,
    sourceUrl: BASE + "/team/" + teamId + "/profile/info",
    description: meta(html, "description") ?? meta(html, "og:description"),
    stats,
  };
}

async function findTeamProfile(fetchPage: (url: string) => Promise<string>, prompt: string) {
  const directId = teamIdFromPrompt(prompt);
  if (directId) return { id: directId, html: await fetchPage(BASE + "/team/" + directId + "/profile/info") };
  if (!/city\s*football|cityfootball|любительск/i.test(prompt)) return null;
  const query = normalized(prompt
    .replace(/любительск(?:ая|ую|ой|их)?/ig, " ")
    .replace(/футбольн(?:ая|ую|ой|ых)?/ig, " ")
    .replace(/команд(?:а|у|ы|е)?/ig, " ")
    .replace(/лиги|лига|из|для|в|the|team|city\s*football|cityfootball/ig, " "));
  if (!query) return null;
  const directory = await fetchPage(BASE + "/season/teams");
  const links = [...directory.matchAll(/<a\b[^>]*href=["'](?:https?:\/\/league\.cityfootball\.ru)?\/team\/(\d+)\/profile\/info[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const candidates = links.map((m) => ({ id: m[1], name: plainText(m[2]) })).filter((x) => x.name.length > 1);
  const q = normalized(query);
  const matches = candidates.map((x) => {
    const name = normalized(x.name);
    const score = name === q ? 1 : (name.includes(q) || q.includes(name)) ? Math.min(name.length, q.length) / Math.max(name.length, q.length) : 0;
    return { ...x, score };
  }).filter((x) => x.score >= 0.55).sort((a, b) => b.score - a.score);
  if (!matches.length || (matches.length > 1 && matches[0].score === matches[1].score)) return null;
  return { id: matches[0].id, html: await fetchPage(BASE + "/team/" + matches[0].id + "/profile/info") };
}

export async function discoverCityFootballCards(supabase: any, prompt: string): Promise<{ cardIds: string[]; created: number } | null> {
  const playerProfile = prompt.match(/https?:\/\/(?:www\.)?league\.cityfootball\.ru\/player\/(\d+)(?:\/[?#][^\s]*)?/i);
  const fetchPage = async (url: string): Promise<string> => {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "ru,en;q=0.8" },
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) throw new Error("cityfootball_source_http_" + response.status);
    return response.text();
  };

  let team: ReturnType<typeof parseCityFootballTeamPage> = null;
  let rosterHtml = "";
  let firstPlayerHtml = "";
  let requestedPlayerId: string | null = null;
  if (playerProfile) {
    requestedPlayerId = playerProfile[1];
    firstPlayerHtml = await fetchPage(BASE + "/player/" + requestedPlayerId);
    const teamUrl = cityFootballTeamUrlFromPage(firstPlayerHtml);
    if (teamUrl) {
      try {
        rosterHtml = await fetchPage(teamUrl);
        const teamId = teamUrl.match(/\/team\/(\d+)\//)?.[1];
        if (teamId) team = parseCityFootballTeamPage(rosterHtml, teamId);
      } catch { /* preserve verified player page */ }
    }
  } else {
    const resolved = await findTeamProfile(fetchPage, prompt);
    if (!resolved) return null;
    rosterHtml = resolved.html;
    team = parseCityFootballTeamPage(rosterHtml, resolved.id);
    if (!team) throw new Error("cityfootball_team_profile_unparseable");
  }

  const playerIds = new Set<string>([
    ...(requestedPlayerId ? [requestedPlayerId] : []),
    ...cityFootballPlayerIdsFromPage(rosterHtml),
  ]);
  const cappedIds = [...playerIds].slice(0, 40);
  const rows: CityFootballPlayer[] = [];
  for (let i = 0; i < cappedIds.length; i += 5) {
    const batch = await Promise.all(cappedIds.slice(i, i + 5).map(async (id) => {
      if (requestedPlayerId && id === requestedPlayerId) return parseCityFootballPlayerPage(firstPlayerHtml, id);
      try { return parseCityFootballPlayerPage(await fetchPage(BASE + "/player/" + id), id); }
      catch { return null; }
    }));
    rows.push(...batch.filter((row): row is CityFootballPlayer => row !== null));
  }
  if (!rows.length && !team) throw new Error("cityfootball_no_verified_players_or_team");

  const cardIds: string[] = [];
  let created = 0;
  if (team) {
    const { data: existing } = await supabase.from("cards").select("id").eq("external_source_key", team.sourceKey).maybeSingle();
    const { data, error } = await supabase.rpc("upsert_cityfootball_team_card", {
      p_source_key: team.sourceKey, p_name: team.name, p_logo_url: team.logoUrl,
      p_source_url: team.sourceUrl, p_description: team.description, p_stats: team.stats,
    });
    if (error || !data) throw new Error("cityfootball_team_card_upsert_failed");
    cardIds.push(String(data));
    if (!existing) created++;
  }
  for (const row of rows) {
    const { data: existing } = await supabase.from("cards").select("id").eq("external_source_key", row.sourceKey).maybeSingle();
    const { data, error } = await supabase.rpc("upsert_cityfootball_player_card", {
      p_source_key: row.sourceKey, p_name: row.name, p_name_en: row.nameEn, p_born_on: row.bornOn,
      p_position_ru: row.positionRu, p_photo_url: row.photoUrl, p_source_url: row.sourceUrl,
      p_team_name: row.teamName, p_description: row.description, p_stats: row.stats,
    });
    if (error || !data) throw new Error("cityfootball_canonical_card_upsert_failed");
    cardIds.push(String(data));
    if (!existing) created++;
  }
  if (!cardIds.length) throw new Error("cityfootball_no_cards_imported");
  return { cardIds: [...new Set(cardIds)], created };
}
