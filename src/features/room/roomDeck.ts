// What a ROOM deals — the one place that decides.
//
// A multiplayer room used to deal `{ categories }` and nothing else: the whole
// filter vocabulary the quick game has had for months — leagues, squads,
// continents, traits, a recognizability floor — stopped at the training screen,
// because the only thing a room could remember about its deck was a list of
// categories. Two friends who wanted "current Arsenal squad, famous only" had
// to play that alone.
//
// So a room now carries a whole DeckFilter, the same object `cards_matching`
// reads (src/shared/types/deck.ts). Two rules keep that from breaking the
// rooms already in flight:
//
//   OLD ROOMS STILL DEAL. `settings.deck` is absent on every room created
//   before this, and `roomDeckFilter` falls back to the categories those rooms
//   do carry — which is exactly what activateRound passed before.
//
//   OLD FRONTENDS STILL DEAL. A build that predates this reads
//   `settings.categories` and ignores `deck`, and any client in the room may
//   be the one that activates a round. So `categories` is kept in step with
//   the filter on every write: an old phone dealing for a room whose host
//   picked "players only" deals players, just without the league narrowing it
//   has never heard of. Degraded, not wrong.

import type { CardCategory, RoomSettings } from '@/shared/types/database';
import { normalizeFilter, type DeckFilter } from '@/shared/types/deck';

/**
 * The filter a room deals from.
 *
 * `activateRound` and the lobby's card counter both go through here, so the
 * number the host reads before pressing Start and the hand the round deals
 * come from one object — the same reason `count_deck` and `pick_random_cards`
 * share a predicate.
 */
export function roomDeckFilter(settings: RoomSettings): DeckFilter {
  const stored = settings.deck;
  if (stored && typeof stored === 'object') return normalizeFilter(stored);
  return normalizeFilter({ categories: settings.categories });
}

/**
 * Trim a filter down to what may be PINNED TO A ROOM.
 *
 * `lang` is dropped, and that is a decision rather than an omission. It filters
 * culture-bound cards — a commentator nobody outside their broadcast area has
 * heard of — against the interface language of ONE phone. A room has several,
 * and rooms have never applied it: `activateRound` passed categories alone.
 * Storing the host's language here would quietly delete cards from everyone
 * else's deck because of a setting on a device they cannot see.
 *
 * Everything else survives verbatim. The server sanitises Pro-only tags at
 * deal time (`deck_sanitize_filter`), so a non-Pro host cannot smuggle
 * `legend` in by storing it — it is stripped when the cards are drawn.
 */
export function pinnableFilter(filter: DeckFilter): DeckFilter {
  const { lang: _lang, ...rest } = normalizeFilter(filter);
  void _lang;
  return normalizeFilter(rest);
}

/**
 * The settings patch that stores `filter` on a room.
 *
 * Writes `categories` alongside `deck` for the old-frontend reason in the
 * header. `null` means every category in both places, which is what an absent
 * `categories` key has always meant.
 */
export function settingsWithDeck(
  settings: RoomSettings,
  filter: DeckFilter,
): RoomSettings {
  const deck = pinnableFilter(filter);
  return {
    ...settings,
    deck,
    categories: (deck.categories ?? null) as CardCategory[] | null,
  };
}

/**
 * True when the room deals the whole deck — nothing narrowed at all.
 *
 * Used to label the lobby panel: "everything" is a fact worth stating, and a
 * list of zero chips reads as a control that failed to load.
 */
export function isWholeDeck(filter: DeckFilter): boolean {
  return Object.keys(normalizeFilter(filter)).length === 0;
}
