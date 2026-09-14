import { supabase } from '@/shared/lib/supabase';
import { fromPostgrest, type LoadState } from '@/shared/lib/loadState';
import { getRawInitData } from '@/shared/lib/telegram';

/**
 * Любительские лиги: своя лига, своя команда, ты сам как игрок.
 *
 * Владелец: «возможность добавлять любительские лиги и себя, как игрока в них,
 * загружать лого команды и лиги».
 *
 * ⚠️ ПОДПИСЬ TELEGRAM ИДЁТ ПАРАМЕТРОМ, А НЕ ЗАГОЛОВКОМ, И ЭТО НЕ ПРОТИВОРЕЧИЕ
 * С ВОРОТАМИ PRO. Заголовок отвечает на вопрос «пускать ли на экран»; здесь
 * вопрос другой — «ЧЬЮ лигу заводим». Сервер берёт telegram_id из этой
 * подписи, а не из параметра, и записать кого-то, кроме себя, нельзя вовсе.
 *
 * ⚠️ ЭТО ЕДИНСТВЕННЫЙ РАЗДЕЛ, КУДА ПИШУТ ПОЛЬЗОВАТЕЛИ. Всё прочее в
 * приложении собрано нами и доступно только на чтение. Пределы (двадцать лиг
 * на человека, шестьдесят четыре команды в лиге, сорок игроков в команде)
 * живут В БАЗЕ: экран можно обойти.
 */

export interface AmateurLeague {
  id: string;
  name: string;
  city: string | null;
  logo_url: string | null;
  /** Код приглашения. null у того, кто не заводил лигу, — он ему не нужен. */
  join_code: string | null;
  teams: number;
  players: number;
  is_owner: boolean;
}

export interface AmateurRow {
  team_id: string;
  team_name: string;
  team_logo: string | null;
  team_owner: boolean;
  player_id: string | null;
  player_name: string | null;
  player_position: string | null;
  shirt_no: number | null;
  is_me: boolean;
}

export const POSITIONS = ['goalkeeper', 'defender', 'midfield', 'attack'] as const;
export type AmateurPosition = (typeof POSITIONS)[number];

export async function fetchMyLeagues(): Promise<LoadState<AmateurLeague[]>> {
  const res = await supabase.rpc('amateur_my_leagues', { p_init_data: getRawInitData() });
  return fromPostgrest<AmateurLeague[]>(res, 'amateur_my_leagues');
}

export async function fetchLeagueView(leagueId: string): Promise<LoadState<AmateurRow[]>> {
  const res = await supabase.rpc('amateur_league_view', {
    p_init_data: getRawInitData(), p_league_id: leagueId,
  });
  return fromPostgrest<AmateurRow[]>(res, 'amateur_league_view');
}

export async function createLeague(name: string, city: string) {
  const res = await supabase.rpc('amateur_create_league', {
    p_init_data: getRawInitData(), p_name: name, p_city: city || null,
  });
  return fromPostgrest<{ id: string; join_code: string }[]>(res, 'amateur_create_league');
}

export async function createTeam(leagueId: string, name: string) {
  const res = await supabase.rpc('amateur_create_team', {
    p_init_data: getRawInitData(), p_league_id: leagueId, p_name: name,
  });
  return fromPostgrest<{ id: string }[]>(res, 'amateur_create_team');
}

export async function joinTeam(
  teamId: string, displayName: string,
  position: AmateurPosition | null, shirtNo: number | null,
) {
  const res = await supabase.rpc('amateur_join_team', {
    p_init_data: getRawInitData(), p_team_id: teamId,
    p_display_name: displayName, p_position: position, p_shirt_no: shirtNo,
  });
  return fromPostgrest<{ id: string }[]>(res, 'amateur_join_team');
}

export async function leaveTeam(teamId: string) {
  const res = await supabase.rpc('amateur_leave_team', {
    p_init_data: getRawInitData(), p_team_id: teamId,
  });
  return fromPostgrest<number>(res, 'amateur_leave_team');
}

export async function findLeagueByCode(code: string) {
  const res = await supabase.rpc('amateur_league_by_code', {
    p_init_data: getRawInitData(), p_code: code,
  });
  return fromPostgrest<{ id: string; name: string }[]>(res, 'amateur_league_by_code');
}

/** Предел размера. Тот же, что в Edge-функции и в корзине — все три считают
 *  в байтах, и расходиться им незачем. */
export const MAX_LOGO_BYTES = 256 * 1024;

/**
 * Логотип уходит В EDGE-ФУНКЦИЮ, А НЕ ПРЯМО В КОРЗИНУ.
 *
 * ⚠️ У ИГРОКА НЕТ СВОЕГО ТОКЕНА. Он аноним с ключом, лежащим в каждом
 * браузере; грант на запись в корзину отдал бы её всему миру. Функция
 * проверяет подпись, проверяет владение (правило живёт в SQL) и смотрит на
 * ПЕРВЫЕ БАЙТЫ файла — клиентский `type` тут ничего не решает.
 */
export async function uploadLogo(
  kind: 'league' | 'team', id: string, file: File,
): Promise<string | null> {
  if (file.size > MAX_LOGO_BYTES) return null;
  const data = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(file);
  });
  const { data: out, error } = await supabase.functions.invoke('amateur-logo', {
    body: { initData: getRawInitData(), kind, id, data },
  });
  if (error) {
    console.error('[amateur-logo]', error.message);
    return null;
  }
  const url = (out as { url?: string } | null)?.url;
  return typeof url === 'string' ? url : null;
}
