// The provider's competition keys, and what to call them.
//
// EVERY KEY GETS AN ENTRY, INCLUDING THE ONES THAT TRAVEL UNCHANGED. "Serie A"
// is Serie A in nine languages, and writing it down anyway is what stops the
// silent fallback — the case where a name SHOULD differ and nobody noticed.
// "Premier League" is the sharpest example: it means England here, and
// Russia's top flight is its own entry rather than a second Premier League.
// That rule is CLAUDE.md's; this file is where it is paid for.
//
// The provider invents new keys whenever a competition starts, so an unknown
// one must not blank the row: `leagueLabel` falls back to the key made
// readable, which is ugly and honest, rather than empty and tidy.

/** Sport keys we have seen in `fixtures`, in no meaningful order. */
export const KNOWN_SPORT_KEYS = [
  'soccer_epl',
  'soccer_spain_la_liga',
  'soccer_italy_serie_a',
  'soccer_germany_bundesliga',
  'soccer_france_ligue_one',
  'soccer_netherlands_eredivisie',
  'soccer_portugal_primeira_liga',
  'soccer_turkey_super_league',
  'soccer_russia_premier_league',
  'soccer_usa_mls',
  'soccer_mexico_ligamx',
  'soccer_brazil_campeonato',
  'soccer_argentina_primera_division',
  'soccer_japan_j_league',
  'soccer_korea_kleague1',
  'soccer_china_superleague',
  'soccer_uefa_champs_league',
  'soccer_uefa_champs_league_qualification',
  'soccer_uefa_europa_league',
  'soccer_uefa_nations_league',
  // Сборные раз в два-четыре года. Ключей нет в расписании прямо сейчас — и
  // именно поэтому они здесь: провайдер отдаёт турнир, когда тот начинается,
  // а без записи имя выпало бы в readableSportKey ровно в тот месяц, когда на
  // экран смотрят чаще всего.
  'soccer_fifa_world_cup',
  'soccer_fifa_world_cup_qualifiers_europe',
  'soccer_uefa_european_championship',
  'soccer_uefa_euro_qualification',
  'soccer_conmebol_copa_libertadores',
  'soccer_conmebol_copa_sudamericana',
] as const;

/**
 * The suffixes i18next reads as plural forms.
 *
 * A key ending in one of these is not a key to i18next — it is the `_one`
 * form of a shorter key, and the lookup goes through the plural rules of the
 * current language. That is a real collision here and not a hypothetical:
 * the provider calls Ligue 1 `soccer_france_ligue_one`, which reads as the
 * singular of `soccer_france_ligue`, and Arabic — which needs `_other` — then
 * has a "missing plural form" for a competition.
 */
const I18NEXT_PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];

/**
 * The i18n key for a competition. Always defined — see the note above.
 *
 * The last segment is joined with a hyphen when it would otherwise look like a
 * plural form, so `soccer_france_ligue_one` becomes `leagues.soccer_france_
 * ligue-one`. Handled here rather than by renaming the one key that collides
 * today, because the provider keeps inventing keys and the next `_one` would
 * fail the same way — quietly, as a missing translation in one language.
 */
export function leagueKey(sportKey: string): string {
  const parts = sportKey.split('_');
  const last = parts[parts.length - 1];
  if (parts.length > 1 && I18NEXT_PLURAL_SUFFIXES.includes(last)) {
    return `leagues.${parts.slice(0, -1).join('_')}-${last}`;
  }
  return `leagues.${sportKey}`;
}

/**
 * What to show when the provider sends a competition nobody has translated.
 *
 * `soccer_belgium_first_div` becomes "Belgium First Div". Not good, but it
 * names the thing, and a blank cell would look like a bug in the fixture list
 * rather than a gap in this file.
 */
export function readableSportKey(sportKey: string): string {
  return sportKey
    .replace(/^soccer_/, '')
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
