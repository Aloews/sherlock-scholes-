/**
 * Turning "Manchester United" into one of our club cards.
 *
 * the-odds-api has never heard of our cards. It sends English club names as
 * free text, and the only bridge is `card_translations(en)` — so this is a
 * name match, and name matches are where quiet wrongness gets in.
 *
 * NO FUZZY MATCHING, DELIBERATELY. Edit distance would happily pair
 * "Manchester United" with "Manchester City": one letter of difference in the
 * part that carries all the meaning. A match to the wrong club is far worse
 * than no match at all — it puts a real crest and a real name on somebody
 * else's fixture, and nothing downstream can tell it happened. So: normalise
 * hard, then require exact equality, then a hand-written alias list for the
 * cases normalising cannot reach.
 *
 * An unmatched fixture is not a failure. It is shown with the provider's own
 * names (docs/LIVE_FOOTBALL_HANDOFF.md §4.1), and the remainder is meant to be
 * worked through by hand as cards are added.
 */

/**
 * Decorations that identify a club to a human and nothing to a matcher.
 *
 * Ordered longest-first where they overlap, so "AFC" is taken before "FC".
 * Only stripped at a word boundary: "Fulham" must not lose its "F".
 */
const AFFIXES = [
  'afc', 'fc', 'cf', 'sc', 'ac', 'as', 'ss', 'ssc', 'sv', 'vfb', 'vfl', 'fk',
  'cd', 'ud', 'rc', 'rcd', 'bsc', 'tsg', 'psv', 'nk', 'hnk', 'club', 'calcio',
];

/**
 * Cuts a club name down to the part that actually distinguishes it.
 *
 * Diacritics go because the provider drops them inconsistently
 * ("Atletico"/"Atlético"), punctuation goes because it is noise, and the
 * affixes above go because "FC Barcelona", "Barcelona FC" and "Barcelona" are
 * one club spelled three ways by three sources.
 */
export function normaliseClubName(name: string): string {
  const bare = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')   // strip combining accents
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')      // punctuation is noise, not a letter
    .replace(/\s+/g, ' ')
    .trim();

  const words = bare.split(' ').filter((w) => w.length > 0 && !AFFIXES.includes(w));
  // A name made only of affixes keeps its original words rather than becoming
  // empty — "Club Brugge" reduced to nothing would match every other husk.
  return (words.length > 0 ? words : bare.split(' ')).join(' ');
}

/**
 * Names the normaliser cannot reconcile, because they are different words.
 *
 * Every entry is a judgement someone made once, on purpose. Keep it small: a
 * long alias list is a fuzzy matcher with extra steps, and each line here is a
 * claim that two different names are certainly the same club.
 */
const ALIASES: Record<string, string> = {
  'wolverhampton wanderers': 'wolves',
  'brighton and hove albion': 'brighton hove albion',
  'tottenham hotspur': 'tottenham',
  'internazionale': 'inter milan',
  'inter': 'inter milan',
  'paris saint germain': 'psg',
  'bayern munchen': 'bayern munich',
  'borussia monchengladbach': 'monchengladbach',
  'sporting clube de portugal': 'sporting cp',
  'manchester utd': 'manchester united',
  'newcastle': 'newcastle united',
  'west ham': 'west ham united',
  'leeds': 'leeds united',
};

/** The key a name is looked up by: normalised, then aliased if we know better. */
export function matchKey(name: string): string {
  const normalised = normaliseClubName(name);
  return ALIASES[normalised] ?? normalised;
}

export interface ClubCard {
  id: string;
  /** The club's English name, from card_translations. */
  name: string;
}

/**
 * An index from name-key to card id, for matching a batch of fixtures.
 *
 * A key claimed by two different cards is dropped from the index entirely. That
 * is the whole point: two cards answering to one name means we cannot tell
 * which was meant, and picking either would be a coin toss printed as fact.
 */
export function buildClubIndex(cards: readonly ClubCard[]): Map<string, string> {
  const byKey = new Map<string, string>();
  const ambiguous = new Set<string>();

  for (const card of cards) {
    const key = matchKey(card.name);
    if (!key) continue;
    if (byKey.has(key) && byKey.get(key) !== card.id) {
      ambiguous.add(key);
      continue;
    }
    byKey.set(key, card.id);
  }

  for (const key of ambiguous) byKey.delete(key);
  return byKey;
}

/** The card this club name certainly means, or null when we cannot be sure. */
export function matchClub(name: string, index: ReadonlyMap<string, string>): string | null {
  return index.get(matchKey(name)) ?? null;
}
