// Насколько собранным данным можно верить — чистые функции, без сети.
//
// ПОЧЕМУ ОТДЕЛЬНЫМ ФАЙЛОМ. Рядом, в ratingsApi.ts, живёт клиент Supabase, а он
// падает при импорте, если не заданы переменные окружения. Держать эти две
// функции там значило бы, что проверить их можно только подняв всё окружение —
// то есть на деле никогда. Тот же приём, что у `leagues.ts` рядом с
// `fixturesApi.ts`.

/** Окна рейтинга. Значения уезжают в SQL как число дней. */
export const RATING_WINDOWS = [7, 30, 365] as const;
export type RatingWindow = (typeof RATING_WINDOWS)[number];

/**
 * Насколько данные устарели, в сутках, или null — если даты нет.
 *
 * Считается на устройстве зрителя намеренно: вопрос «сколько дней назад»
 * задаётся про его сегодня. Часы телефона могут врать, но ошибка на день в
 * подписи безобиднее, чем подпись, которой нет вовсе.
 *
 * `null` при отсутствии даты, а НЕ ноль: ноль означал бы «собрано только
 * что» — самый успокаивающий ответ там, где не известно ничего.
 */
export function ageInDays(iso: string | null, now = new Date()): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}

/**
 * Обещает ли окно больше, чем у нас есть.
 *
 * `true`, когда самый ранний собранный матч НЕ дотягивается до начала окна:
 * «за год» при данных с июля — это не год. Так бывает не по ошибке, а по
 * устройству источника: страница sports.ru отдаёт ОДИН сезон, переключатель
 * сезонов ходит в закрытый robots'ом /ajax/, и годовое окно наполняется
 * постепенно, день за днём. Экран на этом месте называет настоящую дату
 * вместо того, чтобы промолчать.
 */
export function windowExceedsData(
  days: number,
  firstMatch: string | null,
  now = new Date(),
): boolean {
  if (!firstMatch) return false;
  const first = new Date(firstMatch).getTime();
  if (Number.isNaN(first)) return false;
  return first > now.getTime() - days * 86_400_000;
}
