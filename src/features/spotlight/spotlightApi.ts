import { supabase } from '@/shared/lib/supabase';
import { fromPostgrest, type LoadState } from '@/shared/lib/loadState';

/**
 * Громкость против игры.
 *
 * Владелец просил отделить «игроков-талантов» от «игроков-проектов» — тех,
 * кого продвигают ради стоимости. Измеримая часть этой задачи — РАЗРЫВ между
 * вниманием (стоимость, просмотры страницы) и игрой (матчи, голы, пасы),
 * посчитанный внутри одной лиги, одного возраста и одного амплуа.
 *
 * ⚠️ РАЗБОРА РОДСТВЕННЫХ И АГЕНТСКИХ СВЯЗЕЙ ПО НОВОСТЯМ ЗДЕСЬ НЕТ НАМЕРЕННО.
 * Он вытаскивал бы из газетного текста утверждения о живых людях с именем и
 * фотографией, а точность такого разбора низка по природе: совпадения фамилий
 * мы ловили в «набирают ход», и там из семнадцати строк одиннадцать были
 * однофамильцами. Ошибка здесь — это публично названный чьим-то ставленником
 * конкретный человек.
 *
 * ⚠️ РАЗРЫВ НЕ РАЗЛИЧАЕТ ПРИЧИНУ. Первым в списке «громче» вышел Родри —
 * обладатель «Золотого мяча», пропустивший год по травме. Формально он громче,
 * чем играет; по сути это сказано про травму. Экран обязан это говорить, и
 * говорит.
 */

export type SpotlightMode = 'loud' | 'quiet';

export interface SpotlightRow {
  card_id: string;
  name: string;
  name_en: string | null;
  photo_url: string | null;
  club: string | null;
  club_key: string | null;
  league: string | null;
  age: number;
  band: 'u19' | 'u23' | 'prime' | 'senior';
  player_position: string;
  /** Перцентиль внимания среди ровесников того же амплуа в той же лиге. */
  attention: number;
  /** Перцентиль игры там же. */
  output: number;
  /** Внимание минус игра. */
  gap: number;
  apps: number;
  minutes: number | null;
  goals: number;
  assists: number;
  market_value_eur: number | null;
  pageviews: number | null;
  /** Сколько ровесников того же амплуа в лиге — из скольких считан перцентиль. */
  peers: number;
}

export async function fetchSpotlight(
  mode: SpotlightMode,
  lang: string,
  limit = 20,
): Promise<LoadState<SpotlightRow[]>> {
  const res = await supabase.rpc('player_spotlight', {
    p_lang: lang.slice(0, 2),
    p_limit: limit,
    p_mode: mode,
  });
  return fromPostgrest<SpotlightRow[]>(res, 'player_spotlight');
}
