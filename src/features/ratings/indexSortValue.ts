import { formatEur } from '@/shared/lib/money';
import type { IndexSort } from './ratingsApi';

/**
 * Число выбранного показателя так, как его читает человек.
 *
 * ⚠️ КАЖДЫЙ ПОКАЗАТЕЛЬ В СВОИХ ЕДИНИЦАХ, И ЭТО НЕ КОСМЕТИКА. Стоимость в евро,
 * просмотры штуками, статистика в минутах. Одно и то же «12000» под разными
 * сортировками значит двенадцать тысяч евро, двенадцать тысяч просмотров и
 * двенадцать тысяч минут на поле — три разных утверждения. Без единиц список
 * выглядит правдоподобно и не проверяется никак.
 *
 * ⚠️ ПУСТО — ПРОЧЕРК, А НЕ НОЛЬ. У показателя может не быть числа; ноль сказал
 * бы «измерено и равно нулю».
 */
export function formatSortValue(
  sort: IndexSort,
  value: number | null | undefined,
  lang: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (value == null) return '—';
  const n = new Intl.NumberFormat(lang);
  switch (sort) {
    case 'value':
      return formatEur(value, lang) ?? n.format(value);
    case 'stats':
      return t('index.minutes', { count: Math.round(value) });
    case 'goals':
      return t('index.goals', { count: Math.round(value) });
    case 'news':
      return t('index.mentions', { count: Math.round(value) });
    case 'views':
      return n.format(value);
    // Общий счёт и рейтинг Soccer Wiki — это баллы, а не количество чего-то.
    case 'index':
    case 'rating':
    default:
      return n.format(value);
  }
}
