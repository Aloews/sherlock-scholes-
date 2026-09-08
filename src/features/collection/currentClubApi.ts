import { supabase } from '@/shared/lib/supabase';

/**
 * ГДЕ ИГРОК ИГРАЕТ СЕЙЧАС — из собранного, а не из статьи.
 *
 * Владелец: «после игры в Элиас написано, что Гарначо в Челси, а он уже
 * перешёл».
 *
 * ⚠️ ЭТО НЕ ПРИДИРКА К ОДНОЙ КАРТОЧКЕ, А РАЗНИЦА ИСТОЧНИКОВ. В `career_stats`
 * у Гарначо записано «Manchester United 2022–2025» и «Chelsea 2025–», где
 * второй период ОТКРЫТ — то есть статья утверждает, что он там до сих пор.
 * Собранная заявка клуба и Soccer Wiki независимо говорят «Астон Вилла».
 * Статья обновляется, когда до неё дойдут руки, и у неё нет способа сказать
 * «он больше здесь не играет»: открытый период остаётся открытым навсегда.
 *
 * Поэтому экран называет текущий клуб ОТДЕЛЬНОЙ СТРОКОЙ из собранного, а
 * список карьеры оставляет списком карьеры. Молча выкинуть открытый период
 * нельзя — он часть настоящей карьеры; выдать его за «сегодня» тоже нельзя.
 */
export interface CurrentClub {
  card_id: string;
  club: string | null;
  club_key: string | null;
}

/**
 * ⚠️ ОТКАЗ ВОЗВРАЩАЕТ ПУСТУЮ КАРТУ, А НЕ БРОСАЕТ. Строка про текущий клуб —
 * добавка к разбору после игры; ронять из-за неё весь экран нельзя.
 *
 * Пустой список — сразу пустая карта, без кругового похода.
 */
export async function fetchCurrentClubs(
  ids: string[],
): Promise<Map<string, CurrentClub>> {
  const map = new Map<string, CurrentClub>();
  if (ids.length === 0) return map;
  const { data, error } = await supabase
    .from('card_current_club')
    .select('card_id,club,club_key')
    .in('card_id', ids);
  if (error) {
    console.error('[card_current_club]', error.code ?? '', error.message);
    return map;
  }
  for (const row of (data ?? []) as CurrentClub[]) map.set(row.card_id, row);
  return map;
}
