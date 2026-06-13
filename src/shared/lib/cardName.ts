// Card display name with the translation fallback chain.
//
// The deck is Russian (cards.name) with an English mirror (cards.name_en);
// other languages live in card_translations (docs/card_translations.sql).
// Display rule per interface language:
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
  if (base === 'ru') return card.name;
  if (base !== 'en') {
    const tr = translation
      ?? card.card_translations?.find((t) => t.lang === base)?.name;
    if (tr) return tr;
  }
  return card.name_en || card.name;
}
