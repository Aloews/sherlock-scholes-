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

/**
 * ИМЯ ИГРОКА — ЛАТИНИЦЕЙ НА ЛЮБОМ ЯЗЫКЕ.
 *
 * Пример живой: владелец принял две карточки за дубль, потому что один и тот
 * же экран показывал «Алексис Вега» и «Alexis Vega». Это РАЗНЫЕ люди
 * (Викиданные: аргентинец 1993 и мексиканец 1997), и различить их глазами
 * можно только в одном алфавите.
 */
describe('cardDisplayName: игрок пишется латиницей', () => {
  const vega = { name: 'Алексис Вега', name_en: 'Alexis Vega', category: 'player' };

  it('на русском тоже латиницей', () => {
    expect(cardDisplayName(vega, 'ru')).toBe('Alexis Vega');
  });

  it('и на языке с переводами карточек — тоже', () => {
    const withTr = {
      ...vega,
      card_translations: [{ lang: 'es', name: 'Alexis Vega (es)' } as never],
    };
    expect(cardDisplayName(withTr, 'es')).toBe('Alexis Vega');
  });

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ: правило обязано бить ТОЛЬКО по игрокам.
  // Переименовать «Спартак» в «Spartak» на русском экране — не то, о чём
  // просили, и проверка «игрок латиницей» прошла бы и у такой поломки.
  it('клуб на русском остаётся русским', () => {
    const club = { name: 'Спартак', name_en: 'Spartak', category: 'club' };
    expect(cardDisplayName(club, 'ru')).toBe('Спартак');
  });

  it('без категории правило молчит — работает прежняя цепочка', () => {
    expect(cardDisplayName({ name: 'Алексис Вега', name_en: 'Alexis Vega' }, 'ru'))
      .toBe('Алексис Вега');
  });

  it('игрок без name_en показывается как есть, а не пустотой', () => {
    expect(cardDisplayName({ name: 'Алексис Вега', category: 'player' }, 'ru'))
      .toBe('Алексис Вега');
  });
});
