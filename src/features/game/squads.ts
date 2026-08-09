import { supabase } from '@/shared/lib/supabase';

/**
 * The clubs whose current squad is big enough to play with.
 *
 * "Current" is honest but not live: it means the club a player had not left
 * when their Wikipedia article was last read (current_squads.sql). A transfer
 * from last week is not here yet, so `asOf` travels with the list and the
 * picker must show it. A stale fact presented as stale is a fact; presented as
 * current it is the same lie we refused when we dropped wiki as a source of
 * live scores.
 */
export interface Squad {
  /** The key the deck filter matches on. Never a name typed by anyone. */
  key: string;
  /** The club as its players' articles spell it, for a build with no card. */
  name: string;
  players: number;
  /** The club card, when one was recognisable — a crest and a translated name. */
  cardId: string | null;
  /** When the underlying articles were last read. */
  asOf: string | null;
}

/**
 * A squad smaller than this cannot fill a round, and offering it would be
 * offering a button that deals an empty game. Matches the RPC's own default.
 */
export const MIN_SQUAD = 8;

export async function fetchSquads(min = MIN_SQUAD): Promise<Squad[]> {
  const { data, error } = await supabase.rpc('deck_squads', { p_min: min });
  if (error || !Array.isArray(data)) return [];

  return (data as Array<Record<string, unknown>>).map((row) => ({
    key: String(row.club_key ?? ''),
    name: String(row.club ?? ''),
    players: Number(row.players ?? 0),
    cardId: (row.card_id as string | null) ?? null,
    asOf: (row.fetched_at as string | null) ?? null,
  })).filter((s) => s.key.length > 0);
}
