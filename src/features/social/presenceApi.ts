import { supabase } from '@/shared/lib/supabase';
import { ok, fromPostgrest, type LoadState } from '@/shared/lib/loadState';

/**
 * Кто сейчас в приложении.
 *
 * ЗАЧЕМ ЭТО ЗАВЕДЕНО. Приглашения в комнату существовали и работали
 * (`invite_to_room`, `pending_room_invites`), связь тоже — три провайдера с
 * failover и `VideoStage`. Не хватало ровно одного звена: звать было НЕКОГО,
 * потому что список тех, кто сейчас в приложении, никто не вёл.
 *
 * ⚠️ ЛИЧНОСТЬ — ИЗ ПОДПИСАННОЙ initData, а не из аргумента. Функция с
 * `p_player_id` позволила бы отметить онлайн кого угодно и прочитать чужое
 * присутствие. Проверено на боевом адресе: подделанная подпись отвечает
 * 403 / 28000, прямое чтение таблицы анонимом — 401 / 42501.
 */
export interface OnlinePlayer {
  player_id: number;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  seen_at: string;
  /** Друзья идут первыми: звать в первую очередь идут их. */
  is_friend: boolean;
}

/**
 * Отметиться живым.
 *
 * ⚠️ `hidden` НЕ ПЕРЕДАЁТСЯ на обычном ударе сердца — только когда человек сам
 * переключил видимость. Сервер понимает `null` как «не трогай выбор»: иначе
 * каждый удар раз в минуту молча возвращал бы спрятавшегося в список.
 *
 * Отсутствие подписи — не ошибка, а «мы не в Telegram»: отмечаться там
 * некому и незачем.
 */
export async function touchPresence(initData: string, hidden?: boolean): Promise<void> {
  if (!initData) return;
  const { error } = await supabase.rpc('touch_presence', {
    p_init_data: initData,
    p_hidden: hidden ?? null,
  });
  if (error) console.error('[presence] touch_presence failed:', error.code, error.message);
}

/**
 * Кто ещё в приложении.
 *
 * Пустой список — НАСТОЯЩИЙ ответ, а не поломка: в маленьком приложении в
 * три часа ночи онлайн честно никого. Экран обязан говорить «сейчас никого»,
 * а не «не загрузилось».
 */
export async function fetchOnlinePlayers(
  initData: string,
  limit = 40,
): Promise<LoadState<OnlinePlayer[]>> {
  if (!initData) return ok([]);
  const res = await supabase.rpc('online_players', { p_init_data: initData, p_limit: limit });
  return fromPostgrest<OnlinePlayer[]>(res, 'online_players');
}
