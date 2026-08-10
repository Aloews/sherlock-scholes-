import { describe, it, expect } from 'vitest';
import { KNOWN_SPORT_KEYS, leagueKey, readableSportKey } from './leagues';
import ru from '@/shared/i18n/locales/ru.json';
import ar from '@/shared/i18n/locales/ar.json';

// The provider names competitions, we name the translations, and the two meet
// at leagueKey(). Both halves of that meeting have already gone wrong once.

describe('leagueKey', () => {
  it('is the provider key under the leagues namespace', () => {
    expect(leagueKey('soccer_epl')).toBe('leagues.soccer_epl');
  });

  // THE ONE THAT ACTUALLY BROKE. i18next reads a trailing _one as the singular
  // form of a shorter key and resolves it through the language's plural rules,
  // so Ligue 1 arrived as a "missing plural form" in Arabic — a competition
  // vanishing from one language for a reason nothing on screen could explain.
  it('escapes a provider key that ends in an i18next plural suffix', () => {
    expect(leagueKey('soccer_france_ligue_one')).toBe('leagues.soccer_france_ligue-one');
  });

  it.each(['zero', 'one', 'two', 'few', 'many', 'other'])(
    'escapes _%s, not just the suffix that bit us',
    (suffix) => {
      expect(leagueKey(`soccer_made_up_${suffix}`)).toBe(`leagues.soccer_made_up-${suffix}`);
    },
  );

  it('leaves a key that merely contains a suffix word alone', () => {
    // "one" in the middle is not a plural form, and rewriting it would break a
    // perfectly good key to fix a problem it does not have.
    expect(leagueKey('soccer_one_league')).toBe('leagues.soccer_one_league');
  });
});

describe('league translations', () => {
  // Every competition we have seen must be named, in every language. A gap
  // shows up as a raw provider key in the middle of a fixture list.
  it.each([['ru', ru], ['ar', ar]] as const)('%s names every known competition', (_lang, dict) => {
    const leagues = (dict as { leagues: Record<string, string> }).leagues;
    const missing = KNOWN_SPORT_KEYS.filter(
      (key) => !leagues[leagueKey(key).replace('leagues.', '')],
    );
    expect(missing).toEqual([]);
  });
});

describe('readableSportKey', () => {
  it('names an untranslated competition instead of leaving a hole', () => {
    // Ugly and honest beats tidy and blank: a missing row reads as a bug in
    // the list, a clumsy name reads as a gap in the dictionary.
    expect(readableSportKey('soccer_belgium_first_div')).toBe('Belgium First Div');
  });
});
