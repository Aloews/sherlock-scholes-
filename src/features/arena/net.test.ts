import { describe, it, expect } from 'vitest';
import {
  SnapshotBuffer,
  INTERP_DELAY_MS,
  clampMove,
  lerpSnapshot,
  readInputMessage,
  readSnapshot,
  reconcile,
  sideFor,
  toInputMessage,
  toSnapshot,
  type Snapshot,
} from './net';
import { kickoff } from './physics';

const snap = (t: number, over: Partial<Snapshot> = {}): Snapshot => ({
  t, lx: 0, ly: 0, rx: 0, ry: 0, bx: 0, by: 0, sl: 0, sr: 0, ack: 0, ...over,
});

describe('снимок', () => {
  it('несёт положения и счёт, но не скорости', () => {
    const s = toSnapshot(kickoff({ left: 2, right: 1 }), 1000, 7);
    expect(s.sl).toBe(2);
    expect(s.sr).toBe(1);
    expect(s.ack).toBe(7);
    // Скорости гость не интегрирует — он интерполирует между положениями,
    // и лишние шесть чисел двадцать раз в секунду были бы трафиком впустую.
    expect(Object.keys(s)).not.toContain('lvx');
  });

  it('округляется до десятой пикселя', () => {
    const state = kickoff();
    state.ball.x = 123.456789;
    expect(toSnapshot(state, 0, 0).bx).toBe(123.5);
  });
});

describe('разбор недоверенного ввода', () => {
  it('читает нормальную посылку', () => {
    expect(readInputMessage({ seq: 3, mx: 0.5, my: -0.5, kick: true }))
      .toEqual({ seq: 3, mx: 0.5, my: -0.5, kick: true });
  });

  it('без seq — не сообщение', () => {
    expect(readInputMessage({ mx: 1, my: 0 })).toBeNull();
    expect(readInputMessage(null)).toBeNull();
    expect(readInputMessage('пусть будет строка')).toBeNull();
  });

  it('мусор вместо чисел становится нулём, а не NaN', () => {
    // NaN дошёл бы до физики и превратил бы позицию в NaN навсегда: дальше
    // каждое сравнение ложно, тело исчезает с поля и не возвращается.
    const m = readInputMessage({ seq: 1, mx: 'вправо', my: null, kick: 1 })!;
    expect(m.mx).toBe(0);
    expect(m.my).toBe(0);
    // kick строго true, иначе любое непустое значение включало бы удар.
    expect(m.kick).toBe(false);
  });

  it('kick только при настоящем true', () => {
    expect(readInputMessage({ seq: 1, mx: 0, my: 0, kick: true })!.kick).toBe(true);
  });
});

describe('clampMove', () => {
  it('оставляет вектор внутри круга как есть', () => {
    expect(clampMove(0.3, 0.4)).toEqual({ x: 0.3, y: 0.4 });
  });

  it('зажимает длину — чужое устройство может прислать что угодно', () => {
    // Вектор длиной 100 увёз бы игрока через всё поле за кадр.
    const v = clampMove(100, 0);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 5);
  });

  it('ноль остаётся нулём и не делится на себя', () => {
    expect(clampMove(0, 0)).toEqual({ x: 0, y: 0 });
  });
});

describe('readSnapshot', () => {
  it('зажимает координаты в пределах поля с запасом на ворота', () => {
    const s = readSnapshot({ t: 1, bx: 99999, by: -99999 })!;
    expect(s.bx).toBeLessThanOrEqual(700);
    expect(s.by).toBeGreaterThanOrEqual(-60);
  });

  it('счёт не бывает дробным и отрицательным', () => {
    const s = readSnapshot({ t: 1, sl: -3, sr: 2.7 })!;
    expect(s.sl).toBe(0);
    expect(s.sr).toBe(2);
  });

  it('без времени хоста снимок бесполезен', () => {
    expect(readSnapshot({ bx: 1 })).toBeNull();
  });
});

describe('lerpSnapshot', () => {
  it('идёт ровно посередине', () => {
    const m = lerpSnapshot(snap(0, { bx: 0 }), snap(100, { bx: 100 }), 0.5);
    expect(m.bx).toBe(50);
  });

  it('счёт не интерполируется — половины гола не бывает', () => {
    const m = lerpSnapshot(snap(0, { sl: 0 }), snap(100, { sl: 1 }), 0.5);
    expect(m.sl).toBe(1);
  });

  it('коэффициент зажат', () => {
    const m = lerpSnapshot(snap(0, { bx: 0 }), snap(100, { bx: 100 }), 5);
    expect(m.bx).toBe(100);
  });
});

describe('SnapshotBuffer', () => {
  it('пока ничего не пришло — null, а не нули', () => {
    // Нули это левый верхний угол поля; один такой кадр читается как телепорт.
    expect(new SnapshotBuffer().sample(1000)).toBeNull();
  });

  it('интерполирует между двумя снимками с задержкой отрисовки', () => {
    const b = new SnapshotBuffer();
    // Часы хоста и локальные совпадают: сдвиг выйдет нулевым.
    b.push(snap(1000, { bx: 0 }), 1000);
    b.push(snap(1100, { bx: 100 }), 1100);
    // Рисуем момент 1100 - INTERP_DELAY_MS = 1025 => четверть пути.
    const s = b.sample(1100 + INTERP_DELAY_MS - 75)!;
    expect(s.bx).toBeGreaterThan(0);
    expect(s.bx).toBeLessThan(100);
  });

  it('опоздавшая посылка встаёт на своё место по времени', () => {
    // Канал не гарантирует порядок, а интерполяция по неупорядоченному
    // буферу дала бы рывок назад.
    const b = new SnapshotBuffer();
    b.push(snap(1000, { bx: 0 }), 1000);
    b.push(snap(1200, { bx: 200 }), 1200);
    b.push(snap(1100, { bx: 100 }), 1210);
    expect(b.size).toBe(3);
    expect(b.latest!.t).toBe(1200);
  });

  it('дубль по времени не удваивает буфер', () => {
    const b = new SnapshotBuffer();
    b.push(snap(1000), 1000);
    b.push(snap(1200), 1200);
    b.push(snap(1000), 1201);
    expect(b.size).toBe(2);
  });

  it('буфер не растёт бесконечно', () => {
    const b = new SnapshotBuffer();
    for (let i = 0; i < 500; i++) b.push(snap(1000 + i * 50), 1000 + i * 50);
    expect(b.size).toBeLessThanOrEqual(40);
  });

  it('часы телефонов расходятся, и сдвиг это учитывает', () => {
    // Хост живёт в своём времени (например, ушёл на час вперёд). Гость не
    // должен видеть пустоту только потому, что абсолютные числа не совпали.
    const b = new SnapshotBuffer();
    const hostBase = 3_600_000;
    b.push(snap(hostBase, { bx: 10 }), 1000);
    b.push(snap(hostBase + 100, { bx: 20 }), 1100);
    expect(b.sample(1150)).not.toBeNull();
  });

  it('отстав от буфера, показывает самое свежее, а не выдумывает', () => {
    // Экстраполяция нарисовала бы мяч там, где его не было, — и гол был бы
    // виден в месте, где его не забивали.
    const b = new SnapshotBuffer();
    b.push(snap(1000, { bx: 0 }), 1000);
    b.push(snap(1100, { bx: 100 }), 1100);
    expect(b.sample(60_000)!.bx).toBe(100);
  });
});

describe('reconcile', () => {
  it('малое расхождение стягивается плавно', () => {
    const out = reconcile({ x: 100, y: 100 }, { x: 110, y: 100 });
    expect(out.x).toBeGreaterThan(100);
    expect(out.x).toBeLessThan(110);
  });

  it('большое — сразу, потому что случилось событие', () => {
    // Гол и розыгрыш с центра гость не предсказывает; ехать туда плавно
    // значило бы пересечь всё поле на глазах у игрока.
    expect(reconcile({ x: 10, y: 10 }, { x: 500, y: 200 })).toEqual({ x: 500, y: 200 });
  });

  it('совпадение никуда не двигает', () => {
    expect(reconcile({ x: 50, y: 50 }, { x: 50, y: 50 })).toEqual({ x: 50, y: 50 });
  });
});

describe('стороны', () => {
  it('хост всегда слева — сторона выводится, а не согласуется', () => {
    // Согласование сторон это ещё одно сообщение и ещё одна возможность
    // разойтись: оба игрока считали бы себя левыми.
    expect(sideFor(true)).toBe('left');
    expect(sideFor(false)).toBe('right');
  });
});

describe('toInputMessage', () => {
  it('несёт номер, чтобы хост отбрасывал опоздавшее', () => {
    const m = toInputMessage({ move: { x: 1, y: 0 }, kick: true }, 42);
    expect(m.seq).toBe(42);
    expect(m.kick).toBe(true);
  });
});
