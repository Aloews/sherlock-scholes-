// Мини-игра «Чей состав» — 5 игроков одного клуба, угадать клуб.
//
// Ответ приходит вместе с раундом (whose_squad.sql): игра одиночная, XP не
// начисляет, поэтому лишний круг к серверу на каждый ответ не окупается.

import { supabase } from '@/shared/lib/supabase';

export interface SquadOption {
  key: string;
  name: string;
}

export interface SquadRound {
  answer_key: string;
  players: string[];
  options: SquadOption[];
  /** Состав не живой — клуб, который игрок не покидал на момент последнего
   *  чтения его статьи (current_squads.sql). Экран обязан показать эту
   *  дату, а не намекнуть на актуальность. */
  fetched_at: string;
}

export async function fetchSquadRound(lang: string): Promise<SquadRound | null> {
  const { data, error } = await supabase.rpc('whose_squad_round', { p_lang: lang });
  if (error) {
    console.error('[squad] whose_squad_round failed:', error.code, error.message);
    return null;
  }
  const rows = (data as SquadRound[]) ?? [];
  return rows[0] ?? null;
}
