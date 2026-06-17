// Pro status — client wrappers.
//
// Security: get_user_status validates the raw Telegram initData signature
// SERVER-SIDE (HMAC vs the bot token in Vault) and reads is_pro from the
// `users` table. We send the opaque initData string and trust only the DB's
// answer. See supabase/migrations/pro_users.sql.

import { supabase } from '@/shared/lib/supabase';

export interface UserStatus {
  telegram_id: number;
  is_pro: boolean;
  pro_since: string | null;
  games_played: number;
}

/** Validate the current Telegram user and fetch Pro status. Returns null when
 * initData is missing/invalid (outside Telegram, dev) — caller treats that as
 * "not Pro" rather than crashing. */
export async function getUserStatus(initData: string): Promise<UserStatus | null> {
  const { data, error } = await supabase.rpc('get_user_status', { p_init_data: initData });
  if (error) {
    console.error('[pro] get_user_status failed:', error.code, error.message);
    return null;
  }
  return (data as UserStatus) ?? null;
}

/** Request a Telegram Stars invoice link for Pro from the tg-pay Edge Function.
 * We pass the signed initData; the function validates it server-side and
 * returns a one-time invoice link to hand to Telegram.WebApp.openInvoice.
 * Returns null on any failure (outside Telegram, invalid initData, API error). */
export async function createProInvoice(initData: string): Promise<string | null> {
  if (!initData) return null;
  const { data, error } = await supabase.functions.invoke('tg-pay', {
    body: { action: 'create_invoice', initData },
  });
  if (error) {
    console.error('[pro] createProInvoice failed:', error.message);
    return null;
  }
  const link = (data as { link?: string } | null)?.link;
  return typeof link === 'string' ? link : null;
}

/** Increment the server games_played counter (logged-in users). Returns the new
 * count, or null when initData is missing/invalid (anonymous → counted via
 * CloudStorage instead). Best-effort: a failure never blocks starting a game. */
export async function bumpGames(initData: string): Promise<number | null> {
  if (!initData) return null;
  const { data, error } = await supabase.rpc('bump_games', { p_init_data: initData });
  if (error) {
    console.error('[onboarding] bump_games failed:', error.code, error.message);
    return null;
  }
  return typeof data === 'number' ? data : null;
}
