// The deck filter — ONE object, mirrored 1:1 by the SQL contract in
// supabase/migrations/deck_rpc.sql (cards_matching / pick_random_cards /
// count_deck all read this shape).
//
// It replaces the twelve positional RPC parameters and the six
// `rpcSupportsX` capability flags the client used to carry: the picker
// builds one of these, the counter counts it, the game deals it, and the
// route passes it along untouched.

import type { CardCategory, ContinentFilter } from './database';

export interface DeckFilter {
  /** Card categories in the deck. null/[] = every category. */
  categories?: CardCategory[] | null;
  /** Player continents; 'other' means cards.continent IS NULL. */
  continents?: ContinentFilter[] | null;
  /** Exact player countries (ISO, as in cards.country). */
  countries?: string[] | null;
  /** Player leagues — values from DECK_LEAGUES. */
  leagues?: string[] | null;
  /** Player traits (cards.tags overlap): goalkeeper, world_cup, … */
  tags?: string[] | null;
  /** Recognizability floor, 0..100 (cards.fame). 0/null = no floor. */
  fame_min?: number | null;
  /** Interface language — filters culture-bound cards (commentators). */
  lang?: string | null;
}

// ─── Recognizability: the ONE fame axis ──────────────────────────────
// cards.fame is a 0-100 percentile (see supabase/migrations/deck_fame.sql).
// The picker offers three steps of the same axis instead of the old
// tier chips, which were inverted against pageviews, and unlike them the
// floor applies to every category — "famous only" no longer leaves an
// obscure club in the deck.
export type FameLevel = 'any' | 'known' | 'famous';

export const FAME_MIN: Record<FameLevel, number> = {
  any:    0,   // whole deck (incl. cards with no fame data)
  known:  60,  // top 40% of its kind
  famous: 90,  // top decile — household names
};

export const FAME_LEVELS: FameLevel[] = ['famous', 'known', 'any'];

// ─── Leagues ─────────────────────────────────────────────────────────
// Mirrors deck_leagues() in supabase/migrations/deck_top_league.sql. The
// list is fixed on purpose: deriving the options from live data is what
// put "Friendlies Clubs" and "FA Cup" in the dropdown. 'Premier League'
// means England only — the Russian top flight is its own entry now.
export const DECK_LEAGUES = [
  'Premier League',
  'La Liga',
  'Serie A',
  'Bundesliga',
  'Ligue 1',
  'Eredivisie',
  'Russian Premier League',
] as const;
export type DeckLeague = (typeof DECK_LEAGUES)[number];

// ─── Player traits ───────────────────────────────────────────────────
// cards.tags values that describe a player, not their fame. 'star' is
// gone (it was a second fame list — now `fame_min: 90`); 'legend' is gone
// as a trait too and lives on as the Pro preset below.
export interface TraitDef {
  tag: string;
  labelKey: string;
  pro?: boolean;
}
export const DECK_TRAITS: TraitDef[] = [
  { tag: 'goalkeeper', labelKey: 'home.tag_goalkeeper' },
  { tag: 'world_cup',  labelKey: 'home.tag_world_cup' },
  { tag: 'wc2026',     labelKey: 'home.tag_wc2026' },
  { tag: 'giant',      labelKey: 'home.tag_giant' },
  { tag: 'dwarf',      labelKey: 'home.tag_dwarf' },
  { tag: 'ballon_dor', labelKey: 'home.tag_ballon_dor', pro: true },
];

// ─── Non-player categories, grouped ──────────────────────────────────
// Twelve loose chips read as noise; three named groups read as a choice.
export interface CategoryGroup {
  id: string;
  labelKey: string;
  categories: CardCategory[];
}
export const CATEGORY_GROUPS: CategoryGroup[] = [
  { id: 'football', labelKey: 'home.group_football', categories: ['club', 'club_nickname', 'stadium', 'derby', 'trophy'] },
  { id: 'people',   labelKey: 'home.group_people',   categories: ['coach', 'referee', 'commentator', 'woman'] },
  { id: 'theory',   labelKey: 'home.group_theory',   categories: ['term', 'position', 'era'] },
];
export const NON_PLAYER_CATEGORIES: CardCategory[] =
  CATEGORY_GROUPS.flatMap((g) => g.categories);

// ─── Presets ─────────────────────────────────────────────────────────
// Step 1 of the picker: a whole deck in one tap. `filter` is a partial —
// the wizard merges it with the interface language.
export interface DeckPreset {
  id: string;
  labelKey: string;
  descKey: string;
  emoji: string;
  pro?: boolean;
  filter: DeckFilter;
}
export const DECK_PRESETS: DeckPreset[] = [
  {
    id: 'everything',
    labelKey: 'home.preset_everything',
    descKey: 'home.preset_everything_desc',
    emoji: '🎲',
    filter: {},
  },
  {
    id: 'famous',
    labelKey: 'home.preset_famous',
    descKey: 'home.preset_famous_desc',
    emoji: '⭐',
    filter: { fame_min: FAME_MIN.famous },
  },
  {
    id: 'players',
    labelKey: 'home.preset_players',
    descKey: 'home.preset_players_desc',
    emoji: '⚽',
    filter: { categories: ['player'], fame_min: FAME_MIN.known },
  },
  {
    id: 'wc2026',
    labelKey: 'home.preset_wc2026',
    descKey: 'home.preset_wc2026_desc',
    emoji: '🏆',
    filter: { categories: ['player'], tags: ['wc2026'] },
  },
  {
    id: 'not_players',
    labelKey: 'home.preset_not_players',
    descKey: 'home.preset_not_players_desc',
    emoji: '🏟️',
    filter: { categories: NON_PLAYER_CATEGORIES },
  },
  {
    id: 'legends',
    labelKey: 'home.preset_legends',
    descKey: 'home.preset_legends_desc',
    emoji: '👑',
    pro: true,
    filter: { categories: ['player'], tags: ['legend'] },
  },
];

/** Drop empty keys so the filter that reaches the RPC (and the debounce
 *  key derived from it) stays stable and readable. */
export function normalizeFilter(filter: DeckFilter): DeckFilter {
  const out: DeckFilter = {};
  if (filter.categories?.length) out.categories = [...filter.categories].sort();
  if (filter.continents?.length) out.continents = [...filter.continents].sort();
  if (filter.countries?.length) out.countries = [...filter.countries].sort();
  if (filter.leagues?.length) out.leagues = [...filter.leagues].sort();
  if (filter.tags?.length) out.tags = [...filter.tags].sort();
  if (filter.fame_min) out.fame_min = filter.fame_min;
  if (filter.lang) out.lang = filter.lang;
  return out;
}

/** True when the filter selects nothing at all — no categories left to
 *  deal from. Used to explain a disabled Play button. */
export const isEmptySelection = (filter: DeckFilter): boolean =>
  Array.isArray(filter.categories) && filter.categories.length === 0;
