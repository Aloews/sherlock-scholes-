// Месячная сетка расписания — чистая часть, без React и без сети.
//
// ГЛАВНОЕ РЕШЕНИЕ ЗДЕСЬ ОДНО: пустая клетка бывает двух РАЗНЫХ видов, и
// показывать их одинаково — врать.
//
//   • «В этот день матчей нет» — правда: бывают вторники без футбола.
//   • «Про этот день мы ничего не знаем» — тоже правда, но совсем другая:
//     провайдер публикует расписание примерно на три недели вперёд, и весь
//     следующий месяц у него ещё не расписан.
//
// Сетка на сентябрь, нарисованная без этого различия, выглядит как «в сентябре
// футбола нет». Это не мелочь оформления: игрок делает из неё вывод и не
// возвращается. Поэтому клетка знает про `known`, а горизонт приходит из
// самой таблицы, а не из предположения о том, насколько далеко смотрит
// провайдер.

/** Календарная дата в местном времени зрителя, `YYYY-MM-DD`. */
export function localDayKey(date: Date): string {
  // ⚠️ НЕ `toISOString().slice(0, 10)`. Тот вернул бы день по UTC, и матч в
  // 22:00 по Мадриду уехал бы на следующий день, а матч в 01:00 по Токио — на
  // предыдущий. «Какой это день» зависит от того, где стоит зритель.
  return (
    `${date.getFullYear()}-` +
    `${String(date.getMonth() + 1).padStart(2, '0')}-` +
    `${String(date.getDate()).padStart(2, '0')}`
  );
}

/**
 * Первый день недели для локали, в нумерации `Date.getDay()` (0 — воскресенье).
 *
 * ⚠️ ЭТО НЕ ОДИНАКОВО У НАШИХ ДЕВЯТИ ЯЗЫКОВ, и «везде с понедельника» — это
 * европейская привычка, а не правило: у `en` неделя начинается с воскресенья,
 * у `ar` — с субботы. Сетка, начатая не с того дня, не выглядит сломанной —
 * она выглядит правильной и показывает неверные дни недели.
 *
 * ⚠️ СПРАШИВАТЬ НАДО ДВУМЯ СПОСОБАМИ. Свойство успело побывать и методом
 * `getWeekInfo()`, и аксессором `weekInfo`, и в живых движках встречаются оба:
 * Node этой сборки знает только второй. Проверка одного из них выглядит
 * работающей ровно там, где её писали, а у половины читателей молча
 * скатывается в запасной вариант — то есть календарь показывает чужую неделю
 * и при этом не выглядит сломанным.
 *
 * Считается по ISO (1 — понедельник, 7 — воскресенье), поэтому 7 → 0.
 */
type WeekInfoCarrier = Intl.Locale & {
  getWeekInfo?: () => { firstDay?: number };
  weekInfo?: { firstDay?: number };
};

export function firstDayOfWeek(locale: string): number {
  try {
    const carrier = new Intl.Locale(locale) as WeekInfoCarrier;
    const info = carrier.getWeekInfo?.() ?? carrier.weekInfo;
    if (info && typeof info.firstDay === 'number') return info.firstDay % 7;
  } catch {
    // Незнакомая метка локали — не повод остаться без календаря.
  }
  // Запасной вариант — понедельник: на нём стоят русский, испанский и
  // французский, то есть большая часть читателей этого приложения.
  return 1;
}

/**
 * Сдвинуть месяц на `delta` месяцев.
 *
 * ⚠️ ЯКОРЬ — ПЕРВОЕ ЧИСЛО, И ЭТО ОБЯЗАТЕЛЬНО. `new Date(y, m + 1, d)` с
 * сохранённым числом переполняется: 31 января плюс месяц даёт 3 марта, потому
 * что февраля 31-го не бывает. Листание календаря вперёд молча перепрыгнуло
 * бы через февраль.
 */
export function shiftMonth(month: Date, delta: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + delta, 1);
}

/** Первое число месяца, в котором лежит дата. */
export function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export interface DayCell {
  /** `YYYY-MM-DD` в местном времени. */
  key: string;
  date: Date;
  /** День этого месяца, а не хвост соседнего, которым добита неделя. */
  inMonth: boolean;
  matches: number;
  /**
   * Есть ли у нас вообще сведения об этом дне.
   *
   * false — «не знаем», а не «пусто». Разница видна на экране, и она
   * существенная: см. заголовок файла.
   */
  known: boolean;
}

export interface Horizon {
  /** Самый ранний матч в таблице, ISO. null — таблица пуста. */
  first: string | null;
  /**
   * Докуда расписание СПЛОШНОЕ — последний день перед разрывом длиннее недели.
   *
   * ⚠️ ЭТО НЕ «САМЫЙ ДАЛЁКИЙ МАТЧ», и путать их дорого. В таблице сейчас
   * сплошное покрытие по 30 августа и один матч 24 сентября: какой-то турнир
   * объявил дату заранее. По самому далёкому матчу горизонт был бы 24
   * сентября, и двадцать пять пустых дней между ними превратились бы в
   * утверждение «матчей не будет». Считает `fixtures_horizon()`.
   */
  publishedUntil: string | null;
}

/** Сколько матчей в каждый местный день. */
export function countByDay(fixtures: { commence_at: string }[]): Map<string, number> {
  const days = new Map<string, number>();
  for (const f of fixtures) {
    const key = localDayKey(new Date(f.commence_at));
    days.set(key, (days.get(key) ?? 0) + 1);
  }
  return days;
}

/**
 * Знаем ли мы что-нибудь про этот день.
 *
 * Два способа знать, и второй важен: день, в котором есть матчи, известен ПО
 * ОПРЕДЕЛЕНИЮ, даже если он лежит далеко за горизонтом публикации. Иначе
 * одинокий матч 24 сентября рисовался бы в серой клетке «не знаем», стоя
 * прямо в ней.
 *
 * Ключи вида `YYYY-MM-DD` сравниваются как строки: лексикографический порядок
 * у них совпадает с хронологическим, и это единственный формат даты, про
 * который так можно сказать.
 */
export function isKnown(dayKey: string, horizon: Horizon, matches = 0): boolean {
  if (matches > 0) return true;
  if (!horizon.first || !horizon.publishedUntil) return false;
  const from = localDayKey(new Date(horizon.first));
  const to = localDayKey(new Date(horizon.publishedUntil));
  return dayKey >= from && dayKey <= to;
}

/**
 * Клетки месяца, разложенные по целым неделям.
 *
 * Недель бывает от четырёх до шести — это зависит от того, на какой день
 * недели попало первое число. Хвосты соседних месяцев остаются в сетке
 * (`inMonth: false`), потому что неделя без них перестаёт быть неделей и
 * столбцы разъезжаются.
 */
export function monthGrid(
  month: Date,
  locale: string,
  fixtures: { commence_at: string }[],
  horizon: Horizon,
): DayCell[] {
  const counts = countByDay(fixtures);
  const first = monthStart(month);
  const weekStart = firstDayOfWeek(locale);

  // Сколько дней отступить назад, чтобы сетка начиналась с нужного дня недели.
  const lead = (first.getDay() - weekStart + 7) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - lead);

  const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const cells = Math.ceil((lead + daysInMonth) / 7) * 7;

  const out: DayCell[] = [];
  for (let i = 0; i < cells; i++) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = localDayKey(date);
    const matches = counts.get(key) ?? 0;
    out.push({
      key,
      date,
      inMonth: date.getMonth() === first.getMonth(),
      matches,
      known: isKnown(key, horizon, matches),
    });
  }
  return out;
}

/**
 * Границы месяца как мгновения — для запроса.
 *
 * ⚠️ ГРАНИЦЫ МЕСТНЫЕ, А НЕ UTC. Август в Мадриде и август в Токио — это разные
 * отрезки времени, и запрос по UTC-границам потерял бы у одних первый матч
 * первого числа, а другим показал бы лишний матч из прошлого месяца.
 * Полуинтервал: `>= from` и `< to`, иначе матч ровно в полночь попадёт в оба
 * месяца сразу.
 */
export function monthBounds(month: Date): { from: string; to: string } {
  const from = monthStart(month);
  const to = shiftMonth(from, 1);
  return { from: from.toISOString(), to: to.toISOString() };
}
