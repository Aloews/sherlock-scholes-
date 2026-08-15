import { supabase } from '@/shared/lib/supabase';

/**
 * «Где смотреть» — официальная страница турнира.
 *
 * НЕ СПИСОК КАНАЛОВ И ТЕМ БОЛЕЕ НЕ СПИСОК СТРИМОВ. Права на матч принадлежат
 * одному-двум вещателям в стране и перепродаются каждый сезон; таблица «в
 * такой-то стране это показывает такой-то канал» устаревает молча, и человек
 * идёт по ссылке не туда, а приложение при этом выглядит уверенным.
 *
 * Ссылка ведёт на страницу самого турнира: её ведёт правообладатель, поэтому
 * она верна всегда и сама покажет вещателя для страны читателя.
 */
export interface Broadcast {
  sport_key: string;
  name: string;
  url: string;
}

/**
 * Все строки разом, а не по одной на матч.
 *
 * Их два десятка, а матчей на экране бывает шестьдесят. Запрос на каждую
 * строку матча — это шестьдесят запросов ради двадцати ответов, половина из
 * которых повторяется.
 */
export async function fetchBroadcasts(): Promise<Map<string, Broadcast>> {
  const { data, error } = await supabase
    .from('broadcasts')
    .select('sport_key, name, url');

  if (error) {
    // Не пустой экран, а экран без одной ссылки: расписание важнее её.
    console.error('[broadcasts] failed:', error.code, error.message);
    return new Map();
  }
  return new Map((data as Broadcast[] ?? []).map((b) => [b.sport_key, b]));
}
