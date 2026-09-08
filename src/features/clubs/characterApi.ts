import { supabase } from '@/shared/lib/supabase';

/**
 * ХАРАКТЕР КОМАНДЫ — ИЗМЕРЕННЫЙ, А НЕ ПРИПИСАННЫЙ.
 *
 * Владелец: «характер тренера определяет характер команды, но характера
 * тренеров меняются со временем».
 *
 * Второе — главное. Ярлык, поставленный однажды, стареет молча: тренер сменил
 * подход, а подпись осталась. Поэтому характер здесь не хранится словами, а
 * СЧИТАЕТСЯ из сыгранных матчей в скользящем окне и пересобирается ночью —
 * значит меняется сам.
 *
 * ⚠️ ЧЕРТЫ ПРИХОДЯТ КОДАМИ, А НЕ ТЕКСТОМ. Строка на русском в базе означала бы
 * девять переводов внутри SQL; переводит экран.
 *
 * ⚠️ ЭТО ОКНО, А НЕ СРОК ТРЕНЕРА, и разница честная. Soccer Wiki не отдаёт
 * истории назначений — `club_manager_spell` копится у нас с первого сбора.
 * Пока она короткая, окно шире срока, и `manager` значит «кто ведёт команду
 * сейчас», а не «все эти матчи его».
 */
export interface ClubCharacter {
  club_key: string;
  matches: number;
  /** Забито и пропущено за матч — числа, из которых собраны перцентили. */
  gf_pm: number | null;
  ga_pm: number | null;
  goals_pm: number | null;
  /** Перцентили среди клубов с тем же порогом матчей, 0..100. */
  attack: number | null;
  defence: number | null;
  openness: number | null;
  home_edge: number | null;
  steadiness: number | null;
  /** Коды черт: attacking, defensive, complete, open, closed, home, steady, streaky. */
  traits: string[];
  window_days: number;
  from_on: string | null;
  to_on: string | null;
  manager: string | null;
}

/**
 * ⚠️ ОТКАЗ И ОТСУТСТВИЕ — ОДНО И ТО ЖЕ `null`, И ЭТО ЗДЕСЬ ВЕРНО. Характера
 * нет у клуба, сыгравшего меньше десяти матчей за окно, — таких большинство.
 * Экран в обоих случаях молчит: «характер неизвестен» и «характера нет» для
 * читателя одно и то же, а вот выдуманная строка — нет.
 */
export async function fetchClubCharacter(clubKey: string): Promise<ClubCharacter | null> {
  const { data, error } = await supabase
    .from('club_character')
    .select('club_key,matches,gf_pm,ga_pm,goals_pm,attack,defence,openness,home_edge,steadiness,traits,window_days,from_on,to_on,manager')
    .eq('club_key', clubKey)
    .maybeSingle();
  if (error) {
    console.error('[club_character]', error.code ?? '', error.message);
    return null;
  }
  return (data as ClubCharacter) ?? null;
}
