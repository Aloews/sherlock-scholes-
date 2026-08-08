// Which kinds of cards a COMPETITIVE room plays with.
//
// RoomSettings.categories and activateRound have carried this end to end for
// a while — the competitive flows simply never set it, so every room played
// the whole deck. This is the missing control, not new plumbing.
//
// Deliberately coarser than DeckPickerScreen: the quick game is one person
// building a deck at leisure, a room is a host with friends waiting. Four
// toggles (players + the three named groups) instead of twelve chips and a
// four-step wizard.
//
// The count under the toggles comes from count_deck — the very RPC the room
// deals from — so the number shown is the number that can be dealt.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { hapticImpact } from '@/shared/lib/telegram';
import { countCards } from '@/features/game/cardRandomizer';
import { roomLangPool } from '@/features/room/roomService';
import {
  CATEGORY_GROUPS, NON_PLAYER_CATEGORIES, normalizeFilter, type DeckFilter,
} from '@/shared/types/deck';
import type { CardCategory } from '@/shared/types/database';

interface Props {
  /** null = every category, which is also the default a room is created with. */
  value: CardCategory[] | null;
  onChange: (next: CardCategory[] | null) => void;
  /** Room language — the deck is ranked by it, so the count must use it too. */
  lang: string;
  /** Hand size per round; sets how deep the language pool reaches. */
  cardsPerRound: number;
}

/** The toggles, in display order: players first, then the three groups. */
const PLAYERS: CardCategory = 'player';

export function RoomCategoryPicker({ value, onChange, lang, cardsPerRound }: Props) {
  const { t } = useTranslation();
  const [count, setCount] = useState<number | null>(null);

  // null means "everything", which is the state a fresh room starts in. Once
  // the host touches a toggle we track an explicit set, so "all selected" and
  // "untouched" stay the same deck either way.
  const selected = new Set<CardCategory>(value ?? [PLAYERS, ...NON_PLAYER_CATEGORIES]);

  const emit = (next: Set<CardCategory>) => {
    const all = next.size === NON_PLAYER_CATEGORIES.length + 1;
    onChange(all ? null : [...next]);
  };

  const toggleOne = (cat: CardCategory) => {
    hapticImpact('light');
    const next = new Set(selected);
    if (next.has(cat)) next.delete(cat); else next.add(cat);
    emit(next);
  };

  const toggleGroup = (cats: CardCategory[]) => {
    hapticImpact('light');
    const next = new Set(selected);
    const allOn = cats.every((c) => next.has(c));
    cats.forEach((c) => (allOn ? next.delete(c) : next.add(c)));
    emit(next);
  };

  // Same filter shape activateRound deals with, so the number is honest.
  const filter: DeckFilter = normalizeFilter({
    categories: value,
    lang,
    lang_pool: roomLangPool(cardsPerRound),
  });
  const filterKey = JSON.stringify(filter);

  useEffect(() => {
    let cancelled = false;
    setCount(null);
    const handle = setTimeout(() => {
      countCards(JSON.parse(filterKey) as DeckFilter)
        .then((n) => { if (!cancelled) setCount(n); });
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [filterKey]);

  const empty = value !== null && value.length === 0;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <p className="text-white text-sm font-medium">{t('home.room_categories')}</p>
        <p className="text-brand-muted text-xs" aria-live="polite">
          {/* deck_size already exists in all nine locales with the right
              plural forms — the count here means the same thing it means in
              the quick-game picker, so it says it the same way. */}
          {empty
            ? t('home.room_categories_empty')
            : t('home.deck_size', { count: count ?? 0 })}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={selected.has(PLAYERS)}
          className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
            selected.has(PLAYERS)
              ? 'bg-brand-accent text-brand-bg'
              : 'bg-brand-border text-white hover:bg-brand-border/70'
          }`}
          onClick={() => toggleOne(PLAYERS)}
        >
          {t('category.player')}
        </button>

        {CATEGORY_GROUPS.map((group) => {
          const on = group.categories.every((c) => selected.has(c));
          const some = !on && group.categories.some((c) => selected.has(c));
          return (
            <button
              key={group.id}
              type="button"
              aria-pressed={on}
              className={`rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                on
                  ? 'bg-brand-accent text-brand-bg'
                  : some
                    ? 'bg-brand-accent/30 text-white'
                    : 'bg-brand-border text-white hover:bg-brand-border/70'
              }`}
              onClick={() => toggleGroup(group.categories)}
            >
              {t(group.labelKey)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
