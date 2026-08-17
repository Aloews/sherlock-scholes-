import { describe, it, expect } from 'vitest';
import {
  localDayKey,
  firstDayOfWeek,
  shiftMonth,
  monthStart,
  countByDay,
  isKnown,
  monthGrid,
  monthBounds,
} from './monthCalendar';

/** Матч в местное время — так его увидит зритель, и так его кладёт сетка. */
const at = (y: number, m: number, d: number, h = 12) =>
  ({ commence_at: new Date(y, m - 1, d, h).toISOString() });

describe('localDayKey', () => {
  it('день местный, а не UTC', () => {
    // Полночь по местному времени. toISOString() у половины планеты вернул бы
    // здесь ПРЕДЫДУЩИЙ день — ради этого ключ и считается по местным полям.
    expect(localDayKey(new Date(2026, 7, 16, 0, 0))).toBe('2026-08-16');
    expect(localDayKey(new Date(2026, 7, 16, 23, 59))).toBe('2026-08-16');
  });

  it('месяц и день дополняются нулём — иначе строки не сортируются', () => {
    expect(localDayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    // Порядок строк должен совпадать с порядком дат, на этом держится isKnown.
    expect('2026-01-05' < '2026-01-12').toBe(true);
    expect('2026-09-30' < '2026-10-01').toBe(true);
  });
});

describe('firstDayOfWeek', () => {
  it('неделя начинается по-разному, и это не мелочь оформления', () => {
    expect(firstDayOfWeek('ru')).toBe(1); // понедельник
    expect(firstDayOfWeek('en')).toBe(0); // воскресенье
  });

  it('незнакомая локаль не оставляет без календаря', () => {
    expect(firstDayOfWeek('не-локаль')).toBe(1);
  });
});

describe('shiftMonth', () => {
  it('ЯНВАРЬ 31-е ПЛЮС МЕСЯЦ — ЭТО ФЕВРАЛЬ, А НЕ МАРТ', () => {
    // Ради этого якорь — первое число. Без него new Date(y, m+1, 31) для
    // января даёт 3 марта, и листание вперёд перепрыгивает через февраль
    // молча: пользователь видит март там, где нажимал «следующий».
    const jan31 = new Date(2026, 0, 31);
    expect(shiftMonth(jan31, 1).getMonth()).toBe(1);
    expect(shiftMonth(jan31, 1).getDate()).toBe(1);
  });

  it('через границу года в обе стороны', () => {
    expect(shiftMonth(new Date(2026, 11, 15), 1).getFullYear()).toBe(2027);
    expect(shiftMonth(new Date(2026, 11, 15), 1).getMonth()).toBe(0);
    expect(shiftMonth(new Date(2026, 0, 15), -1).getFullYear()).toBe(2025);
    expect(shiftMonth(new Date(2026, 0, 15), -1).getMonth()).toBe(11);
  });

  it('monthStart обнуляет число', () => {
    expect(monthStart(new Date(2026, 7, 16)).getDate()).toBe(1);
  });
});

describe('countByDay', () => {
  it('считает по местным дням', () => {
    const counts = countByDay([at(2026, 8, 16), at(2026, 8, 16, 18), at(2026, 8, 17)]);
    expect(counts.get('2026-08-16')).toBe(2);
    expect(counts.get('2026-08-17')).toBe(1);
    expect(counts.get('2026-08-18')).toBeUndefined();
  });
});

describe('isKnown', () => {
  const horizon = {
    first: new Date(2026, 7, 10, 12).toISOString(),
    publishedUntil: new Date(2026, 7, 30, 12).toISOString(),
  };

  it('внутри окна — знаем', () => {
    expect(isKnown('2026-08-10', horizon)).toBe(true);
    expect(isKnown('2026-08-20', horizon)).toBe(true);
    expect(isKnown('2026-08-30', horizon)).toBe(true);
  });

  it('ЗА ГОРИЗОНТОМ — НЕ ЗНАЕМ, А НЕ «ПУСТО»', () => {
    // Вся суть: провайдер расписал три недели, и сентябрь у него пуст не
    // потому, что футбола не будет.
    expect(isKnown('2026-08-31', horizon)).toBe(false);
    expect(isKnown('2026-09-15', horizon)).toBe(false);
    expect(isKnown('2026-08-09', horizon)).toBe(false);
  });

  it('пустая таблица — не знаем ничего', () => {
    expect(isKnown('2026-08-16', { first: null, publishedUntil: null })).toBe(false);
  });

  it('ДЕНЬ С МАТЧАМИ ИЗВЕСТЕН, даже стоя далеко за горизонтом', () => {
    // Одинокий матч 24 сентября: горизонт публикации кончился 30 августа, но
    // отрисовать этот день серым «не знаем», когда матч в нём прямо есть, —
    // это уже враньё в другую сторону.
    expect(isKnown('2026-09-24', horizon, 1)).toBe(true);
    expect(isKnown('2026-09-24', horizon, 0)).toBe(false);
  });

  it('день внутри окна БЕЗ матчей — знаем, что матчей нет', () => {
    // Разница между двумя пустыми клетками: эта пуста по-настоящему.
    const grid = monthGrid(new Date(2026, 7, 1), 'ru', [at(2026, 8, 16)], horizon);
    const empty = grid.find((c) => c.key === '2026-08-20')!;
    expect(empty.matches).toBe(0);
    expect(empty.known).toBe(true);
  });
});

describe('monthGrid', () => {
  const horizon = {
    first: new Date(2026, 7, 10, 12).toISOString(),
    publishedUntil: new Date(2026, 7, 30, 12).toISOString(),
  };

  it('сетка состоит из целых недель', () => {
    for (const month of [new Date(2026, 0, 1), new Date(2026, 1, 1), new Date(2026, 7, 1)]) {
      const grid = monthGrid(month, 'ru', [], horizon);
      expect(grid.length % 7).toBe(0);
    }
  });

  it('начинается с первого дня недели локали', () => {
    // ru — понедельник (1), en — воскресенье (0).
    expect(monthGrid(new Date(2026, 7, 1), 'ru', [], horizon)[0].date.getDay()).toBe(1);
    expect(monthGrid(new Date(2026, 7, 1), 'en', [], horizon)[0].date.getDay()).toBe(0);
  });

  it('содержит все дни месяца ровно по разу', () => {
    const grid = monthGrid(new Date(2026, 7, 1), 'ru', [], horizon);
    const mine = grid.filter((c) => c.inMonth);
    expect(mine.length).toBe(31);
    expect(new Set(mine.map((c) => c.key)).size).toBe(31);
  });

  it('февраль високосного года', () => {
    const grid = monthGrid(new Date(2028, 1, 1), 'ru', [], horizon);
    expect(grid.filter((c) => c.inMonth).length).toBe(29);
  });

  it('хвосты соседних месяцев помечены и не считаются своими', () => {
    const grid = monthGrid(new Date(2026, 7, 1), 'ru', [], horizon);
    // 1 августа 2026 — суббота, значит перед ней в сетке пять дней июля.
    expect(grid[0].inMonth).toBe(false);
    expect(grid.some((c) => c.inMonth)).toBe(true);
  });

  it('матчи попадают в свои клетки', () => {
    const grid = monthGrid(new Date(2026, 7, 1), 'ru', [at(2026, 8, 16), at(2026, 8, 16, 20)], horizon);
    expect(grid.find((c) => c.key === '2026-08-16')!.matches).toBe(2);
  });

  it('месяц целиком за горизонтом — ни одна клетка не знает о себе', () => {
    const grid = monthGrid(new Date(2026, 8, 1), 'ru', [], horizon);
    expect(grid.filter((c) => c.inMonth).every((c) => !c.known)).toBe(true);
  });

  it('ОДИНОКИЙ МАТЧ ЗА ГОРИЗОНТОМ НЕ ДЕЛАЕТ ИЗВЕСТНЫМ МЕСЯЦ ВОКРУГ СЕБЯ', () => {
    // Настоящая картина в таблице: сплошной август и один матч 24 сентября.
    // Если горизонтом считать самый далёкий матч, весь сентябрь станет
    // «известным и пустым» — то есть экран заявит, что футбола в сентябре не
    // будет. Ради этого случая published_until считается до первого разрыва.
    const grid = monthGrid(new Date(2026, 8, 1), 'ru', [at(2026, 9, 24)], horizon);
    const lone = grid.find((c) => c.key === '2026-09-24')!;
    const around = grid.find((c) => c.key === '2026-09-23')!;
    expect(lone.matches).toBe(1);
    expect(lone.known).toBe(true);
    expect(around.matches).toBe(0);
    expect(around.known).toBe(false);
  });
});

describe('monthBounds', () => {
  it('границы местные и полуинтервал', () => {
    const { from, to } = monthBounds(new Date(2026, 7, 16));
    // from — местная полночь 1 августа, to — местная полночь 1 сентября.
    expect(new Date(from).getTime()).toBe(new Date(2026, 7, 1).getTime());
    expect(new Date(to).getTime()).toBe(new Date(2026, 8, 1).getTime());
    // Матч ровно в полночь 1 сентября принадлежит сентябрю, а не августу:
    // иначе он попал бы в оба месяца сразу.
    expect(new Date(to).getTime() > new Date(from).getTime()).toBe(true);
  });

  it('декабрь переходит в январь следующего года', () => {
    const { to } = monthBounds(new Date(2026, 11, 5));
    expect(new Date(to).getFullYear()).toBe(2027);
    expect(new Date(to).getMonth()).toBe(0);
  });
});
