import type { WeeklyQuest } from '@/shared/types/database';

// Presentation rules for a weekly quest. Pure on purpose: the rotation — WHICH
// three tasks a week holds — is decided once in SQL (weekly_task_codes, see
// supabase/migrations/weekly_quests.sql) and never recomputed here, so the
// tasks a player sees and the tasks their play credits cannot drift apart.
// What lives here is only how a task the server already chose is drawn.

export type QuestState = 'in_progress' | 'ready' | 'claimed';

export function questState(quest: WeeklyQuest): QuestState {
  if (quest.claimed_at) return 'claimed';
  return quest.progress >= quest.target ? 'ready' : 'in_progress';
}

// 0–100. Clamped at both ends: the server caps progress at the target, but a
// catalogue edit that lowers a target after someone banked progress would
// otherwise push the bar past full.
export function questPct(quest: WeeklyQuest): number {
  if (quest.target <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((quest.progress / quest.target) * 100)));
}

// Whole days until the week's tasks rotate, counted from Monday 00:00 UTC —
// the same boundary current_week_start() uses. Returns 7 on the Monday itself
// and 1 on the Sunday, so "остался 1 день" reads as the last day rather than
// as an already-expired week.
export function daysLeftInWeek(weekStart: string, now: Date = new Date()): number {
  const start = Date.parse(`${weekStart}T00:00:00Z`);
  if (Number.isNaN(start)) return 0;
  const end = start + 7 * 24 * 60 * 60 * 1000;
  const msLeft = end - now.getTime();
  if (msLeft <= 0) return 0;
  return Math.ceil(msLeft / (24 * 60 * 60 * 1000));
}

// XP still on the table this week — what the player would gain by finishing
// everything unclaimed, including tasks already at full progress.
export function unclaimedXp(quests: WeeklyQuest[]): number {
  return quests
    .filter((q) => !q.claimed_at)
    .reduce((sum, q) => sum + q.reward_xp, 0);
}
