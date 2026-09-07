import { describe, expect, it } from 'vitest';
import { formatSortValue } from './indexSortValue';

// Подпись подставляет число в шаблон — так видно, что ключ вообще применён.
const t = (key: string, opts?: Record<string, unknown>) =>
  `${key}:${(opts as { count?: number } | undefined)?.count ?? ''}`;

describe('formatSortValue', () => {
  it('пусто — прочерк, а не ноль: числа нет, а не «измерено и равно нулю»', () => {
    expect(formatSortValue('value', null, 'ru', t)).toBe('—');
    expect(formatSortValue('stats', undefined, 'ru', t)).toBe('—');
  });

  it('ноль остаётся нулём', () => {
    expect(formatSortValue('news', 0, 'en', t)).toBe('index.mentions:0');
  });

  it('стоимость — в евро', () => {
    expect(formatSortValue('value', 600000, 'en', t)).toMatch(/€/);
  });

  // ⚠️ ГЛАВНАЯ ПРОВЕРКА: одно и то же число под разными сортировками обязано
  // читаться по-разному. 12000 евро, 12000 просмотров и 12000 минут — три
  // разных утверждения, и список без единиц не проверяется никак.
  it('одно число под разными показателями даёт разные подписи', () => {
    const got = (['value', 'views', 'stats', 'goals', 'news'] as const)
      .map((s) => formatSortValue(s, 12000, 'en', t));
    expect(new Set(got).size).toBe(got.length);
  });

  it('минуты названы минутами, а голы голами', () => {
    expect(formatSortValue('stats', 11446, 'ru', t)).toBe('index.minutes:11446');
    expect(formatSortValue('goals', 10, 'ru', t)).toBe('index.goals:10');
  });

  it('дробное число минут округляется, а не показывается как есть', () => {
    expect(formatSortValue('stats', 90.6, 'ru', t)).toBe('index.minutes:91');
  });

  it('общий счёт — просто балл, без единиц', () => {
    expect(formatSortValue('index', 90, 'en', t)).toBe('90');
    expect(formatSortValue('rating', 78, 'en', t)).toBe('78');
  });

  // ⚠️ РОСТ — «ВО СКОЛЬКО РАЗ», А НЕ ЕВРО. Без знака умножения «1,8» читается
  // как сумма, а значит «подорожал в 1,8 раза».
  it('рост показан множителем', () => {
    expect(formatSortValue('growth', 1.8, 'en', t)).toBe('×1.8');
  });

  // ⚠️ «МОЛОДЫЕ» ПРИХОДЯТ ЧИСЛОМ СЕКУНД: сортировать надо по дате, а показывать
  // секунды нельзя — под «самыми молодыми» человек ждёт год рождения.
  it('молодые показаны годом рождения, а не числом секунд', () => {
    const epoch = Date.UTC(2007, 4, 12) / 1000;
    expect(formatSortValue('young', epoch, 'en', t)).toBe('2007');
  });

  it('непрочитанная дата — прочерк, а не «1970»', () => {
    expect(formatSortValue('young', Number.NaN, 'en', t)).toBe('—');
  });

  it('матчи за сборную, страны и карточки названы своими словами', () => {
    expect(formatSortValue('caps', 246, 'ru', t)).toBe('index.caps:246');
    expect(formatSortValue('countries', 8, 'ru', t)).toBe('index.countries_n:8');
    expect(formatSortValue('cards', 219, 'ru', t)).toBe('index.cards_n:219');
  });
});
