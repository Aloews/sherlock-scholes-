export interface NewsHeadline { title: string; url: string; source: string; published_at: string }
export interface LegendClub { club: string; years: string }
export interface CareerStatLine {
  apps?: number | null;
  goals?: number | null;
  assists?: number | null;
  club?: string;
  years?: string;
}
export interface CanonicalPlayer {
  id: string; name: string; name_en: string | null; photo_url: string | null;
  country: string | null; position_ru: string | null; fame: number | null;
  top_league?: string | null;
  career_stats?: CareerStatLine[] | null;
  facts?: Record<string, unknown> | null;
  tags?: string[] | null;
  legend_career?: { clubs?: LegendClub[] } | null;
}
export interface StatisticalComparison {
  id: string;
  groupBy: 'league' | 'birth-country';
  groupKey: string;
  players: CanonicalPlayer[];
  careerTotals: Array<{ card_id: string; appearances: number; goals: number; assists: number | null }>;
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
  let best: GoldenEra | null = null;
  for (const anchor of ranges) {
    const active = ranges.filter((candidate) =>
      candidate.key === anchor.key && candidate.start <= anchor.start && candidate.end >= anchor.start,
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
  return best;
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

function careerTotals(player: CanonicalPlayer) {
  const rows = Array.isArray(player.career_stats) ? player.career_stats : [];
  // Compare only rows where both shared metrics are known; a missing goals
  // value is not silently converted into a zero.
  const valid = rows.filter((row) =>
    typeof row.apps === 'number' && Number.isFinite(row.apps) && row.apps >= 0 &&
    typeof row.goals === 'number' && Number.isFinite(row.goals) && row.goals >= 0,
  );
  if (!valid.length) return null;
  const appearances = valid.reduce((sum, row) => sum + (typeof row.apps === 'number' && Number.isFinite(row.apps) ? row.apps : 0), 0);
  const goals = valid.reduce((sum, row) => sum + (typeof row.goals === 'number' && Number.isFinite(row.goals) ? row.goals : 0), 0);
  const assistsRows = valid.filter((row) => typeof row.assists === 'number' && Number.isFinite(row.assists));
  const assists = assistsRows.length ? assistsRows.reduce((sum, row) => sum + (row.assists as number), 0) : null;
  return { appearances, goals, assists };
}

function latestKnownCareerEndYear(player: CanonicalPlayer): number | null {
  const candidates: string[] = [];
  const yearsActive = player.facts?.years_active;
  if (typeof yearsActive === 'string') candidates.push(yearsActive);
  for (const row of player.career_stats ?? []) {
    if (typeof row.years === 'string') candidates.push(row.years);
  }
  let latest: number | null = null;
  for (const value of candidates) {
    const text = value.trim();
    // An open range such as "2015–" does not prove a retirement year.
    if (!text || /[-–—]\s*$/.test(text)) continue;
    const match = text.match(/(\d{4})(?:\D+(\d{4}))?/);
    if (!match) continue;
    const end = Number(match[2] ?? match[1]);
    if (end >= 1850 && end <= new Date().getFullYear() + 1) {
      latest = latest === null ? end : Math.max(latest, end);
    }
  }
  return latest;
}

function isHistoricalPlayer(player: CanonicalPlayer): boolean {
  const endYear = latestKnownCareerEndYear(player);
  return endYear !== null && endYear < new Date().getFullYear() - 1;
}

/**
 * Build comparisons only when the same cohort contains a recent-form player,
 * a historical/legend card and career totals for every selected card.
 * The cards.country field is not used as birthplace: it is nationality in the
 * current schema. Birth-country cohorts require an explicit sourced facts key.
 */
export function buildStatisticalComparisons(
  players: CanonicalPlayer[],
  recentFormIds: Set<string>,
  maxPerGroup = 12,
): StatisticalComparison[] {
  const eligible = players.flatMap((player) => {
    const totals = careerTotals(player);
    return totals ? [{ player, totals }] : [];
  });
  const groups: Array<{ groupBy: 'league' | 'birth-country'; groupKey: string; rows: typeof eligible }> = [];
  const collect = (groupBy: 'league' | 'birth-country', keyOf: (player: CanonicalPlayer) => string | null) => {
    const byKey = new Map<string, typeof eligible>();
    for (const row of eligible) {
      const raw = keyOf(row.player);
      if (!raw || !raw.trim()) continue;
      const key = raw.trim();
      const normalized = normalizeFootballText(key);
      if (!normalized) continue;
      const rows = byKey.get(normalized) ?? [];
      rows.push(row);
      byKey.set(normalized, rows);
    }
    for (const rows of byKey.values()) {
      const hasCurrent = rows.some((row) => recentFormIds.has(row.player.id));
      const hasHistorical = rows.some((row) => !recentFormIds.has(row.player.id) && isHistoricalPlayer(row.player));
      if (rows.length >= 3 && hasCurrent && hasHistorical) {
        groups.push({ groupBy, groupKey: keyOf(rows[0].player)!, rows });
      }
    }
  };
  collect('league', (player) => player.top_league ?? null);
  collect('birth-country', (player) => {
    const facts = player.facts ?? {};
    const value = facts.birth_country ?? facts.birthCountry ?? facts.place_of_birth_country;
    return typeof value === 'string' ? value : null;
  });

  return groups.map((group) => {
    const ranked = [...group.rows].sort((a, b) =>
      (b.totals.goals - a.totals.goals) || (b.totals.appearances - a.totals.appearances),
    ).slice(0, maxPerGroup);
    return {
      id: 'smart-comparison-' + group.groupBy + '-' + normalizeFootballText(group.groupKey).replace(/ /g, '-'),
      groupBy: group.groupBy,
      groupKey: group.groupKey,
      players: ranked.map((row) => row.player),
      careerTotals: ranked.map((row) => ({
        card_id: row.player.id, appearances: row.totals.appearances, goals: row.totals.goals, assists: row.totals.assists,
      })),
    };
  }).sort((a, b) => b.players.length - a.players.length || a.groupKey.localeCompare(b.groupKey)).slice(0, 4);
}