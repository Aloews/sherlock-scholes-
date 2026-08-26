import { supabase } from '@/shared/lib/supabase';
import { ok, fromPostgrest, type LoadState } from '@/shared/lib/loadState';

/**
 * Фан-клубы: болельщики одного клуба находят друг друга.
 *
 * Присутствие отвечает, КТО сейчас в приложении; фан-клуб — кто из них СВОИ.
 * Поэтому `online` приходит прямо в списке: «наших онлайн трое» и есть повод
 * позвать смотреть матч вместе.
 */
export interface FanClub {
  club_key: string;
  club: string;
  members: number;
  i_am_in: boolean;
  /** Сколько участников клуба сейчас в приложении. */
  online: number;
}

/** Настоящий клуб, к которому можно присоединиться. */
export interface JoinableClub {
  club_key: string;
  club: string;
  /** Есть ли у клуба матч в ближайшем расписании — такие смотрят вместе. */
  has_fixture: boolean;
  cards: number;
}

export async function fetchFanClubs(initData: string): Promise<LoadState<FanClub[]>> {
  if (!initData) return ok([]);
  const res = await supabase.rpc('fan_clubs', { p_init_data: initData });
  return fromPostgrest<FanClub[]>(res, 'fan_clubs');
}

/**
 * ⚠️ КЛУБ ВЫБИРАЕТСЯ ИЗ СПРАВОЧНИКА, А НЕ ВВОДИТСЯ РУКАМИ, и это не вкусовщина.
 * Проверено на боевой базе: `club_match_key` вырезает всё, кроме [a-z0-9],
 * поэтому «Зенит» даёт NULL и вступить по русскому написанию нельзя вовсе —
 * сервер отвечает «unknown club». Свободный ввод к тому же завёл бы «клуб
 * имени меня»: сервер сверяет ключ со справочником и такой отобьёт.
 */
export async function fetchJoinableClubs(
  initData: string,
  query = '',
): Promise<LoadState<JoinableClub[]>> {
  if (!initData) return ok([]);
  const res = await supabase.rpc('joinable_clubs', {
    p_init_data: initData,
    p_query: query || null,
  });
  return fromPostgrest<JoinableClub[]>(res, 'joinable_clubs');
}

/**
 * Вступить. Первый вступивший клуб и заводит — отдельного «создать» нет
 * намеренно: девять фан-клубов «Реала» по три человека не дали бы найти своих,
 * ради чего клуб и нужен.
 *
 * false — настоящий ответ, а не только ошибка: сервер отказывает на неизвестном
 * клубе (`22023`). Экран обязан сказать об этом, а не показать галочку.
 */
export async function joinFanClub(initData: string, club: string): Promise<boolean> {
  if (!initData) return false;
  const { error } = await supabase.rpc('join_fan_club', {
    p_init_data: initData,
    p_club: club,
  });
  if (error) {
    console.error('[fanclubs] join_fan_club failed:', error.code, error.message);
    return false;
  }
  return true;
}

export async function leaveFanClub(initData: string, club: string): Promise<boolean> {
  if (!initData) return false;
  const { error } = await supabase.rpc('leave_fan_club', {
    p_init_data: initData,
    p_club: club,
  });
  if (error) {
    console.error('[fanclubs] leave_fan_club failed:', error.code, error.message);
    return false;
  }
  return true;
}
