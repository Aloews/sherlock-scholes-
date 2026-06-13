// Admin card editor — client wrappers.
//
// Security: the password is verified SERVER-SIDE by SECURITY DEFINER RPCs
// (admin_verify / admin_save_card / admin_delete_card, docs/admin_card_editor.sql)
// against a secret in Supabase Vault. The anon key can only EXECUTE these
// functions; direct writes to `cards` stay blocked by RLS. A wrong password
// is rejected in Postgres, so editing the password in DevTools achieves
// nothing. Search uses the public SELECT policy (read-only).

import { supabase } from '@/shared/lib/supabase';
import type { Card, ClubMinutes } from '@/shared/types/database';

export async function adminVerify(password: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('admin_verify', { p_password: password });
  if (error) return false;
  return data === true;
}

export async function adminSearchCards(query: string): Promise<Card[]> {
  const q = query.trim();
  if (!q) return [];
  const like = `%${q.replace(/[%,]/g, ' ')}%`;
  const { data, error } = await supabase
    .from('cards')
    .select('*')
    .or(`name.ilike.${like},name_en.ilike.${like}`)
    .order('name')
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as Card[];
}

export interface CardInput {
  id?: string | null;
  name: string;
  name_en?: string | null;
  category: string;
  category_ru?: string | null;
  continent?: string | null;
  country?: string | null;
  position_ru?: string | null;
  photo_url?: string | null;
  clubs_minutes?: ClubMinutes[] | null;
  pageviews?: number | null;
  forbidden_words?: string[];
  active?: boolean;
}

export async function adminSaveCard(password: string, card: CardInput): Promise<Card> {
  const { data, error } = await supabase.rpc('admin_save_card', {
    p_password: password,
    p_card: card,
  });
  if (error) throw new Error(error.message);
  return data as Card;
}

export async function adminDeleteCard(password: string, id: string, hard = false): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_card', {
    p_password: password,
    p_id: id,
    p_hard: hard,
  });
  if (error) throw new Error(error.message);
}

/** forbidden_words from a name: full name + word tokens (>1 char), deduped —
 * mirrors the scraper's build_forbidden_words. */
export function buildForbiddenWords(name: string): string[] {
  const full = name.trim();
  if (!full) return [];
  const tokens = full.split(/[\s-]+/).filter((w) => w.length > 1);
  return Array.from(new Set([full, ...tokens]));
}
