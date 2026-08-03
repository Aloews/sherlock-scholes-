/**
 * Splitting what a player WON from where a player PLAYED.
 *
 * The dossier used to concatenate `facts.titles`, `legend_career.titles` and
 * `facts.tournaments` into one list under a trophy icon. The first two are
 * honours; the third is participation — appearing at a World Cup is not
 * winning one. The screen was crediting real people with trophies they never
 * lifted, which is a factual claim about them, not a layout detail.
 *
 * The rule lives here, apart from the component, so it can be asserted.
 */
export interface HonourSources {
  titles?: string[] | null;
  legendTitles?: string[] | null;
  tournaments?: string[] | null;
}

export interface Honours {
  /** Won. Gets the cup. */
  trophies: string[];
  /** Took part in. Never gets the cup, and never repeats a trophy. */
  tournaments: string[];
}

const clean = (xs: string[] | null | undefined): string[] =>
  (xs ?? []).filter((x): x is string => typeof x === 'string' && x.trim() !== '');

const dedupe = (xs: string[]): string[] => xs.filter((x, i, a) => a.indexOf(x) === i);

export function splitHonours({ titles, legendTitles, tournaments }: HonourSources): Honours {
  const trophies = dedupe([...clean(titles), ...clean(legendTitles)]);
  // A competition a player both entered and won is a trophy, and listing it
  // twice would read as two separate achievements.
  const rest = dedupe(clean(tournaments)).filter((t) => !trophies.includes(t));
  return { trophies, tournaments: rest };
}
