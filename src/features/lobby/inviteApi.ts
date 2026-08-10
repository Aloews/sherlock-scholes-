// Inviting a friend into a room, and finding out who invited you.
//
// Every call carries the raw Telegram initData rather than a player id: an
// invite names two people, and a client allowed to claim to be either of them
// could read who is inviting whom, or drop an invitation into a stranger's
// list. See supabase/migrations/room_invites.sql.
//
// Failures return an empty list or false rather than throwing, for the same
// reason friendsApi does: a list that cannot load is an empty list, not a
// crash in the middle of the lobby.

import { supabase } from '@/shared/lib/supabase';

/** An invitation waiting for the viewer. Carries the code so joining reuses
 *  the ordinary join path — no second way into a room. */
export interface PendingInvite {
  room_id: string;
  code: string;
  from_id: number;
  first_name: string;
  last_name: string | null;
  avatar_url: string | null;
  /** How many are already in there. "Nobody yet" and "four waiting" are
   *  different invitations, and the player deserves to know which. */
  players: number;
  created_at: string;
}

export async function fetchPendingInvites(initData: string): Promise<PendingInvite[]> {
  if (!initData) return [];
  const { data, error } = await supabase.rpc('pending_room_invites', { p_init_data: initData });
  if (error) {
    console.error('[invites] pending_room_invites failed:', error.code, error.message);
    return [];
  }
  return (data as PendingInvite[]) ?? [];
}

/**
 * Ask somebody to come and play.
 *
 * False is a real answer, not only an error: the server refuses when the room
 * has already started or the invitee is already in it. The caller should say
 * so rather than showing a tick.
 */
export async function inviteToRoom(
  initData: string,
  roomId: string,
  toId: number,
): Promise<boolean> {
  if (!initData) return false;
  const { data, error } = await supabase.rpc('invite_to_room', {
    p_init_data: initData,
    p_room_id: roomId,
    p_to_id: toId,
  });
  if (error) {
    console.error('[invites] invite_to_room failed:', error.code, error.message);
    return false;
  }
  return data === true;
}

export async function declineInvite(initData: string, roomId: string): Promise<boolean> {
  if (!initData) return false;
  const { error } = await supabase.rpc('decline_room_invite', {
    p_init_data: initData,
    p_room_id: roomId,
  });
  if (error) {
    console.error('[invites] decline_room_invite failed:', error.code, error.message);
    return false;
  }
  return true;
}
