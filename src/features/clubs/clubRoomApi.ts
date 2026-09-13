import { supabase } from '@/shared/lib/supabase';
import { ok, fromPostgrest, type LoadState } from '@/shared/lib/loadState';

/**
 * Комната болельщиков: разговор рядом с составом и новостями клуба.
 *
 * Владелец: «добавь комнату болельщиков для команд, где можно было изучить
 * состав команды, новости и обсудить их». Первые две трети уже были на экране
 * клуба; здесь третья.
 *
 * ⚠️ ЧИТАТЬ ТОЖЕ ПО initData. В строках стоят имена и аватары живых людей;
 * `club_news` открыт анониму законно — там чужие заголовки из RSS, — а это
 * наши игроки, и анонимный ключ зашит в бандл.
 */
export interface ClubPost {
  id: number;
  body: string;
  /** Новость, о которой речь, или null — просто реплика. */
  news_url: string | null;
  news_title: string | null;
  created_at: string;
  author_id: number;
  /** Имя или null: у части игроков в Telegram нет ни имени, ни фамилии. */
  author: string | null;
  avatar_url: string | null;
  /** Своё сообщение — его и только его можно убрать. */
  mine: boolean;
}

/**
 * Почему сервер отказал. Это НЕ коды Postgres наружу: экрану нужно сказать
 * разное — «подождите секунду» и «слишком длинно» лечатся по-разному.
 */
export type PostError = 'too_fast' | 'too_long' | 'unknown_club' | 'failed';

export async function fetchClubRoom(
  initData: string,
  club: string,
  limit = 50,
): Promise<LoadState<ClubPost[]>> {
  if (!initData) return ok([]);
  const res = await supabase.rpc('club_room_posts', {
    p_init_data: initData,
    p_club: club,
    p_limit: limit,
  });
  return fromPostgrest<ClubPost[]>(res, 'club_room_posts');
}

/**
 * Сказать. Возвращает null при успехе и причину отказа иначе.
 *
 * ⚠️ ПРИЧИНА РАЗБИРАЕТСЯ ПО КОДУ POSTGRES, А НЕ ПО ТЕКСТУ ОШИБКИ. Текст
 * приходит с сервера на английском и меняется при правке функции; код —
 * часть договора: 53400 — «слишком часто», 22023 — «не то прислали».
 */
export async function postClubMessage(
  initData: string,
  club: string,
  body: string,
  news?: { url: string; title: string } | null,
): Promise<PostError | null> {
  if (!initData) return 'failed';
  const { error } = await supabase.rpc('post_club_message', {
    p_init_data: initData,
    p_club: club,
    p_body: body,
    p_news_url: news?.url ?? null,
    p_news_title: news?.title ?? null,
  });
  if (!error) return null;
  console.error('[club-room] post failed:', error.code, error.message);
  if (error.code === '53400') return 'too_fast';
  if (error.code === '22023') return body.trim().length > 500 ? 'too_long' : 'unknown_club';
  return 'failed';
}

/** Убрать своё. `false` — не удалилось (чужое или уже нет). */
export async function deleteClubMessage(initData: string, id: number): Promise<boolean> {
  if (!initData) return false;
  const { data, error } = await supabase.rpc('delete_club_message', {
    p_init_data: initData,
    p_id: id,
  });
  if (error) {
    console.error('[club-room] delete failed:', error.code, error.message);
    return false;
  }
  return data === true;
}
