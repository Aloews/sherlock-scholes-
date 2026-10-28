/**
 * Splits verified honours (things won) from tournaments (things attended).
 * Structured honours are refreshed from Wikipedia and stored in cards.facts.
 * Counts are merged with legacy title strings so refreshed data cannot create
 * duplicate entries such as "Золотой мяч ×2" and "Обладатель Золотого мяча".
 */
export interface HonourRecord {
  title: string;
  count?: number | null;
  kind?: string | null;
}

export interface HonourSources {
  titles?: string[] | null;
  legendTitles?: string[] | null;
  honours?: HonourRecord[] | null;
  tournaments?: string[] | null;
}

export interface Honours {
  trophies: string[];
  tournaments: string[];
}

const clean = (xs: string[] | null | undefined): string[] =>
  (xs ?? []).filter((x): x is string => typeof x === 'string' && x.trim() !== '');

const COUNT_SUFFIX = /\s*(?:×|x)\s*(\d+)\s*$/i;
const PAREN_COUNT_SUFFIX = /\s*\((\d+)\)\s*$/;

function splitCount(value: string): { title: string; count: number } {
  const match = value.match(COUNT_SUFFIX) ?? value.match(PAREN_COUNT_SUFFIX);
  if (!match || match.index === undefined) return { title: value.trim(), count: 1 };
  return { title: value.slice(0, match.index).trim(), count: Number(match[1]) || 1 };
}

function canonicalTitle(value: string): string {
  const cleaned = splitCount(value).title
    .replace(/[«»„“”"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const yearMatch = cleaned.match(/\s+(20\d{2})$/);
  const year = yearMatch?.[1];
  const awardName = yearMatch?.index === undefined
    ? cleaned
    : cleaned.slice(0, yearMatch.index).trim();
  const suffix = year ? ' ' + year : '';
  const lower = awardName.toLocaleLowerCase('ru');

  // The Club World Cup's Golden Ball is a different award from France Football's
  // Ballon d'Or. Check the competition before the shared "golden ball" wording.
  if (lower.includes('клубного чемпионата мира') || lower.includes('club world cup')) {
    return 'Золотой мяч клубного чемпионата мира' + suffix;
  }
  if (
    lower.includes('золотого мяча') || lower.includes('золотой мяч') ||
    lower.includes("ballon d'or") || lower.includes('ballon d’or') || lower.includes('ballon dor')
  ) return 'Золотой мяч' + suffix;
  if (lower.includes('трофей копа') || lower.includes('кубок копа') || lower === 'копа') {
    return 'Трофей Копа' + suffix;
  }
  if (lower.includes('трофей яшина') || lower.includes('яшина')) return 'Трофей Яшина' + suffix;
  if (lower.includes('герда мюллера') || lower.includes('герд мюллер')) {
    return 'Трофей Герда Мюллера' + suffix;
  }
  if (lower.includes('сократес')) return 'Приз Сократеса' + suffix;

  return cleaned
    .replace(/^обладатель\s+/i, '')
    .replace(/\s+по версии france football$/i, '')
    .replace(/\s+по версии\s+.+$/i, '')
    .trim();
}

function ballonVariant(title: string, kind?: string | null): 'fifa' | 'france' | 'generic' | null {
  if (kind === 'team') return null;
  const lower = title.toLocaleLowerCase('ru');
  if (lower.includes('клубного чемпионата мира') || lower.includes('club world cup')) return null;
  const isBallon = (
    (lower.includes('золот') && lower.includes('мяч')) ||
    lower.includes("ballon d'or") ||
    lower.includes('ballon d’or') ||
    lower.includes('ballon dor')
  );
  if (!isBallon) return null;
  if (lower.includes('фифа') || lower.includes('fifa')) return 'fifa';
  if (lower.includes('france football')) return 'france';
  return 'generic';
}

function canonicalKey(value: string): string {
  return canonicalTitle(value).toLocaleLowerCase('ru').replace(/[.,:;!?]/g, '').replace(/\s+/g, ' ');
}

function formatTitle(title: string, count: number): string {
  return count > 1 ? title + ' ×' + count : title;
}

export function splitHonours({ titles, legendTitles, honours, tournaments }: HonourSources): Honours {
  const trophyMap = new Map<string, { title: string; count: number }>();

  const addTrophy = (rawTitle: string, rawCount = 1) => {
    const parsed = splitCount(rawTitle);
    const count = Math.max(1, Number.isFinite(rawCount) ? rawCount : 1, parsed.count);
    const title = canonicalTitle(parsed.title);
    if (!title) return;
    const key = canonicalKey(title);
    const existing = trophyMap.get(key);
    if (!existing || count > existing.count) trophyMap.set(key, { title, count });
  };

  clean(titles).forEach((title) => addTrophy(title));
  clean(legendTitles).forEach((title) => addTrophy(title));

  // France Football's Ballon d'Or and the 2010–2015 FIFA Ballon d'Or are
  // two eras of one historic award lineage. Sum the distinct eras, but use max
  // for duplicate copies of the same source label and across legacy/structured sources.
  const ballonCounts: Partial<Record<'fifa' | 'france' | 'generic', number>> = {};
  const nonBallonHonours: HonourRecord[] = [];
  (honours ?? []).forEach((item) => {
    if (!item || typeof item.title !== 'string' || !item.title.trim()) return;
    const variant = ballonVariant(item.title, item.kind);
    if (!variant) {
      nonBallonHonours.push(item);
      return;
    }
    const parsed = splitCount(item.title);
    const count = Math.max(1, Number(item.count) || 1, parsed.count);
    ballonCounts[variant] = Math.max(ballonCounts[variant] ?? 0, count);
  });
  if (Object.keys(ballonCounts).length > 0) {
    const eraTotal = ballonCounts.fifa && ballonCounts.france
      ? ballonCounts.fifa + ballonCounts.france
      : Math.max(ballonCounts.fifa ?? 0, ballonCounts.france ?? 0);
    const count = Math.max(ballonCounts.generic ?? 0, eraTotal);
    addTrophy('Золотой мяч', count);
  }
  nonBallonHonours.forEach((item) => {
    if (item && typeof item.title === 'string' && item.title.trim()) {
      addTrophy(item.title, Number(item.count) || 1);
    }
  });

  const allTrophies = [...trophyMap.values()];
  // If a newly recorded year-specific win exists, do not let its generic
  // one-count label hide it (e.g. "Золотой мяч 2026" behind "Золотой мяч").
  // Keep a generic count above one as a separate career total.
  const yearSpecificBases = new Set(
    allTrophies
      .map(({ title }) => title.match(/^(.*)\s+(20\d{2})$/))
      .filter((match): match is RegExpMatchArray => match !== null)
      .map((match) => canonicalKey(match[1])),
  );
  const trophies = allTrophies
    .filter(({ title, count }) =>
      /\s20\d{2}$/.test(title) ||
      count > 1 ||
      !yearSpecificBases.has(canonicalKey(title)),
    )
    .map(({ title, count }) => formatTitle(title, count));

  const trophyKeys = new Set(trophyMap.keys());
  const seenTournaments = new Set<string>();
  const tournamentList = clean(tournaments).filter((title) => {
    const key = canonicalKey(title);
    if (trophyKeys.has(key) || seenTournaments.has(key)) return false;
    seenTournaments.add(key);
    return true;
  });

  return { trophies, tournaments: tournamentList };
}
