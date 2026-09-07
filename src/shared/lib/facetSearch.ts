/**
 * Поиск по спискам отбора: клубы, лиги, страны.
 *
 * Владелец: «добавь поиск во все категории большие».
 *
 * ⚠️ РАДИ ЧЕГО. В списке клубов ТРИСТА позиций, стран — 153, лиг — 59.
 * Выпадающий список на три сотни строк на телефоне пролистывается вслепую:
 * найти в нём «Аль-Хиляль» быстрее набрав, чем крутя.
 *
 * ⚠️ ПОИСК БЕЗ УЧЁТА РЕГИСТРА И ДИАКРИТИКИ. «Атлетико» и «Atlético», «Кёльн» и
 * «Koln» — человек набирает как умеет и как раскладка позволяет, а список
 * обязан находиться. `normalize('NFD')` разбирает букву с надстрочным знаком
 * на букву и знак, а `\p{Diacritic}` знак убирает.
 *
 * ⚠️ ПУСТОЙ ЗАПРОС ВОЗВРАЩАЕТ ВСЁ, а не ничего: пока человек не начал
 * набирать, список должен быть полным.
 */
export function foldForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    // ё и й — не диакритика для NFD в кириллице во всех движках одинаково,
    // поэтому приводим их явно: «Кёльн» обязан находиться по «келн».
    .replace(/ё/gi, 'е')
    .replace(/й/gi, 'и')
    .toLowerCase()
    .trim();
}

export function matchesQuery(label: string, query: string): boolean {
  const q = foldForSearch(query);
  if (!q) return true;
  return foldForSearch(label).includes(q);
}

/** Отфильтровать список по запросу, сохранив порядок. */
export function filterByQuery<T>(
  items: readonly T[],
  query: string,
  label: (item: T) => string,
): T[] {
  const q = foldForSearch(query);
  if (!q) return items.slice();
  return items.filter((it) => foldForSearch(label(it)).includes(q));
}
