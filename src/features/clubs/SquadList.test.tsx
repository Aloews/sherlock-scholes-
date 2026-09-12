// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * В СОСТАВЕ СТОИТ СТОИМОСТЬ, А НЕ НАШ УРОВЕНЬ.
 *
 * Владелец: «пиши стоимость игрока, а не наш рейтинг, у нашего рейтинга все
 * футболисты имеют по 100. Стоимость точнее отражает уровень игрока».
 *
 * ⚠️ ПРОВЕРКА СМОТРИТ НА ТО, ЧЕГО НА ЭКРАНЕ БЫТЬ НЕ ДОЛЖНО, а не только на
 * то, что должно. «Стоимость появилась» была бы зелёной и тогда, когда рядом
 * остался прежний уровень — а жалоба была именно про число, одинаковое у
 * всех. Поэтому здесь у игроков заданы ОБА поля, и уровень обязан не
 * появиться.
 */
vi.mock('@/shared/lib/telegram', () => ({ hapticImpact: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'ru', exists: () => false },
  }),
}));

const { SquadList } = await import('./SquadList');

afterEach(() => cleanup());

const rows = [
  {
    card_id: 'c1', name: 'Лука Вушкович', name_en: 'Luka Vušković',
    market_value_eur: 60_000_000, player_position: 'Defender',
    shirt_number: 44, photo_url: null, source: 'roster',
  },
  // Без оценки: у человека из заявки её может не быть вовсе.
  {
    card_id: null, name: 'Никто', name_en: 'Nobody',
    market_value_eur: null, player_position: null,
    shirt_number: null, photo_url: null, source: 'roster',
  },
];

const draw = (data = rows) => render(
  <MemoryRouter><SquadList rows={data} /></MemoryRouter>,
);

describe('SquadList', () => {
  it('показывает стоимость игрока', () => {
    draw();
    expect(screen.getByText(/60/)).toBeTruthy();
  });

  it('НЕ показывает наш уровень — он у всех одинаковый', () => {
    // 97 — типичный player_level у состава «Брайтона»: 96–99 подряд у всех
    // одиннадцати. Если уровень вернётся на экран, он найдётся.
    draw([{ ...rows[0], level: 97 } as never]);
    expect(screen.queryByText('97')).toBeNull();
  });

  it('имя футболиста — латиницей, даже на русском языке', () => {
    draw();
    expect(screen.getByText('Luka Vušković')).toBeTruthy();
    expect(screen.queryByText('Лука Вушкович')).toBeNull();
  });

  it('без оценки не печатает ноль — ноль читался бы как «не стоит ничего»', () => {
    draw();
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.getByText('Nobody')).toBeTruthy();
  });

  it('называет источник состава', () => {
    draw();
    expect(screen.getByText('clubs.squad_source_roster')).toBeTruthy();
  });

  it('пустой состав говорит словами, а не пустотой', () => {
    draw([]);
    expect(screen.getByText('clubs.squad_unknown')).toBeTruthy();
  });
});
