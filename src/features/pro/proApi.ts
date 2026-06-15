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
