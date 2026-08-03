// Collection catalog reads. The deck is ~2k cards and PostgREST caps a plain
// select at 1000 rows, so the Collection screen does NOT fetch everything and
// filter in the browser — it filters in Postgres (category + ilike on the
// name) and pages through the result. See docs/DESIGN_SYSTEM.md for the
// visual side; this module is data only.
//
// Ordering goes through the collection_page RPC
// (supabase/migrations/collection_page_by_lang.sql) rather than .order(),
// for two reasons that both bite silently:
//   * the sort key is `pageviews_i18n ->> lang`, and PostgREST orders that
//     as TEXT — "9" would outrank "10000";
//   * the fallback when a language is missing has to be COALESCE, not
//     GREATEST. With GREATEST the Russian score always wins and a French
//     player still opens «Клубы» on «Зенит», which is the whole bug.
// The RPC returns SETOF cards, so column selection and the
// card_translations embed work exactly as they did on the plain select.

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

// The search term used to be stripped of `,()\` because PostgREST parses
// `or=(…)` as a filter expression and those characters corrupted it. The RPC
// takes the term as a bind parameter, so that class of breakage is gone and
// the stripping with it — «Интер (Майами)» is now findable by typing it.
// `%` and `_` still reach LIKE as wildcards, exactly as before.

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
  const term = query.trim();
  const wantTranslations = embedTranslations && isCardTranslationLang(lang);

  const run = async (withTranslations: boolean) =>
    supabase
      .rpc('collection_page', {
        // The RPC re-normalizes, but sending the base tag keeps the request
        // identical for 'pt' and 'pt-BR' so the PostgREST plan cache hits.
        p_lang: lang.slice(0, 2),
        p_category: category === 'all' ? null : category,
        // Russian names live in `name`, English in `name_en` — the RPC
        // searches both.
        p_query: term || null,
        p_limit: COLLECTION_PAGE_SIZE,
        p_offset: offset,
      })
      .select(withTranslations ? `${COLUMNS},card_translations(*)` : COLUMNS);

  let { data, error } = await run(wantTranslations);
  if (error && wantTranslations) {
    embedTranslations = false; // pre-migration DB — retry without the embed
    ({ data, error } = await run(false));
  }
  if (error) throw error;

  const cards = (data ?? []) as unknown as CollectionCard[];
  return { cards, hasMore: cards.length === COLLECTION_PAGE_SIZE };
}

/** Full row for the dossier sheet. The grid deliberately fetches only display
 * columns, so opening a card pulls the rest on demand — career, facts and
 * trophies are big JSONB and have no business in 48 grid cells. */
export async function fetchCard(id: string): Promise<Card> {
  const run = async (withTranslations: boolean) => supabase
    .from('cards')
    .select(withTranslations ? '*, card_translations(*)' : '*')
    .eq('id', id)
    .single();

  let { data, error } = await run(embedTranslations);
  if (error && embedTranslations) {
    embedTranslations = false;
    ({ data, error } = await run(false));
  }
  if (error) throw error;
  return data as unknown as Card;
}
