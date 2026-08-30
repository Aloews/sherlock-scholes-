// Команды: клиентская половина supabase/migrations/football_clubs.sql.
//
// ЧТО ЗДЕСЬ НЕ СЧИТАЕТСЯ. Ни очки, ни победы, ни разница мячей — всё это
// считает Postgres. Очки идут по той же шкале `голы*4 + пасы*3`, по которой
// платит фэнтези и по которой строится рейтинг футболистов: три места,
// считающие одно и то же, разойдутся, и разойдутся незаметно — все три числа
// будут выглядеть правдоподобно.
//
// ⚠️ ДВА РАЗНЫХ ИСТОЧНИКА ВРЕМЕНИ, И ИХ НЕЛЬЗЯ СМЕШИВАТЬ. Сыгранное приходит
// из `club_match` — свёртки статистики игроков, она знает прошлое с 2008 года.
// Предстоящее приходит из `fixtures` (the-odds-api), горизонт которого
// начинается 10.08.2026. Один список из них двоих был бы списком с дырой
// посередине, про которую нечего сказать.

import { supabase } from '@/shared/lib/supabase';
import { fromPostgrest, type LoadState } from '@/shared/lib/loadState';

/** Окно, за которое считается статистика команды. В ДНЯХ, а не «сезон». */
export const CLUB_WINDOWS = [90, 365] as const;
export type ClubWindow = (typeof CLUB_WINDOWS)[number];

export interface ClubProfile {
  club_key: string;
  name: string;
  name_en: string | null;
  card_id: string | null;
  country: string | null;
  league: string | null;
  crest_url: string | null;
  /** 'club' | 'national'. Сборные в списке команд не показываются. */
  kind: string;
  squad: number;
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  goals_for: number;
  goals_against: number;
  first_match: string | null;
  last_match: string | null;
  fetched_at: string;
}

export interface ClubSquadRow {
  card_id: string;
  name: string;
  name_en: string | null;
  photo_url: string | null;
  country: string | null;
  /** Не `position`: в RETURNS TABLE это зарезервированное слово. */
  player_position: string | null;
  shirt_number: number | null;
  /** Дата ПЕРВОГО свидетельства, а не трансфера — см. шапку club_squad. */
  joined_at: string | null;
  source: string;
  matches: number;
  /** null — минуты не знает ни один источник; ESPN их не отдаёт вовсе. */
  minutes: number | null;
  goals: number;
  assists: number;
  yellow: number;
  red: number;
  points: number;
}

export interface ClubMatchRow {
  match_date: string;
  tournament: string | null;
  home: boolean;
  opponent_key: string | null;
  opponent: string;
  goals_for: number | null;
  goals_against: number | null;
  /** 'w' | 'd' | 'l', либо null у матча без счёта. */
  outcome: string | null;
}

export interface ClubFixtureRow {
  fixture_id: string;
  commence_at: string;
  sport_key: string;
  home: boolean;
  opponent_key: string | null;
  opponent: string;
}

export interface ClubDirectoryRow {
  club_key: string;
  name: string;
  country: string | null;
  league: string | null;
  crest_url: string | null;
  squad: number;
  matches: number;
}

export async function fetchClubProfile(
  clubKey: string,
  lang: string,
  days: ClubWindow,
): Promise<LoadState<ClubProfile | null>> {
  const res = await supabase.rpc('club_profile', {
    p_club_key: clubKey, p_lang: lang, p_days: days,
  });
  const state = fromPostgrest<ClubProfile[]>(res, `club_profile(${clubKey})`);
  if (state.status !== 'ok') return state;
  return { status: 'ok', data: state.data[0] ?? null };
}

/**
 * Состав ЦЕЛИКОМ. Ограничения по числу строк нет и на клиенте: в заявке под
 * сорок человек, и обрезанный состав отвечает на вопрос «кто основной»,
 * которого никто не задавал.
 */
export async function fetchClubSquad(
  clubKey: string,
  lang: string,
  days: ClubWindow,
): Promise<LoadState<ClubSquadRow[]>> {
  const res = await supabase.rpc('club_squad_list', {
    p_club_key: clubKey, p_lang: lang, p_days: days,
  });
  return fromPostgrest<ClubSquadRow[]>(res, `club_squad_list(${clubKey})`);
}

export async function fetchClubMatches(
  clubKey: string,
  lang: string,
  limit = 20,
): Promise<LoadState<ClubMatchRow[]>> {
  const res = await supabase.rpc('club_recent_matches', {
    p_club_key: clubKey, p_lang: lang, p_limit: limit,
  });
  return fromPostgrest<ClubMatchRow[]>(res, `club_recent_matches(${clubKey})`);
}

export async function fetchClubFixtures(
  clubKey: string,
  lang: string,
  limit = 8,
): Promise<LoadState<ClubFixtureRow[]>> {
  const res = await supabase.rpc('club_upcoming_fixtures', {
    p_club_key: clubKey, p_lang: lang, p_limit: limit,
  });
  return fromPostgrest<ClubFixtureRow[]>(res, `club_upcoming_fixtures(${clubKey})`);
}

export async function fetchClubDirectory(
  lang: string,
  query: string | null,
  limit = 60,
): Promise<LoadState<ClubDirectoryRow[]>> {
  const res = await supabase.rpc('club_directory', {
    p_lang: lang, p_query: query, p_limit: limit,
  });
  return fromPostgrest<ClubDirectoryRow[]>(res, 'club_directory');
}

export interface CardClub {
  club_key: string;
  name: string;
  crest_url: string | null;
}

/** «За кого он играет» — для досье и строк рейтинга. */
export async function fetchClubOfCard(
  cardId: string,
  lang: string,
): Promise<LoadState<CardClub | null>> {
  const res = await supabase.rpc('club_of_card', { p_card_id: cardId, p_lang: lang });
  const state = fromPostgrest<CardClub[]>(res, `club_of_card(${cardId})`);
  if (state.status !== 'ok') return state;
  return { status: 'ok', data: state.data[0] ?? null };
}

export interface PlayerLevel {
  card_id: string;
  level: number;
  fame_part: number | null;
  form_part: number | null;
  matches: number;
  /** 'fame' | 'fame+form' | 'icon' — ЧЕМ построено число. Подпись обязательна:
   *  при 'fame' оно про просмотры википедии, а не про игру, и показать его без
   *  оговорки значило бы выдать известность за мастерство. */
  basis: string;
}

/** Уровень игрока. null — уровня нет: ни известности, ни матчей, ни признания.
 *  Ноль на этом месте читался бы как «слабый». */
export async function fetchPlayerLevel(
  cardId: string,
): Promise<LoadState<PlayerLevel | null>> {
  const res = await supabase
    .from('player_level')
    .select('card_id,level,fame_part,form_part,matches,basis')
    .eq('card_id', cardId)
    .maybeSingle();
  if (res.error) {
    console.error('[player_level]', res.error.code ?? '', res.error.message);
    return { status: 'error', code: res.error.code ?? 'unknown' };
  }
  return { status: 'ok', data: (res.data as PlayerLevel | null) ?? null };
}
