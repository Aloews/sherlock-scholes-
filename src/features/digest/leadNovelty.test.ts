import { describe, it, expect } from 'vitest';
import {
  leadAddsDetail, leadTokens, MIN_NEW_WORDS, storyReveal, REVEAL_MAX_PARTS,
} from './leadNovelty';

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

/**
 * РАСКРЫТИЕ СЮЖЕТА.
 *
 * Пример — С ЖИВОЙ ЛЕНТЫ 06.09.2026, самый обсуждаемый сюжет дня на пяти
 * языках из девяти: «Сандерленд» — «Брентфорд», четыре издания. Он же и
 * объясняет, зачем раскрытие вообще нужно: BBC говорит, что был пенальти, Sky
 * добавляет счёт, Guardian — что тот же игрок промахнулся здесь в прошлом
 * сезоне. Ни одного вызова модели: всё это уже пришло в ответе ленты.
 */
const BBC_TITLE = 'Le Fee penalty saves point for Sunderland at Brentford';
const BBC_LEAD = 'Enzo le Fee converted a late penalty to earn Sunderland a draw at Brentford.';

describe('storyReveal', () => {
  it('берёт то, что добавили другие издания, и не берёт пустое', () => {
    const parts = storyReveal(BBC_TITLE, BBC_LEAD, [
      // Счёт 1:1 — деталь, которой у ведущей заметки нет.
      { source: 'Sky Sports', lead_text: 'Enzo Le Fee rescued a point for Sunderland after '
        + 'dispatching his late penalty to secure a 1-1 draw at Brentford.' },
      // У ESPN в RSS сути нет вовсе — строки быть не должно, а не пустой.
      { source: 'ESPN', lead_text: null },
      { source: 'The Guardian', lead_text: '<p>True redemption, perhaps, would have been to '
        + 'score with a Panenka, but Enzo Le Fée didn’t quite have the chutzpah for that. '
        + 'His duffed dink at Brentford last season was the low…' },
    ]);
    expect(parts.map((p) => p.source)).toEqual(['Sky Sports', 'The Guardian']);
    expect(parts[0].text).toContain('1-1');
    // Разметка вырезана: читатель не должен увидеть «<p>True redemption».
    expect(parts[1].text.startsWith('True redemption')).toBe(true);
  });

  // ⚠️ ОТРИЦАТЕЛЬНЫЙ КОНТРОЛЬ, и он здесь главный. Без него раскрытие прошло
  // бы и у функции, печатающей ВСЁ подряд, — а это ровно тот повтор, из-за
  // которого лента была «сухой»: один трансфер пятью одинаковыми строками.
  it('повтор ведущей заметки не даёт НИ ОДНОЙ строки', () => {
    const parts = storyReveal(BBC_TITLE, BBC_LEAD, [
      { source: 'Sky Sports', lead_text: 'Le Fee penalty saves point for Sunderland at Brentford' },
      { source: 'ESPN', lead_text: 'Enzo le Fee converted a late penalty to earn Sunderland a draw.' },
      { source: 'Marca', lead_text: BBC_LEAD },
    ]);
    expect(parts).toEqual([]);
  });

  it('второе издание с той же деталью уже не проходит: планка накопительная', () => {
    const same = 'Sunderland drew 1-1 at Brentford thanks to a late Enzo Le Fee penalty kick.';
    const parts = storyReveal(BBC_TITLE, BBC_LEAD, [
      { source: 'Sky Sports', lead_text: same },
      { source: 'The Guardian', lead_text: same },
    ]);
    expect(parts).toHaveLength(1);
    expect(parts[0].source).toBe('Sky Sports');
  });

  it('одно издание — одна строка, даже если текстов у него два', () => {
    const parts = storyReveal(BBC_TITLE, BBC_LEAD, [
      { source: 'Sky Sports', lead_text: 'Sunderland secured a 1-1 draw at the Gtech Community '
        + 'Stadium after Enzo Le Fee converted from twelve yards in stoppage time.' },
      { source: 'Sky Sports', lead_text: 'Keith Andrews criticised the referee for awarding the '
        + 'spot-kick, calling the decision a soft one that changed the entire contest.' },
    ]);
    expect(parts).toHaveLength(1);
  });

  it('длиннее потолка раскрытие не бывает', () => {
    // Каждый текст про своё, то есть порог новизны проходит любой: длину
    // ограничивает здесь именно потолок, а не отбор. Порядок слов проверен —
    // без потолка функция вернула бы все пять.
    const many = [
      { source: 'Sky Sports', lead_text: 'Keith Andrews criticised the referee for awarding '
        + 'the spot-kick deep into stoppage time at the Gtech Community Stadium.' },
      { source: 'The Guardian', lead_text: 'Regis Le Bris made three substitutions before the '
        + 'hour mark and watched his side dominate territory without creating clear openings.' },
      { source: 'BBC Sport', lead_text: 'Igor Thiago headed Brentford ahead midway through the '
        + 'first half, extending his scoring run to four consecutive league appearances.' },
      { source: 'ESPN', lead_text: 'Attendance at the west London ground reached 17,000 despite '
        + 'travel disruption on the underground network throughout Saturday afternoon.' },
      { source: 'Marca', lead_text: 'El colegiado mostró cinco tarjetas amarillas durante un '
        + 'encuentro trabado que dejó a ambos equipos en mitad de la clasificación.' },
    ];
    expect(storyReveal(BBC_TITLE, BBC_LEAD, many)).toHaveLength(REVEAL_MAX_PARTS);
    expect(storyReveal(BBC_TITLE, BBC_LEAD, many.slice(0, 2))).toHaveLength(2);
  });
});
