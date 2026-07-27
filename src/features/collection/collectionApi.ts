// Collection catalog reads. The deck is ~2k cards and PostgREST caps a plain
// select at 1000 rows, so the Collection screen does NOT fetch everything and
// filter in the browser — it filters in Postgres (category + ilike on the
// name) and pages through the result. See docs/DESIGN_SYSTEM.md for the
// visual side; this module is data only.

import { supabase } from '@/shared/lib/supabase';
import { isCardTranslationLang } from '@/shared/lib/cardName';
import type { Card, CardCategory } from '@/shared/types/database';

/** Only the columns the grid and the detail sheet render — `select('*')` would
 * drag along career_stats/facts/forbidden_words for every cell. */
export type CollectionCard = Pick<
  Card,
  'id' | 'name' | 'name_en' | 'category' | 'category_ru' | 'photo_url' | 'tier' | 'pageviews'
> & Pick<Card, 'card_translations'>;

const COLUMNS = 'id,name,name_en,category,category_ru,photo_url,tier,pageviews';

export const COLLECTION_PAGE_SIZE = 48;

// card_translations exists only after docs/card_translations.sql ran; until
// then PostgREST rejects the embedded relation, so after the first such
// rejection the plain select is used for the rest of the session. Same guard
// as fetchRoundCards() in features/room/roomService.ts.
let embedTranslations = true;

// PostgREST parses `or=(…)` as a filter expression, so a comma or paren typed
// into the search box would corrupt it. Strip the syntax characters; `%` and
// `_` are left alone (they only widen the player's own LIKE).
function sanitizeTerm(term: string): string {
  return term.replace(/[,()\\]/g, ' ').trim();
}

export interface CollectionPage {
  cards: CollectionCard[];
  /** A full page came back — there is probably another one behind it. */
  hasMore: boolean;
}

export async function fetchCollection(opts: {
  category: CardCategory | 'all';
  query: string;
  offset: number;
  lang: string;
}): Promise<CollectionPage> {
  const { category, query, offset, lang } = opts;
  const term = sanitizeTerm(query);
  const wantTranslations = embedTranslations && isCardTranslationLang(lang);

  const run = async (withTranslations: boolean) => {
    let q = supabase
      .from('cards')
      .select(withTranslations ? `${COLUMNS},card_translations(*)` : COLUMNS)
      .eq('active', true);
    if (category !== 'all') q = q.eq('category', category);
    // Russian names live in `name`, English in `name_en` — search both.
    if (term) q = q.or(`name.ilike.%${term}%,name_en.ilike.%${term}%`);
    return q
      // Most-known first. `name` breaks ties so paging stays stable — cards
      // with a null pageviews (every non-player category) would otherwise
      // come back in arbitrary order and repeat across pages.
      .order('pageviews', { ascending: false, nullsFirst: false })
      .order('name', { ascending: true })
      .range(offset, offset + COLLECTION_PAGE_SIZE - 1);
  };

  let { data, error } = await run(wantTranslations);
  if (error && wantTranslations) {
    embedTranslations = false; // pre-migration DB — retry without the embed
    ({ data, error } = await run(false));
  }
  if (error) throw error;

  const cards = (data ?? []) as unknown as CollectionCard[];
  return { cards, hasMore: cards.length === COLLECTION_PAGE_SIZE };
}
