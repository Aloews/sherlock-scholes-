import { supabase } from '@/shared/lib/supabase';

/**
 * Клубы матча: эмблема, название на языке читателя, стоимость и состав.
 *
 * Владелец: «нужно экран „ближайших матчей“ доделать до уровня, того
 * отображения, что на главной. Но оставить составы и стоимость считать у двух
 * клубов».
 *
 * ⚠️ ЭТО НЕ ПОВТОРЕНИЕ `top_fixtures`, А ЕГО ЖЕ ДАННЫЕ ДЛЯ ДРУГОГО ЭКРАНА.
 * `fixtures` хранит имена команд строками провайдера расписания и о наших
 * клубах не знает ничего — ни эмблемы, ни перевода. Мост от строки к
 * `club_key` один на весь проект, `resolve_club_key` в SQL; второй копии
 * правила здесь нет намеренно, иначе «Зенит» на главной и «Зенит» в списке
 * матчей однажды разойдутся.
 *
 * ⚠️ СУММЫ ДВУХ КЛУБОВ НЕ СКЛАДЫВАЮТСЯ. На главной матчи упорядочены по
 * сумме составов, и там она уместна как одно число. Здесь владелец просил
 * оставить стоимость и состав У ДВУХ КЛУБОВ — то есть порознь, потому что
 * матч читают, сравнивая стороны, а не оценивая его величину.
 */
export interface FixtureClubs {
  fixture_id: string;
  home_key: string | null;
  home_name: string | null;
  home_crest: string | null;
  /** Сумма стоимости тех игроков клуба, у кого она есть. */
  home_value: number | null;
  /** Сколько игроков клуба у нас оцифровано ВСЕГО — не только с ценой. */
  home_squad: number;
  away_key: string | null;
  away_name: string | null;
  away_crest: string | null;
  away_value: number | null;
  away_squad: number;
  /** Минуты до начала. Считает БАЗА: часы телефона врут молча. */
  minutes_to_start: number | null;
}

/**
 * ⚠️ ОТКАЗ ВОЗВРАЩАЕТ ПУСТУЮ КАРТУ, А НЕ БРОСАЕТ. Эмблемы и стоимости —
 * добавка к строке матча: без них экран показывает то же, что показывал
 * раньше. Ронять из-за добавки список матчей нельзя.
 *
 * Пустой список id — сразу пустая карта, без запроса: PostgREST на пустом
 * массиве отработает, но платить за это круговым походом незачем.
 */
export async function fetchFixtureClubs(
  ids: string[],
  lang: string,
): Promise<Map<string, FixtureClubs>> {
  const map = new Map<string, FixtureClubs>();
  if (ids.length === 0) return map;
  const { data, error } = await supabase.rpc('fixture_clubs', {
    p_ids: ids,
    p_lang: lang.slice(0, 2),
  });
  if (error) {
    console.error('[fixture_clubs]', error.code ?? '', error.message);
    return map;
  }
  for (const row of (data as FixtureClubs[]) ?? []) map.set(row.fixture_id, row);
  return map;
}
