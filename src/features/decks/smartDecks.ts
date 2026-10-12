export interface NewsHeadline { title: string; url: string; source: string; published_at: string }
export interface LegendClub { club: string; years: string }
export interface CanonicalPlayer { id: string; name: string; name_en: string | null; photo_url: string | null; country: string | null; position_ru: string | null; fame: number | null; legend_career?: { clubs?: LegendClub[] } | null }
export interface GoldenEra { club: string; startYear: number; endYear: number; players: CanonicalPlayer[] }

/** Find a historically grounded club era from overlapping career ranges. */
export function buildGoldenEra(players: CanonicalPlayer[], maxPlayers = 16): GoldenEra | null {
  const ranges: { player: CanonicalPlayer; club: string; key: string; start: number; end: number }[] = [];
  for (const player of players) for (const entry of player.legend_career?.clubs ?? []) {
    const years = entry.years.match(/(\\d{4})(?:\\D+(\\d{4}))?/);
    if (!years || !entry.club.trim()) continue;
    const start = Number(years[1]);
    const end = years[2] ? Number(years[2]) : new Date().getFullYear();
    if (start < 1850 || end < start || end > new Date().getFullYear() + 1) continue;
    ranges.push({ player, club: entry.club.trim(), key: normalizeFootballText(entry.club), start, end });
  }
  let best: GoldenEra | null = null;
  for (const range of ranges) {
    const peers = ranges.filter((candidate) => candidate.key === range.key && candidate.start <= range.end && candidate.end >= range.start);
    const unique = [...new Map(peers.map((peer) => [peer.player.id, peer])).values()];
    if (unique.length < 3) continue;
    const startYear = Math.max(...unique.map((peer) => peer.start));
    const endYear = Math.min(...unique.map((peer) => peer.end));
    if (startYear > endYear) continue;
    const era: GoldenEra = { club: range.club, startYear, endYear, players: unique.map((peer) => peer.player).slice(0, maxPlayers) };
    if (!best || era.players.length > best.players.length || (era.players.length === best.players.length && era.endYear > best.endYear)) best = era;
  }
  return best;
}
export interface NewsCardMatch { id: string; name: string; photo_url: string | null; matchedHeadline: NewsHeadline }

export function normalizeFootballText(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

/** Conservative entity linking: require a full canonical multi-word name in a headline. */
export function matchNewsToPlayers(headlines: NewsHeadline[], players: CanonicalPlayer[], maxCards = 16): NewsCardMatch[] {
  const normalizedPlayers = players.map((player) => ({
    player,
    names: [...new Set([player.name, player.name_en ?? ''].map(normalizeFootballText)
      .filter((name) => name.length >= 5 && name.includes(' ')))],
  })).filter((entry) => entry.names.length > 0);
  const matches: NewsCardMatch[] = [];
  const used = new Set<string>();
  for (const headline of headlines) {
    const title = normalizeFootballText(headline.title);
    if (!title) continue;
    for (const entry of normalizedPlayers) {
      if (used.has(entry.player.id) || !entry.names.some((name) => title.includes(name))) continue;
      used.add(entry.player.id);
      matches.push({ id: entry.player.id, name: entry.player.name, photo_url: entry.player.photo_url, matchedHeadline: headline });
      if (matches.length >= maxCards) return matches;
    }
  }
  return matches;
}
