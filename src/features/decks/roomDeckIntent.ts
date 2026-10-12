import { ALL_CATEGORIES, type CardCategory } from '@/shared/types/database';
import type { DeckFilter } from '@/shared/types/deck';

export interface AIResolvedDeck {
  filter: DeckFilter;
  cardCount: number;
  title: string | null;
  message: string | null;
}

export function parseAIResolvedDeck(value: unknown): AIResolvedDeck | null {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { cards?: unknown }).cards)) return null;
  const payload = value as { cards: unknown[]; title?: unknown; message?: unknown };
  const cards = payload.cards.filter((item): item is { id: string; category: CardCategory } => {
    if (!item || typeof item !== 'object') return false;
    const card = item as { id?: unknown; category?: unknown };
    return typeof card.id === 'string' && card.id.length > 0
      && typeof card.category === 'string'
      && ALL_CATEGORIES.includes(card.category as CardCategory);
  });
  const unique = [...new Map(cards.map((card) => [card.id, card])).values()].slice(0, 20);
  const categories = [...new Set(unique.map((card) => card.category))];
  if (unique.length < 3 || categories.length === 0) return null;
  return {
    filter: { categories, card_ids: unique.map((card) => card.id) },
    cardCount: unique.length,
    title: typeof payload.title === 'string' ? payload.title.trim().slice(0, 70) || null : null,
    message: typeof payload.message === 'string' ? payload.message.trim().slice(0, 300) || null : null,
  };
}
