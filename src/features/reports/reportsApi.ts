// Player-facing "report a card error" — anonymous INSERT via the report_card
// RPC. anon can ONLY insert (RLS blocks reads); the server rate-limits per
// device. We also keep a light client-side guard so an obviously throttled or
// duplicate tap never even hits the network.

import { supabase } from '@/shared/lib/supabase';
import { getDeviceId } from '@/shared/lib/device';

export type ReportReason = 'photo' | 'name' | 'club' | 'other';

export const REPORT_REASONS: ReportReason[] = ['photo', 'name', 'club', 'other'];

const SENT_KEY = 'ss_reported_cards'; // card ids already reported (dedupe)
const TS_KEY = 'ss_report_ts';        // recent report timestamps (rate)
const HOUR_MS = 3_600_000;
const MAX_PER_HOUR = 5;

function load(key: string): unknown[] {
  try { return JSON.parse(localStorage.getItem(key) ?? '[]'); } catch { return []; }
}

/** This device already reported this exact card (don't ask again). */
export function alreadyReported(cardId: string): boolean {
  return (load(SENT_KEY) as string[]).includes(cardId);
}

/** This device hit the hourly cap — skip the network call. */
export function reportThrottled(): boolean {
  const now = Date.now();
  return (load(TS_KEY) as number[]).filter((t) => now - t < HOUR_MS).length >= MAX_PER_HOUR;
}

export async function reportCard(
  cardId: string, reason: ReportReason, comment?: string,
): Promise<void> {
  const { error } = await supabase.rpc('report_card', {
    p_card_id: cardId,
    p_reason: reason,
    p_comment: comment?.trim() || null,
    p_device_id: getDeviceId(),
  });
  if (error) throw new Error(error.message);

  const sent = Array.from(new Set([...(load(SENT_KEY) as string[]), cardId])).slice(-300);
  localStorage.setItem(SENT_KEY, JSON.stringify(sent));
  const ts = [...(load(TS_KEY) as number[]).filter((t) => Date.now() - t < HOUR_MS), Date.now()];
  localStorage.setItem(TS_KEY, JSON.stringify(ts));
}
