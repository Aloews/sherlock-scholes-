// Мини-игра «угадай игрока по фактам».
//
// Кормится из cards.facts, которые уже собраны из Wikidata — 2293 карточки
// проходят порог угадываемости. Нового источника не потребовалось; конвейер
// (docs/cards_facts_build.py) существовал всё это время.

import { supabase } from '@/shared/lib/supabase';

/** Факты игрока. Все ключи необязательные — карточки заполнены неравномерно. */
export interface PlayerFacts {
  position?: string;
  height_cm?: number;
  birth_year?: number;
  clubs_count?: number;
  years_active?: string;
  national_team?: string;
  national_caps?: number;
  tournaments?: string[];
  titles?: string[];
}

export interface QuizOption {
  id: string;
  name: string;
}

export interface QuizRound {
  answer_id: string;
  facts: PlayerFacts;
  photo_url: string | null;
  options: QuizOption[];
}

/**
 * Один вопрос.
 *
 * Ответ приходит вместе с вопросом, и это осознанно: игра одиночная, очков в
 * профиль не даёт, а лишний круг к серверу на каждый ответ стоил бы задержки
 * ради защиты того, что защищать не от кого. Если игра когда-нибудь начнёт
 * начислять XP, проверку ответа надо унести на сервер — тогда цена появится.
 */
export async function fetchQuizRound(): Promise<QuizRound | null> {
  const { data, error } = await supabase.rpc('quiz_player_round');
  if (error) {
    console.error('[quiz] quiz_player_round failed:', error.code, error.message);
    return null;
  }
  const rows = (data as QuizRound[]) ?? [];
  return rows[0] ?? null;
}
