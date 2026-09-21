/**
 * Порядок турниров на экране матчей — ЧИСТОЕ ПРАВИЛО, без сети.
 *
 * Отдельным файлом по той же причине, что `monthCalendar.ts`: правило
 * сортировки проверяется тестом, а тест, который тянет за собой клиент
 * Supabase, падает на отсутствующих переменных окружения ещё до первого
 * `expect`. Сетевая половина — `fetchLeagueValues` в `fixturesApi.ts`.
 */

export interface LeagueValue {
  sport_key: string;
  /** Медиана стоимости состава, евро. null — ни один клуб не оценён. */
  squad_value_eur: number | null;
  clubs: number;
  /** 1 — топ-5 Европы или РПЛ, идут первыми. */
  pinned: number;
}

/**
 * Сравнение двух турниров для сортировки чипов.
 *
 * Правило одно и читается сверху вниз: сперва закреплённые, потом дороже,
 * потом тот, у кого в окне больше оценённых клубов, потом по ключу — чтобы
 * порядок не дрожал между отрисовками при полном равенстве.
 *
 * ⚠️ ТУРНИР, КОТОРОГО НЕТ В ОТВЕТЕ RPC, НЕ ИСЧЕЗАЕТ, А УХОДИТ В КОНЕЦ. Такое
 * бывает: провайдер заводит ключ при старте турнира, и до первой ночной
 * сверки стоимости у него ещё нет. Спрятать чип значило бы соврать, что
 * матчей нет, — ровно та ошибка, против которой список турниров и строится
 * из самого расписания, а не из перечня.
 */
export function compareLeaguesByValue(
  a: string, b: string, values: Map<string, LeagueValue>,
): number {
  const va = values.get(a);
  const vb = values.get(b);
  const pinned = (vb?.pinned ?? 0) - (va?.pinned ?? 0);
  if (pinned !== 0) return pinned;
  const worth = (vb?.squad_value_eur ?? -1) - (va?.squad_value_eur ?? -1);
  if (worth !== 0) return worth;
  const clubs = (vb?.clubs ?? 0) - (va?.clubs ?? 0);
  if (clubs !== 0) return clubs;
  return a.localeCompare(b);
}
