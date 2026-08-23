// Один Intl.DateTimeFormat на КАЖДУЮ ФОРМУ, что показывает приложение — не
// потому что все экраны обязаны выглядеть одинаково (не обязаны: шапке
// календаря нужно имя месяца, строке матча — время начала), а потому что две
// формы уже был по разу собраны отдельно и разошлись молча: у даты в дайджесте
// не было дня недели, у той же по смыслу даты в списке матчей — был. Одна и та
// же форма — всегда одна и та же функция, а не второй `new
// Intl.DateTimeFormat` с теми же опциями через один файл.
//
// Экземпляр строится заново на каждый вызов — как и раньше на местах, решение
// «когда» кешировать (обычно `useMemo` по `i18n.language`) остаётся у
// вызывающего, здесь решается только «что значит эта форма».

/** Время: «14:05». Строка новости, время начала матча. */
export const timeFormat = (lang: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' });

/** День недели и полная дата: «понедельник, 5 августа». Шапка дня в списке матчей. */
export const weekdayDateFormat = (lang: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(lang, { weekday: 'long', day: 'numeric', month: 'long' });

/** Дата коротким месяцем: «5 авг.». Карточка дайджеста, история прогнозов. */
export const shortDateFormat = (lang: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' });

/** Дата полным месяцем, без года: «5 августа». Рейтинг, шапка ячейки календаря. */
export const longDateFormat = (lang: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long' });

/** Дата полным месяцем и годом: «5 августа 2026». «Состав по состоянию на …». */
export const longDateWithYearFormat = (lang: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' });

/** Дата с временем: «5 августа, 14:05». Дедлайн заявки состава фэнтези. */
export const dateTimeFormat = (lang: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(lang, {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });

/** Месяц и год: «Август 2026». Шапка календаря. */
export const monthYearFormat = (lang: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' });

/** Короткий день недели: «Пн». Подписи столбцов календаря. */
export const weekdayShortFormat = (lang: string): Intl.DateTimeFormat =>
  new Intl.DateTimeFormat(lang, { weekday: 'short' });
