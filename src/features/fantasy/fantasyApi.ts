// Фэнтези-лига — клиентские обёртки.
//
// Путь A из docs/FANTASY_AND_MINIGAMES.md: карточка зарабатывает за результат
// своего клуба в матчах тура. Схема и обоснование — supabase/migrations/fantasy.sql.
//
// Все записи выводят игрока из подписанного initData; таблиц игрокам не видно
// вовсе, единственный вход — эти функции.

import { supabase } from '@/shared/lib/supabase';

export interface FantasyRound {
  id: number;
  starts_at: string;
  ends_at: string;
  settled_at: string | null;
}

export interface FantasyOption {
  card_id: string;
  name: string;
  name_en: string | null;
  club: string;
  /** Сколько матчей у клуба в этом туре. Два матча — вдвое больше шансов. */
  match_count: number;
}

export interface SquadMember {
  card_id: string;
  name: string;
  club: string | null;
  is_captain: boolean;
  /** Уже с учётом капитанского удвоения — удваивает сервер при чтении. */
  points: number;
}

export interface StandingRow {
  league_id: number;
  league_name: string;
  player_id: number;
  first_name: string;
  last_name: string | null;
  avatar_url: string | null;
  points: number;
  picked: number;
}

/** Размер состава. Держится на сервере; здесь только для разметки. */
export const SQUAD_SIZE = 5;

/**
 * Тур, на который ещё можно заявиться — обычно следующая неделя.
 *
 * Отдельно от «недели, в которой мы сейчас»: тур закрывается первым свистком,
 * поэтому текущий почти всегда уже закрыт. См. шапку fantasy.sql.
 */
export async function fetchOpenRound(): Promise<FantasyRound | null> {
  const { data, error } = await supabase.rpc('open_fantasy_round');
  if (error) {
    console.error('[fantasy] open_fantasy_round failed:', error.code, error.message);
    return null;
  }
  return (data as FantasyRound) ?? null;
}

export async function fetchCurrentRound(): Promise<FantasyRound | null> {
  const { data, error } = await supabase.rpc('current_fantasy_round');
  if (error) {
    console.error('[fantasy] current_fantasy_round failed:', error.code, error.message);
    return null;
  }
  return (data as FantasyRound) ?? null;
}

/** Когда закрывается приём. null — расписание до этой недели ещё не дошло. */
export async function fetchLocksAt(roundId: number): Promise<string | null> {
  const { data, error } = await supabase.rpc('fantasy_locks_at', { p_round_id: roundId });
  if (error) {
    console.error('[fantasy] fantasy_locks_at failed:', error.code, error.message);
    return null;
  }
  return (data as string | null) ?? null;
}

export async function fetchOptions(roundId: number): Promise<FantasyOption[]> {
  const { data, error } = await supabase.rpc('fantasy_options', { p_round_id: roundId });
  if (error) {
    console.error('[fantasy] fantasy_options failed:', error.code, error.message);
    return [];
  }
  return (data as FantasyOption[]) ?? [];
}

export async function fetchMySquad(initData: string, roundId: number): Promise<SquadMember[]> {
  if (!initData) return [];
  const { data, error } = await supabase.rpc('my_fantasy_squad', {
    p_init_data: initData,
    p_round_id: roundId,
  });
  if (error) {
    console.error('[fantasy] my_fantasy_squad failed:', error.code, error.message);
    return [];
  }
  return (data as SquadMember[]) ?? [];
}

/**
 * Заявить состав.
 *
 * False — обычный ответ: тур закрыт, состав не из пяти различных карточек,
 * капитан вне состава, карточка не играет в этом туре. Показывать отказ, а не
 * галочку.
 */
export async function setSquad(
  initData: string,
  roundId: number,
  cardIds: string[],
  captainId: string,
): Promise<boolean> {
  if (!initData) return false;
  const { data, error } = await supabase.rpc('set_fantasy_squad', {
    p_init_data: initData,
    p_round_id: roundId,
    p_card_ids: cardIds,
    p_captain: captainId,
  });
  if (error) {
    console.error('[fantasy] set_fantasy_squad failed:', error.code, error.message);
    return false;
  }
  return data === true;
}

export async function fetchStandings(initData: string, roundId: number): Promise<StandingRow[]> {
  if (!initData) return [];
  const { data, error } = await supabase.rpc('fantasy_standings', {
    p_init_data: initData,
    p_round_id: roundId,
  });
  if (error) {
    console.error('[fantasy] fantasy_standings failed:', error.code, error.message);
    return [];
  }
  return (data as StandingRow[]) ?? [];
}

export async function createLeague(
  initData: string,
  name: string,
): Promise<{ id: number; join_code: string } | null> {
  if (!initData) return null;
  const { data, error } = await supabase.rpc('create_fantasy_league', {
    p_init_data: initData,
    p_name: name,
  });
  if (error) {
    console.error('[fantasy] create_fantasy_league failed:', error.code, error.message);
    return null;
  }
  const rows = (data as { id: number; join_code: string }[]) ?? [];
  return rows[0] ?? null;
}

/** Возвращает id лиги, или null когда такого кода нет. */
export async function joinLeague(initData: string, code: string): Promise<number | null> {
  if (!initData) return null;
  const { data, error } = await supabase.rpc('join_fantasy_league', {
    p_init_data: initData,
    p_code: code,
  });
  if (error) {
    console.error('[fantasy] join_fantasy_league failed:', error.code, error.message);
    return null;
  }
  return typeof data === 'number' ? data : null;
}
