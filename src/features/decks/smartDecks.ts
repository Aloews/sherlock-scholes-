export interface NewsHeadline { title: string; url: string; source: string; published_at: string }
export interface CanonicalPlayer { id: string; name: string; name_en: string | null; photo_url: string | null; country: string | null; position_ru: string | null; fame: number | null }
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
