import { supabase } from '@/shared/lib/supabase';

/**
 * Кто показывает турнир в стране читателя.
 *
 * ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ СОСЕДНЕГО `broadcastsApi`. Тот отвечает «где узнать» —
 * ссылкой на официальную страницу турнира, и отвечает всегда. Этот отвечает
 * «кто именно», и только там, где правообладатель сам назвал вещателя И сам
 * объявил срок. Схема и обоснование — supabase/migrations/broadcast_rights.sql.
 *
 * ⚠️ ПУСТО — ЭТО ОТВЕТ «НЕ ЗАЯВЛЕН», А НЕ «НЕ ЗАГРУЗИЛОСЬ». Для России у
 * Премьер-лиги правообладателя нет вовсе, а русский здесь основной язык:
 * случай не редкий, а типовой. Экран обязан различать «строки нет» и «страны
 * мы не знаем» — за второе отвечает `viewerCountry`, и при `null` этот запрос
 * не отправляется вовсе.
 */
export interface BroadcastRight {
  sport_key: string;
  territory: string;
  broadcaster: string;
  season_from: string | null;
  season_to: string | null;
  source_url: string;
}

/**
 * Все турниры разом для ОДНОЙ страны, а не турнир за турниром.
 *
 * Страна у читателя одна, а матчей на экране бывает шестьдесят. Запрос на
 * каждую карточку — это шестьдесят запросов ради двух десятков ответов, и
 * та же арифметика, по которой рядом заведён `fetchBroadcasts`.
 */
export async function fetchBroadcastRights(
  country: string | null,
): Promise<Map<string, BroadcastRight>> {
  if (!country) return new Map();

  const { data, error } = await supabase.rpc('broadcast_rights_for', {
    p_sport_key: null,
    p_country: country,
  });

  if (error) {
    // Не пустой экран, а экран без одной строки: расписание важнее её.
    console.error('[broadcast_rights] failed:', error.code, error.message);
    return new Map();
  }

  // Первая строка на турнир: территория у страны одна, а если правообладателей
  // несколько, лига перечисляет их в одном поле («Sky Sports, TNT Sports»).
  const byTournament = new Map<string, BroadcastRight>();
  for (const row of (data as BroadcastRight[]) ?? []) {
    if (!byTournament.has(row.sport_key)) byTournament.set(row.sport_key, row);
  }
  return byTournament;
}
