// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ArenaPad } from './ArenaPad';
import type { PlayerInput } from './physics';

// ЭТО ПРОВЕРИТЬ В ОДИНОЧКУ НЕЛЬЗЯ. Играют вдвоём на одном телефоне: два
// джойстика и две кнопки живут на экране одновременно, и самая вероятная
// ошибка здесь — обработчик, который помнит «текущее касание» и отдаёт оба
// джойстика тому, кто нажал последним. Один человек с одним пальцем такую
// ошибку не найдёт никогда.

// jsdom не умеет захват указателя: он есть в разметке, но не в реализации.
// Заглушка нужна, иначе первый же pointerdown падает.
beforeEach(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});
afterEach(() => cleanup());

const STICK_R = 46;

function makeInput(): PlayerInput {
  return { move: { x: 0, y: 0 }, kick: false };
}

function mount(side: 'left' | 'right', input: PlayerInput, onKick = vi.fn()) {
  render(
    <ArenaPad
      side={side}
      input={input}
      onKickChange={onKick}
      label={`pad-${side}`}
      kickLabel={`kick-${side}`}
      color="rgb(1 2 3)"
    />,
  );
  return {
    zone: screen.getByLabelText(`pad-${side}`),
    kick: screen.getByText(`kick-${side}`).closest('button')!,
    onKick,
  };
}

/** Провести пальцем от точки к точке. */
function drag(el: Element, id: number, from: [number, number], to: [number, number]) {
  fireEvent.pointerDown(el, { pointerId: id, clientX: from[0], clientY: from[1] });
  fireEvent.pointerMove(el, { pointerId: id, clientX: to[0], clientY: to[1] });
}

describe('ArenaPad — джойстик', () => {
  it('даёт долю от полного хода, а не пиксели', () => {
    const input = makeInput();
    const { zone } = mount('left', input);
    drag(zone, 1, [100, 100], [100 + STICK_R / 2, 100]);
    expect(input.move.x).toBeCloseTo(0.5, 6);
    expect(input.move.y).toBeCloseTo(0, 6);
  });

  it('отсчитывает от места нажатия, а не от центра площадки', () => {
    // Джойстик ОТНОСИТЕЛЬНЫЙ: иначе первое движение — всегда рывок к центру
    // площадки, куда игрок не собирался.
    const input = makeInput();
    const { zone } = mount('left', input);
    drag(zone, 1, [300, 300], [300, 300]);
    expect(input.move).toEqual({ x: 0, y: 0 });
  });

  it('не разгоняет сверх полного хода, как далеко палец ни уводи', () => {
    const input = makeInput();
    const { zone } = mount('left', input);
    drag(zone, 1, [100, 100], [100 + STICK_R * 10, 100]);
    expect(Math.hypot(input.move.x, input.move.y)).toBeCloseTo(1, 6);
  });

  it('обнуляет ход, когда палец убрали', () => {
    const input = makeInput();
    const { zone } = mount('left', input);
    drag(zone, 1, [100, 100], [180, 140]);
    expect(input.move.x).not.toBe(0);

    fireEvent.pointerUp(zone, { pointerId: 1 });
    expect(input.move).toEqual({ x: 0, y: 0 });
  });

  it('не слушает чужое касание', () => {
    // Второй палец на той же половине не должен перехватывать джойстик у
    // первого: игрок держит его, а не переставляет.
    const input = makeInput();
    const { zone } = mount('left', input);
    drag(zone, 1, [100, 100], [100 + STICK_R, 100]);
    fireEvent.pointerMove(zone, { pointerId: 2, clientX: 100, clientY: 100 + STICK_R });
    expect(input.move.x).toBeCloseTo(1, 6);
    expect(input.move.y).toBeCloseTo(0, 6);

    // И отпускание чужого пальца не бросает джойстик.
    fireEvent.pointerUp(zone, { pointerId: 2 });
    expect(input.move.x).toBeCloseTo(1, 6);
  });
});

describe('ArenaPad — удар', () => {
  it('держится, пока держат кнопку', () => {
    const input = makeInput();
    const { kick, onKick } = mount('left', input);

    fireEvent.pointerDown(kick, { pointerId: 1 });
    expect(input.kick).toBe(true);
    expect(onKick).toHaveBeenCalledWith(true);

    fireEvent.pointerUp(kick, { pointerId: 1 });
    expect(input.kick).toBe(false);
    expect(onKick).toHaveBeenLastCalledWith(false);
  });

  it('не шлёт одно и то же состояние дважды', () => {
    const input = makeInput();
    const { kick, onKick } = mount('left', input);
    fireEvent.pointerDown(kick, { pointerId: 1 });
    fireEvent.pointerDown(kick, { pointerId: 2 });
    expect(onKick).toHaveBeenCalledTimes(1);
  });

  it('отпускается, когда приложение сворачивают', () => {
    // Палец уходит вместе со свёрнутым приложением, и pointerup не приходит
    // вовсе: без этого игрок вернулся бы к мячу, который бьют без остановки.
    const input = makeInput();
    const { zone, kick } = mount('left', input);
    drag(zone, 1, [100, 100], [180, 100]);
    fireEvent.pointerDown(kick, { pointerId: 2 });
    expect(input.kick).toBe(true);

    fireEvent(window, new Event('blur'));
    expect(input.move).toEqual({ x: 0, y: 0 });
    expect(input.kick).toBe(false);
  });
});

describe('две площадки на одном экране', () => {
  it('слушают свои пальцы одновременно и независимо', () => {
    // Та самая проверка, ради которой файл и написан.
    const left = makeInput();
    const right = makeInput();
    render(
      <>
        <ArenaPad side="left" input={left} onKickChange={vi.fn()}
          label="pad-left" kickLabel="kick-left" color="rgb(1 2 3)" />
        <ArenaPad side="right" input={right} onKickChange={vi.fn()}
          label="pad-right" kickLabel="kick-right" color="rgb(4 5 6)" />
      </>,
    );
    const zoneL = screen.getByLabelText('pad-left');
    const zoneR = screen.getByLabelText('pad-right');

    drag(zoneL, 1, [50, 400], [50 + STICK_R, 400]);   // левый — вправо
    drag(zoneR, 2, [300, 400], [300, 400 - STICK_R]); // правый — вверх

    expect(left.move.x).toBeCloseTo(1, 6);
    expect(left.move.y).toBeCloseTo(0, 6);
    expect(right.move.x).toBeCloseTo(0, 6);
    expect(right.move.y).toBeCloseTo(-1, 6);

    // Один отпустил — второй продолжает бежать.
    fireEvent.pointerUp(zoneL, { pointerId: 1 });
    expect(left.move).toEqual({ x: 0, y: 0 });
    expect(right.move.y).toBeCloseTo(-1, 6);
  });

  it('кнопки удара не путаются между собой', () => {
    const left = makeInput();
    const right = makeInput();
    render(
      <>
        <ArenaPad side="left" input={left} onKickChange={vi.fn()}
          label="pad-left" kickLabel="kick-left" color="rgb(1 2 3)" />
        <ArenaPad side="right" input={right} onKickChange={vi.fn()}
          label="pad-right" kickLabel="kick-right" color="rgb(4 5 6)" />
      </>,
    );
    fireEvent.pointerDown(screen.getByText('kick-right').closest('button')!, { pointerId: 9 });
    expect(right.kick).toBe(true);
    expect(left.kick).toBe(false);
  });
});
