import { describe, it, expect } from 'vitest';
import { cardDisplayName, isCardTranslationLang, CARD_TRANSLATION_LANGS } from './cardName';
import type { CardTranslation } from '@/shared/types/database';

const tr = (lang: string, name: string): CardTranslation => ({ card_id: 'c1', lang, name });

const card = {
  name: 'Зинедин Зидан',
  name_en: 'Zinedine Zidane',
  card_translations: [tr('es', 'Zinedine Zidane ES'), tr('ja', 'ジダン')],
};

describe('cardDisplayName', () => {
  it('uses the Russian name for ru', () => {
    expect(cardDisplayName(card, 'ru')).toBe('Зинедин Зидан');
  });

  it('uses name_en for en', () => {
    expect(cardDisplayName(card, 'en')).toBe('Zinedine Zidane');
  });

  it('uses the translation when the language has one', () => {
    expect(cardDisplayName(card, 'es')).toBe('Zinedine Zidane ES');
    expect(cardDisplayName(card, 'ja')).toBe('ジダン');
  });

  it('falls back through name_en to name when a translation is missing', () => {
    expect(cardDisplayName(card, 'ko')).toBe('Zinedine Zidane');
    expect(cardDisplayName({ name: 'Только имя' }, 'ko')).toBe('Только имя');
  });

  it('accepts a region tag — the fallback keys off the base language', () => {
    expect(cardDisplayName(card, 'es-MX')).toBe('Zinedine Zidane ES');
    expect(cardDisplayName(card, 'ru-RU')).toBe('Зинедин Зидан');
  });

  it('prefers an explicitly passed translation over the embedded array', () => {
    expect(cardDisplayName(card, 'es', 'Отдельный перевод')).toBe('Отдельный перевод');
  });
});

// fetchRoundCards() skips the card_translations embed entirely for ru and en,
// and filters it to a single language for the rest — a competitive round holds
// 100 cards, and shipping nine languages of each was most of the payload.
// That optimisation is only sound while the two rules below hold, so they are
// pinned here rather than left as a comment in the query.
describe('the translation fetch can be narrowed safely', () => {
  it('ru and en resolve a name WITHOUT touching card_translations', () => {
    const noTranslations = { name: 'Имя', name_en: 'Name' };
    expect(cardDisplayName(noTranslations, 'ru')).toBe('Имя');
    expect(cardDisplayName(noTranslations, 'en')).toBe('Name');
    // …and isCardTranslationLang agrees, which is what the query branches on.
    expect(isCardTranslationLang('ru')).toBe(false);
    expect(isCardTranslationLang('en')).toBe(false);
  });

  it('every other supported language needs exactly its own row', () => {
    for (const lang of CARD_TRANSLATION_LANGS) {
      expect(isCardTranslationLang(lang)).toBe(true);
      const only = { name: 'Имя', name_en: 'Name', card_translations: [tr(lang, `NAME-${lang}`)] };
      expect(cardDisplayName(only, lang)).toBe(`NAME-${lang}`);
    }
  });

  it('an unknown language is not treated as translatable', () => {
    expect(isCardTranslationLang('de')).toBe(false);
    expect(cardDisplayName(card, 'de')).toBe('Zinedine Zidane');
  });
});
