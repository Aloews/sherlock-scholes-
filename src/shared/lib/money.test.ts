import { describe, expect, it } from 'vitest';
import { formatEur } from './money';

describe('formatEur', () => {
  it('сокращает миллионы средствами локали, а не строкой «млн»', () => {
    // Не сверяем с буквальной строкой: у каждого движка ICU свой пробел и
    // своя постановка знака валюты, и тест на точное совпадение ловил бы
    // версию Node, а не нашу ошибку.
    const ru = formatEur(40_000_000, 'ru')!;
    expect(ru).toMatch(/40/);
    expect(ru.length).toBeLessThan(12);          // «40 млн €», а не «40 000 000 €»
    expect(ru).not.toMatch(/40[\s ]?000[\s ]?000/);
  });

  it('в разных локалях выдаёт РАЗНЫЕ строки — значит локаль правда учтена', () => {
    expect(formatEur(40_000_000, 'ru')).not.toBe(formatEur(40_000_000, 'en'));
  });

  it('восемьсот тысяч не превращаются в ноль миллионов', () => {
    const s = formatEur(800_000, 'en')!;
    expect(s).toMatch(/800/);
  });

  it('null, ноль и отрицательное — это «нет данных», а не «€0»', () => {
    // Ноль у стоимости означает испорченный разбор, а не «ничего не стоит»;
    // показать «€0» значит соврать увереннее, чем промолчать.
    expect(formatEur(null, 'ru')).toBeNull();
    expect(formatEur(undefined, 'ru')).toBeNull();
    expect(formatEur(0, 'ru')).toBeNull();
    expect(formatEur(-5, 'ru')).toBeNull();
    expect(formatEur(Number.NaN, 'ru')).toBeNull();
  });

  it('незнакомая локаль не роняет экран, а отдаёт запасную строку', () => {
    // Intl бросает RangeError на негодном теге. Экран из-за этого уже белел
    // однажды — на дате в FantasyScreen.
    expect(formatEur(40_000_000, 'не-локаль!!')).toBe('€40M');
  });
});
