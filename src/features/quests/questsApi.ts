import { supabase } from '@/shared/lib/supabase';
import type { WeeklyQuest } from '@/shared/types/database';

// Both calls go through RPCs, not table reads: player_weekly_tasks is
// SELECT-only from the client (RLS, see supabase/migrations/weekly_quests.sql)
// and progress moves solely inside SECURITY DEFINER functions.

export async function fetchWeeklyQuests(playerId: number): Promise<WeeklyQuest[]> {
  const { data, error } = await supabase.rpc('get_weekly_quests', { p_player_id: playerId });
  if (error) throw error;
  return (data ?? []) as WeeklyQuest[];
}

/**
 * Claims a finished quest. Returns the XP awarded, or 0 when the server
 * declined — unfinished, already claimed, or not one of this week's three.
 * The server decides; a 0 here is an answer, not an error.
 */
export async function claimWeeklyQuest(playerId: number, code: string): Promise<number> {
  const { data, error } = await supabase.rpc('claim_weekly_task', {
    p_player_id: playerId,
    p_task_code: code,
  });
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}
