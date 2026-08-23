/**
 * Страна читателя — только ОБЪЯВЛЕННАЯ, никогда не выведенная.
 *
 * ⚠️ ЯЗЫК — НЕ СТРАНА, и это здесь главное. Испанский это Испания, Мексика и
 * Аргентина; английский — Британия, США и Австралия; португальский —
 * Португалия и Бразилия. Вывести страну из языка значит для половины
 * читателей назвать чужого вещателя, а экран при этом будет выглядеть
 * уверенным. Ровно эта поломка описана в шапке `broadcasts.sql`.
 *
 * Региональный субтег — другое дело: `ru-RU`, `en-GB`, `pt-BR` объявляет
 * платформа, а не мы. Если его нет, страны у нас нет, и это честный ответ.
 *
 * ⚠️ `maximize()` ЗДЕСЬ ЗАПРЕЩЁН НАМЕРЕННО. `new Intl.Locale('en').maximize()`
 * отвечает `en-Latn-US` — то есть Intl с удовольствием ДОГАДАЕТСЯ за нас, и
 * догадка будет выглядеть как факт. Берём только то, что записано.
 */

/** Регион из одного тега локали. `null`, если тег региона не объявляет. */
export function regionOf(tag: string | null | undefined): string | null {
  if (!tag) return null;
  // Разбор строкой, а не через Intl.Locale: тот на мусорном теге бросает
  // RangeError, и один кривой тег из настроек уронил бы экран расписания.
  const parts = tag.split(/[-_]/);
  for (const p of parts.slice(1)) {
    // Регион — это две буквы (ISO 3166-1) или три цифры (UN M49). Трёхзначные
    // коды («419» — Латинская Америка) страной не являются: это регион, и
    // сопоставлять его с колонкой country нечем.
    if (/^[A-Za-z]{2}$/.test(p)) return p.toUpperCase();
  }
  return null;
}

/**
 * Страна читателя из языка приложения, а если тот её не объявляет — из
 * системных языков.
 *
 * ПОРЯДОК ИМЕННО ТАКОЙ. Язык приложения выбирает человек, и если он выбрал
 * `pt-BR`, это его заявление о себе. Системный список — запасной: он говорит
 * о машине, а не о выборе, но всё же объявлен, а не выведен.
 */
export function viewerCountry(
  appLanguage: string | null | undefined,
  systemLanguages: readonly string[] = [],
): string | null {
  const fromApp = regionOf(appLanguage);
  if (fromApp) return fromApp;
  for (const tag of systemLanguages) {
    const r = regionOf(tag);
    if (r) return r;
  }
  return null;
}

/** Системные языки браузера — обёртка, чтобы тесты не трогали navigator. */
export function systemLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages?.length ? navigator.languages : [navigator.language].filter(Boolean);
}
