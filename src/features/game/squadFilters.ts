import { DECK_LEAGUES } from '@/shared/types/deck';
import type { Squad } from './squads';

const LEAGUE_ORDER = new Map<string, number>(
  DECK_LEAGUES.map((league, index) => [normalizeLeague(league), index] as const),
);
const SQUAD_NAME_ORDER = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function normalizeLeague(value: string | null | undefined): string {
  return (value ?? '').trim().toLocaleLowerCase('en-US');
}

/** Filter by the union of selected leagues and return a deterministic order. */
export function filterSquadsByLeagues(
  squads: readonly Squad[],
  selectedLeagues: readonly string[] | null | undefined,
): Squad[] {
  const selected = new Set((selectedLeagues ?? []).map(normalizeLeague).filter(Boolean));
  return squads
    .filter((squad) => selected.size === 0 || (squad.league !== null && selected.has(normalizeLeague(squad.league))))
    .slice()
    .sort((a, b) => {
      const leagueA = LEAGUE_ORDER.get(normalizeLeague(a.league)) ?? DECK_LEAGUES.length;
      const leagueB = LEAGUE_ORDER.get(normalizeLeague(b.league)) ?? DECK_LEAGUES.length;
      return leagueA - leagueB
        || SQUAD_NAME_ORDER.compare(a.name, b.name)
        || a.key.localeCompare(b.key, 'en');
    });
}

/** Keep selected clubs that are still present after a league filter changes. */
export function reconcileSquadSelection(
  selectedKeys: readonly string[] | null | undefined,
  availableSquads: readonly Squad[],
): string[] {
  const available = new Set(availableSquads.map((squad) => squad.key));
  return [...new Set(selectedKeys ?? [])].filter((key) => available.has(key));
}
