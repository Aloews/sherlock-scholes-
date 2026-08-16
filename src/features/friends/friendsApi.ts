// Friends and who to add — client wrappers.
//
// Reads take a player id; writes take the raw Telegram initData instead,
// because add_friend/remove_friend derive the caller from its signature
// server-side. A client cannot edit somebody else's list even by asking
// nicely. See supabase/migrations/friends_and_rating.sql.

import { supabase } from '@/shared/lib/supabase';
import { fromPostgrest, type LoadState } from '@/shared/lib/loadState';

/** A player as they appear in a list — theirs, not ours. */
export interface FriendRow {
  player_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  avatar_url: string | null;
  /** The rating axis: the same XP the profile shows, never a second number. */
  xp: number;
  games_played: number;
  games_won: number;
  cards_guessed: number;
  /** Games this player and the viewer were in the same room. */
  games_together: number;
}

export interface SuggestionRow {
  player_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  avatar_url: string | null;
  xp: number;
  games_together: number;
  last_game_at: string;
}

/** The viewer's friends, best-rated first. Empty on any failure — a list that
 * cannot load is an empty list, not a crash in the middle of the profile. */
/**
 * Список друзей — С РАЗЛИЧЕНИЕМ «ПУСТО» И «СЛОМАЛОСЬ».
 *
 * Пустой список здесь правдоподобен как нигде: у нового игрока друзей правда
 * нет, и «пока никого» — законный ответ, который никого не удивляет. Ровно
 * поэтому отказ, показанный той же надписью, не опознаётся: человек решает,
 * что список пуст, и уходит — а на самом деле не ответил сервер.
 */
export async function fetchFriends(playerId: number): Promise<LoadState<FriendRow[]>> {
  const res = await supabase.rpc('friends_with_rating', { p_player_id: playerId });
  return fromPostgrest<FriendRow[]>(res, 'friends_with_rating');
}

/**
 * People the viewer has actually played with and has not added yet.
 *
 * Not "people you may know": every row is somebody who was in a room with
 * them, which is the only relationship this game can prove.
 */
export async function fetchSuggestions(playerId: number, limit = 10): Promise<SuggestionRow[]> {
  const { data, error } = await supabase.rpc('friend_suggestions', {
    p_player_id: playerId,
    p_limit: limit,
  });
  if (error) {
    console.error('[friends] friend_suggestions failed:', error.code, error.message);
    return [];
  }
  return (data as SuggestionRow[]) ?? [];
}

/** Returns whether the server accepted it — outside Telegram it never can. */
export async function addFriend(initData: string, friendId: number): Promise<boolean> {
  if (!initData) return false;
  const { data, error } = await supabase.rpc('add_friend', {
    p_init_data: initData,
    p_friend_id: friendId,
  });
  if (error) {
    console.error('[friends] add_friend failed:', error.code, error.message);
    return false;
  }
  return data === true;
}

export async function removeFriend(initData: string, friendId: number): Promise<boolean> {
  if (!initData) return false;
  const { data, error } = await supabase.rpc('remove_friend', {
    p_init_data: initData,
    p_friend_id: friendId,
  });
  if (error) {
    console.error('[friends] remove_friend failed:', error.code, error.message);
    return false;
  }
  return data === true;
}

/** Full name as Telegram would show it, with the empty halves left out. */
export function displayName(row: { first_name: string; last_name: string | null }): string {
  return `${row.first_name} ${row.last_name ?? ''}`.trim();
}
