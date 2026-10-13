export interface NewsHeadline { title: string; url: string; source: string; published_at: string; description?: string | null; summary_short?: string | null }
export interface LegendClub { club: string; years: string }
export interface CanonicalPlayer {
  id: string; name: string; name_en: string | null; photo_url: string | null;
  country: string | null; position_ru: string | null; fame: number | null;
  legend_career?: { clubs?: LegendClub[] } | null;
}
export interface GoldenEra { club: string; startYear: number; endYear: number; players: CanonicalPlayer[] }
export interface NewsCardMatch { id: string; name: string; photo_url: string | null; matchedHeadline: NewsHeadline }

export function normalizeFootballText(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

/** Find the largest overlapping group of verified player career ranges at one club. */
export function buildGoldenEra(players: CanonicalPlayer[], maxPlayers = 16): GoldenEra | null {
  const currentYear = new Date().getFullYear();
  const byPlayer = players.map((player) => ({
    player,
    ranges: (player.legend_career?.clubs ?? []).flatMap((entry) => {
      const years = entry.years.match(/(\d{4})(?:\D+(\d{4}))?/);
      if (!years || !entry.club.trim()) return [];
      const start = Number(years[1]);
      const end = years[2] ? Number(years[2]) : currentYear;
      if (start < 1850 || end < start || end > currentYear + 1) return [];
      return [{ player, club: entry.club.trim(), key: normalizeFootballText(entry.club), start, end }];
    }),
  }));
  // The current Wikidata-derived snapshot sometimes merges separate spells
  // at one club (e.g. Man United 2003–2022) and overlaps that range with a
  // different club (Real Madrid 2009–2018). Exclude that player's ranges
  // rather than manufacture a "golden era" from impossible simultaneous clubs.
  const ambiguous = new Set<string>();
  for (const row of byPlayer) {
    for (let i = 0; i < row.ranges.length; i++) for (let j = i + 1; j < row.ranges.length; j++) {
      const a = row.ranges[i], b = row.ranges[j];
      if (a.key !== b.key && a.start <= b.end && b.start <= a.end) ambiguous.add(row.player.id);
    }
  }
  const ranges = byPlayer.filter((row) => !ambiguous.has(row.player.id)).flatMap((row) => row.ranges);
  // Group by club first. Scanning every career range for every anchor made the
  // 1,000-player candidate pool quadratic across unrelated clubs and could
  // stall the home screen. This keeps comparisons inside each club's ranges.
  const byClub = new Map<string, typeof ranges>();
  for (const range of ranges) {
    const group = byClub.get(range.key) ?? [];
    group.push(range);
    byClub.set(range.key, group);
  }
  let best: GoldenEra | null = null;
  for (const clubRanges of byClub.values()) {
    for (const anchor of clubRanges) {
      const active = clubRanges.filter((candidate) =>
        candidate.start <= anchor.start && candidate.end >= anchor.start,
      );
      const unique = [...new Map(active.map((item) => [item.player.id, item])).values()];
      if (unique.length < 3) continue;
      const startYear = Math.max(...unique.map((item) => item.start));
      const endYear = Math.min(...unique.map((item) => item.end));
      if (startYear > endYear) continue;
      const era: GoldenEra = {
        club: anchor.club, startYear, endYear,
        players: unique.sort((a, b) => (b.player.fame ?? -1) - (a.player.fame ?? -1))
          .slice(0, maxPlayers).map((item) => item.player),
      };
      if (!best || era.players.length > best.players.length
        || (era.players.length === best.players.length && era.endYear > best.endYear)) best = era;
    }
  }
  return best;
}

/** Conservative entity linking: require a full canonical multi-word name in verified article text. */
export function matchNewsToPlayers(headlines: NewsHeadline[], players: CanonicalPlayer[], maxCards = 20): NewsCardMatch[] {
  const normalizedPlayers = players.map((player) => ({
    player,
    names: [...new Set([player.name, player.name_en ?? ''].map(normalizeFootballText)
      .filter((name) => name.length >= 5 && name.includes(' ')))],
  })).filter((entry) => entry.names.length > 0);
  const matches: NewsCardMatch[] = [];
  const used = new Set<string>();
  for (const headline of headlines) {
    if (!isFootballNewsUrl(headline.url)) continue;
    // Many real football stories mention the player in the summary/body, not in the headline.
    // Match against all ingested editorial text, while the server still verifies the URL/title.
    const articleText = normalizeFootballText([headline.title, headline.summary_short ?? '', headline.description ?? ''].join(' '));
    if (!articleText) continue;
    for (const entry of normalizedPlayers) {
      if (used.has(entry.player.id) || !entry.names.some((name) => articleText.includes(name))) continue;
      used.add(entry.player.id);
      matches.push({ id: entry.player.id, name: entry.player.name, photo_url: entry.player.photo_url, matchedHeadline: headline });
      if (matches.length >= maxCards) return matches;
    }
  }
  return matches;
}

const NON_FOOTBALL_SECTIONS = new Set([
  'cricket', 'golf', 'nfl', 'racing', 'f1', 'tennis', 'hockey', 'boxing',
  'basketball', 'swimming', 'synchronized-swimming', 'rhythmic-gymnastics',
  'artistic-gymnastics', 'figure-skating', 'figureskating', 'olympics',
  'cybersport', 'martial', 'modalidades', 'record-gaming', 'other',
  'nba', 'nhl', 'mlb', 'rugby-union', 'rugby-league', 'rugby', 'mma', 'ufc',
  'darts', 'snooker', 'cycling', 'athletics', 'volleyball', 'handball',
  'chess', 'biathlon', 'skiing', 'gymnastics', 'motorsport', 'esports',
  'martial-arts', 'wrestling', 'baseball',
]);

export function isFootballNewsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const section = url.pathname.split('/').filter(Boolean)[0]?.toLocaleLowerCase() ?? '';
    return Boolean(section) && !NON_FOOTBALL_SECTIONS.has(section);
  } catch {
    return false;
  }
}

export interface RatingMatchEvidence {
  card_id: string;
  home_team: string | null;
  away_team: string | null;
  disputed?: boolean | null;
}

export function hasCurrentClubEvidence(
  candidate: { card_id: string; club?: string | null; club_key?: string | null },
  evidence: RatingMatchEvidence[],
): boolean {
  const rawClub = candidate.club_key || candidate.club || '';
  const club = normalizeFootballText(rawClub);
  if (!club) return false;
  const teams = evidence
    .filter((row) => row.card_id === candidate.card_id && row.disputed !== true)
    .flatMap((row) => [row.home_team, row.away_team])
    .filter((team): team is string => typeof team === 'string' && team.trim().length > 0)
    .map(normalizeFootballText);
  return teams.some((team) =>
    team === club || team.startsWith(`${club} `) || team.endsWith(` ${club}`) || team.includes(` ${club} `),
  );
}
