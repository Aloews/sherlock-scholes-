/**
 * Сколько осталось до матча — словами, которые можно показать.
 *
 * Владелец: «сделай так чтобы за полчаса анонсировали трансляцию матча».
 *
 * ⚠️ ТРИ РЕЖИМА, А НЕ ОДИН ФОРМАТ ВРЕМЕНИ. «Через 25 минут» — это призыв
 * включить; «через 15 часов» — это «сегодня вечером»; «12 марта» — это запись
 * в календарь. Одна и та же строка на все три случая либо торопит там, где
 * спешить некуда, либо опаздывает там, где надо спешить.
 *
 * ⚠️ МИНУТЫ ПРИХОДЯТ ИЗ БАЗЫ (`top_fixtures.minutes_to_start`), А НЕ СЧИТАЮТСЯ
 * ЗДЕСЬ. Часы телефона врут молча: на устройстве с уехавшим временем «через
 * полчаса» превратилось бы в «через два часа», и никто бы этого не заметил.
 *
 * ⚠️ ОТРИЦАТЕЛЬНОЕ — ЭТО «УЖЕ ИДЁТ», А НЕ «ЧЕРЕЗ МИНУС ПЯТЬ МИНУТ». Между
 * запросом и отрисовкой проходит время, и матч успевает начаться.
 */
export type Countdown =
  | { kind: 'live' }                    // уже начался
  | { kind: 'alert'; minutes: number }  // вот-вот: анонс трансляции
  | { kind: 'hours'; hours: number }    // сегодня-завтра
  | { kind: 'date' };                   // дальше — показывать дату

/** Порог анонса трансляции в минутах. Тот же, что у `p_alert_minutes` в SQL. */
export const ALERT_MINUTES = 30;

/** Дальше этого часами не меряют — читается уже как дата. */
const HOURS_LIMIT = 24;

export function fixtureCountdown(
  minutes: number | null | undefined,
  alertMinutes = ALERT_MINUTES,
): Countdown {
  if (minutes == null || !Number.isFinite(minutes)) return { kind: 'date' };
  if (minutes <= 0) return { kind: 'live' };
  if (minutes <= alertMinutes) return { kind: 'alert', minutes: Math.max(1, Math.round(minutes)) };
  const hours = minutes / 60;
  if (hours < HOURS_LIMIT) return { kind: 'hours', hours: Math.max(1, Math.round(hours)) };
  return { kind: 'date' };
}
