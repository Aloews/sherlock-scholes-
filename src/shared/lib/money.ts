// Деньги на экране — коротко и на языке читателя.
//
// ⚠️ ЕДИНИЦЫ НЕ ПИШУТСЯ СТРОКОЙ. «млн»/«m»/«万» — это девять разных правил, и
// список пришлось бы вести на девяти языках, а для арабского и японского он
// ещё и не сводится к суффиксу. `Intl.NumberFormat` с notation: 'compact' знает
// их сам: 40 000 000 → «40 млн €» по-русски, «€40M» по-английски, «4000万€»
// по-японски.
//
// ⚠️ ВАЛЮТА ОДНА И ОНА ЕВРО, ПОТОМУ ЧТО ИСТОЧНИК ОДИН. Стоимость приходит с
// Transfermarkt, который печатает евро; строка в фунтах в сборщике
// ОТБРАСЫВАЕТСЯ, а не пересчитывается по выдуманному курсу.

/** Стоимость в евро, компактно и на языке интерфейса. null → null. */
export function formatEur(value: number | null | undefined, lang: string): string | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  try {
    return new Intl.NumberFormat(lang, {
      style: 'currency',
      currency: 'EUR',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    // ⚠️ Незнакомый движку тег локали БРОСАЕТ RangeError, и роняет не строку,
    // а весь экран в белый лист — этот проект уже ловил такое на датах
    // (FantasyScreen, Invalid time value). Запасной путь — то же число без
    // локали, а не пустое место.
    return `€${Math.round(value / 1_000_000)}M`;
  }
}
