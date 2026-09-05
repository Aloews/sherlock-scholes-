import { describe, it, expect } from 'vitest';
import { leadAddsDetail, leadTokens, MIN_NEW_WORDS } from './leadNovelty';

/**
 * Примеры взяты С ЖИВОЙ ЛЕНТЫ 03.09.2026, а не придуманы: правило выбиралось
 * по замеру (ru — 7 заметок из 44 под порогом, en — ни одной из 20), и тест
 * держит именно те случаи, на которых порог и выбран.
 */
describe('leadAddsDetail', () => {
  it('дословный повтор заголовка не показывается', () => {
    expect(leadAddsDetail(
      'Андрей Мостовой перешёл в «Локомотив» на правах аренды',
      'Андрей Мостовой перешёл в «Локомотив» на правах аренды.',
    )).toBe(false);
  });

  it('«прокомментировал то же самое» — это не деталь', () => {
    expect(leadAddsDetail(
      '«Будем скучать». Моуринью — о решении Месси завершить карьеру в сборной Аргентины',
      'Моуринью прокомментировал решение Месси завершить карьеру в сборной Аргентины.',
    )).toBe(false);
  });

  it('два глагола речи поверх заголовка — всё ещё пересказ', () => {
    expect(leadAddsDetail(
      'Тренер «ПСЖ» Энрике — о переходе Барколя в «Ливерпуль»: «Все остались в выигрыше»',
      'Энрике прокомментировал переход Барколы в «Ливерпуль», заявив, что все остались в выигрыше',
    )).toBe(false);
  });

  it('настоящие подробности показываются', () => {
    expect(leadAddsDetail(
      'Hull condemn ‘disgusting’ racist abuse of deadline-day signing Robinio Vaz',
      'Hull City condemned racist abuse aimed at teenage striker Robinio Vaz on social '
      + 'media following his loan move from Roma. The club is working with authorities.',
    )).toBe(true);
  });

  it('имя и должность сверх заголовка — это подробность', () => {
    expect(leadAddsDetail(
      'Sarr needs time to process collapse of Liverpool move',
      "Crystal Palace's Ismaila Sarr needs time to process after his proposed move to "
      + 'Liverpool fell through, according to head coach Pierre Sage.',
    )).toBe(true);
  });

  it('пустая и отсутствующая суть не показываются', () => {
    expect(leadAddsDetail('Заголовок', null)).toBe(false);
    expect(leadAddsDetail('Заголовок', '')).toBe(false);
    expect(leadAddsDetail('Заголовок', '   ')).toBe(false);
  });
});

describe('leadTokens', () => {
  /**
   * ⚠️ Ради этого числа токенайзер и написан отдельно от storyTokens: тот
   * выбрасывает числа, а здесь год — единственное, что суть добавляет.
   */
  it('числа сохраняются целиком и не обрезаются', () => {
    expect(leadTokens('контракт до 2028 года').has('2028')).toBe(true);
    expect(leadTokens('контракт до 2026 года').has('2028')).toBe(false);
  });

  it('слова обрезаются, поэтому словоформы сходятся', () => {
    const a = leadTokens('переход');
    const b = leadTokens('переходе');
    expect([...a][0]).toBe([...b][0]);
  });

  it('служебные слова выброшены', () => {
    expect(leadTokens('и в на что the of to').size).toBe(0);
  });

  it('порог назван числом, а не спрятан в коде', () => {
    expect(MIN_NEW_WORDS).toBe(4);
  });
});
