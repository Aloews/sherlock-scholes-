// Card display name with the translation fallback chain.
//
// The deck is Russian (cards.name) with an English mirror (cards.name_en);
// other languages live in card_translations (docs/card_translations.sql).
// Display rule per interface language:
//   ИГРОК         -> name_en НА ЛЮБОМ ЯЗЫКЕ (см. isPlayer ниже)
//   ru            -> name
//   en            -> name_en -> name
//   es/pt/fr/...  -> translation -> name_en -> name
// The interface itself stays ru/en (i18next falls back); only card names
// are translated.

import type { CardTranslation } from '@/shared/types/database';

export const CARD_TRANSLATION_LANGS = ['es', 'pt', 'fr', 'zh', 'ja', 'ko', 'ar'] as const;
export type CardLang = (typeof CARD_TRANSLATION_LANGS)[number];

/** True when the language keeps its card names in card_translations. */
export function isCardTranslationLang(lang: string): lang is CardLang {
  return (CARD_TRANSLATION_LANGS as readonly string[]).includes(lang.slice(0, 2));
}

interface NamedCard {
  name: string;
  name_en?: string | null;
  card_translations?: CardTranslation[] | null;
  /** Нужна, чтобы отличить игрока: его имя не переводится. См. ниже. */
  category?: string | null;
}

/**
 * ИМЯ ФУТБОЛИСТА НЕ ПЕРЕВОДИТСЯ — ОНО ПИШЕТСЯ ЛАТИНИЦЕЙ НА ЛЮБОМ ЯЗЫКЕ.
 *
 * Владелец: «Имена игроков лучше не переводить а везде писать латиницей, а вот
 * интерфейс переводить нужно везде».
 *
 * ⚠️ ЭТО НЕ ВКУСОВЩИНА, У НЕЁ ЕСТЬ ЗАМЕРЕННАЯ ЦЕНА. Одного человека колода
 * писала двумя способами, и владелец увидел это как ДУБЛЬ: «Алексис Вега» и
 * «Alexis Vega». Проверка по Викиданным показала, что это РАЗНЫЕ люди —
 * аргентинец 1993 года (Q27825117, TM 423630) и мексиканец 1997-го
 * (Q23799433, TM 424689), — то есть удалять было нечего, а путаницу создавало
 * именно разное написание: две карточки выглядели как одна, заведённая дважды.
 * Латиница делает их сравнимыми глазами.
 *
 * Замер 06.09.2026: у 11 533 из 19 115 активных игроков `name` кириллический,
 * а `name_en` есть у ВСЕХ, кроме одного. То есть правило применимо, а не
 * благое пожелание.
 *
 * Категория берётся из карточки; если её не передали — правило не срабатывает
 * и работает прежняя цепочка. Это сознательно: молча переименовать клуб
 * «Спартак» в «Spartak» на русском экране было бы хуже, чем не переименовать
 * игрока.
 */
function isPlayer(card: NamedCard): boolean {
  return card.category === 'player';
}

/**
 * Resolve the display name of a card for the given interface language.
 * `translation` (when the caller fetched it separately, e.g. the RPC path)
 * wins over the embedded card_translations array.
 */
export function cardDisplayName(
  card: NamedCard,
  lang: string,
  translation?: string | null,
): string {
  const base = lang.slice(0, 2);
  // Игрок — латиницей на любом языке, включая русский.
  if (isPlayer(card) && card.name_en) return card.name_en;
  if (base === 'ru') return card.name;
  if (base !== 'en') {
    const tr = translation
      ?? card.card_translations?.find((t) => t.lang === base)?.name;
    if (tr) return tr;
  }
  return card.name_en || card.name;
}
