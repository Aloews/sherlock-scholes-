// Рейтинг футболистов — клиентская половина player_match_stats.sql.
//
// ЧТО ЗДЕСЬ СЧИТАЕТСЯ И ЧЕГО ЗДЕСЬ НЕТ. Очки — `голы*4 + пасы*3`, ровно та же
// шкала, по которой начисляет фэнтези. Считает их Postgres, а не этот файл:
// два места, считающих одно и то же, рано или поздно разойдутся, и разошлись
// бы незаметно — обе цифры выглядели бы правдоподобно.
//
// СВЕЖЕСТЬ ЗАПРАШИВАЕТСЯ ОТДЕЛЬНО И ЭТО НЕ ЛИШНИЙ ВЫЗОВ. Пустая неделя —
// настоящий ответ во время паузы на сборные, и она же — то, как выглядит
// умерший конвейер. Без даты сбора экран сказал бы «за неделю никто не
// забил» в обоих случаях, а это утверждение про футбол, а не про загрузку
// (docs/MAP.md §8а: опасна та пустота, которая ЧТО-ТО УТВЕРЖДАЕТ).
//
// Чистые функции про свежесть лежат в `freshness.ts` — иначе их нельзя было бы
// проверить тестом, не подняв всё окружение.

import { supabase } from '@/shared/lib/supabase';
import { fromPostgrest, type LoadState } from '@/shared/lib/loadState';
import type { RatingWindow } from './freshness';

export interface RatingRow {
  card_id: string;
  name: string;
  name_en: string | null;
  photo_url: string | null;
  country: string | null;
  /** Текущий клуб, если он известен. Приходит из `card_current_club`,
   *  который собирается по открытым годам в карьере, — то есть бывает
   *  устаревшим и потому подписан «на дату», а не подан как факт. */
  club: string | null;
  matches: number;
  /** null — минуты неизвестны. ESPN их не отдаёт вовсе: его subbedIn/subbedOut
   *  булевы, то есть «вышел» есть, а «когда» нет. Ноль на этом месте был бы
   *  ложью с последствиями — рейтинг ломает ничью по «меньше минут при той же
   *  отдаче». */
  minutes: number | null;
  goals: number;
  assists: number;
  points: number;
}

export interface RatingFreshness {
  /** Самый ранний матч, который у нас вообще есть. Годовое окно наполняется
   *  постепенно: страница sports.ru отдаёт ОДИН сезон, переключатель сезонов
   *  ходит в закрытый robots'ом /ajax/, поэтому первый сбор дотягивается
   *  только до начала текущего сезона. Экран обязан назвать эту дату, иначе
   *  «за год» пообещает год, которого в таблице нет. */
  first_match: string | null;
  last_match: string | null;
  collected_at: string | null;
  players: number;
  matches: number;
}

export const RATING_LIMIT = 50;

/**
 * Рейтинг за окно в днях.
 *
 * Порядок задаёт SQL (очки, потом голы, потом меньше минут) — сортировать ещё
 * раз на клиенте значит завести второе место, где решается порядок.
 */
export async function fetchRatings(
  days: RatingWindow,
  limit = RATING_LIMIT,
): Promise<LoadState<RatingRow[]>> {
  const res = await supabase.rpc('player_ratings', { p_days: days, p_limit: limit });
  return fromPostgrest<RatingRow[]>(res, `player_ratings(${days})`);
}

/** Когда конвейер последний раз что-то принёс и что у нас вообще есть. */
export async function fetchFreshness(): Promise<LoadState<RatingFreshness | null>> {
  const res = await supabase.rpc('player_stats_freshness');
  const state = fromPostgrest<RatingFreshness[]>(res, 'player_stats_freshness');
  if (state.status !== 'ok') return state;
  return { status: 'ok', data: state.data[0] ?? null };
}
