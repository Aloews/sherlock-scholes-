// Мини-игра «Кто известнее» — две карточки, угадать более известную по fame.
//
// Ответ приходит вместе с раундом (whos_more_famous.sql): игра одиночная, XP
// не начисляет, поэтому лишний круг к серверу на каждый ответ не окупается.

import { supabase } from '@/shared/lib/supabase';

export interface FamousOption {
  id: string;
  name: string;
  photo_url: string | null;
}

export interface FamousRound {
  answer_id: string;
  options: FamousOption[];
}

export async function fetchFamousRound(lang: string): Promise<FamousRound | null> {
  const { data, error } = await supabase.rpc('whos_more_famous_round', { p_lang: lang });
  if (error) {
    console.error('[famous] whos_more_famous_round failed:', error.code, error.message);
    return null;
  }
  const rows = (data as FamousRound[]) ?? [];
  return rows[0] ?? null;
}
