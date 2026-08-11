// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useArena, WIN_SCORE } from './useArena';
import { PITCH_W, BALL_R, type ArenaState } from './physics';

// Матч — это не физика. Физика знает, что мяч пересёк линию; матч знает, что
// после этого счёт растёт, игра замирает на секунду с небольшим, мяч
// возвращается в центр, а на пятом голе всё останавливается насовсем.
//
// Проверять это глазами значит играть до пяти голов после каждой правки.

/**
 * Ручной requestAnimationFrame.
 *
 * Настоящий ждёт кадра, а тесту нужно управлять ВРЕМЕНЕМ, а не ждать его:
 * пауза после гола длится 1400 мс, и высидеть её тридцать раз подряд —
 * полминуты на один прогон. Заодно шаг становится ровным, а не «сколько
 * успел браузер».
 */
function fakeRaf() {
  let now = 0;
  let queued: ((t: number) => void) | null = null;

  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    queued = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => { queued = null; });
  vi.stubGlobal('performance', { now: () => now });

  return {
    /** Прокрутить время кадрами по ms миллисекунд. */
    advance(total: number, stepMs = 16) {
      for (let left = total; left > 0; left -= stepMs) {
        now += Math.min(stepMs, left);
        const cb = queued;
        queued = null;
        cb?.(now);
      }
    },
  };
}

let raf: ReturnType<typeof fakeRaf>;

beforeEach(() => { raf = fakeRaf(); });
afterEach(() => { vi.unstubAllGlobals(); });

/** Поставить мяч так, чтобы следующий шаг засчитал гол в правые ворота. */
function shootIntoRightGoal(state: ArenaState) {
  state.ball.x = PITCH_W - BALL_R;
  state.ball.y = 180;
  state.ball.vx = 1200;
  state.ball.vy = 0;
}

function mount() {
  const draw = vi.fn();
  const hook = renderHook(() => useArena(draw));
  return { ...hook, draw };
}

describe('useArena', () => {
  it('рисует каждый кадр, даже когда ничего не происходит', () => {
    const { draw } = mount();
    act(() => raf.advance(160));
    // Пауза, гол, победа — всё это состояния, в которых картинка обязана
    // остаться живой. Цикл, который перестаёт рисовать «когда нечего
    // считать», замирает вместе с экраном.
    expect(draw.mock.calls.length).toBeGreaterThanOrEqual(8);
  });

  it('засчитывает гол, поднимает счёт и возвращает мяч в центр', () => {
    const { result } = mount();
    act(() => { shootIntoRightGoal(result.current.stateRef.current); raf.advance(48); });

    expect(result.current.score).toEqual({ left: 1, right: 0 });
    expect(result.current.celebrating).toBe('left');

    // Во время паузы мяч намеренно остаётся там, где влетел: замерший кадр —
    // это и есть повтор гола.
    expect(result.current.stateRef.current.ball.x).toBeGreaterThan(PITCH_W);

    act(() => raf.advance(1600));
    expect(result.current.celebrating).toBeNull();
    expect(result.current.stateRef.current.ball.x).toBe(PITCH_W / 2);
    expect(result.current.stateRef.current.score).toEqual({ left: 1, right: 0 });
  });

  it('не считает один гол дважды', () => {
    const { result } = mount();
    act(() => { shootIntoRightGoal(result.current.stateRef.current); raf.advance(48); });
    // Мяч всё ещё за линией, и без паузы следующий кадр засчитал бы его снова
    // — и снова, пока не кончится матч.
    act(() => raf.advance(400));
    expect(result.current.score).toEqual({ left: 1, right: 0 });
  });

  it('во время паузы симуляция стоит', () => {
    const { result } = mount();
    act(() => { shootIntoRightGoal(result.current.stateRef.current); raf.advance(48); });
    const frozen = { ...result.current.stateRef.current.ball };
    act(() => raf.advance(600));
    expect(result.current.stateRef.current.ball.x).toBe(frozen.x);
  });

  it('останавливает матч на пятом голе', () => {
    const { result } = mount();
    for (let i = 0; i < WIN_SCORE; i++) {
      act(() => { shootIntoRightGoal(result.current.stateRef.current); raf.advance(48); });
      act(() => raf.advance(1600));
    }
    expect(result.current.score.left).toBe(WIN_SCORE);
    expect(result.current.winner).toBe('left');

    // После победы мяч не двигается, сколько кадров ни пришло.
    result.current.stateRef.current.ball.vx = 500;
    const at = result.current.stateRef.current.ball.x;
    act(() => raf.advance(1000));
    expect(result.current.stateRef.current.ball.x).toBe(at);
  });

  it('restart возвращает всё в ноль', () => {
    const { result } = mount();
    act(() => { shootIntoRightGoal(result.current.stateRef.current); raf.advance(48); });
    act(() => { result.current.restart(); });

    expect(result.current.score).toEqual({ left: 0, right: 0 });
    expect(result.current.celebrating).toBeNull();
    expect(result.current.winner).toBeNull();
    expect(result.current.stateRef.current.ball.x).toBe(PITCH_W / 2);

    act(() => raf.advance(200));
    expect(result.current.stateRef.current.ball.x).toBe(PITCH_W / 2);
  });

  it('restart обнуляет ввод НА МЕСТЕ, не подменяя объект', () => {
    // Площадки управления держат ссылку на inputsRef.current.left и пишут в
    // неё напрямую. Подмена объекта на новый отрезала бы их от цикла молча:
    // после «ещё раз» игра просто перестала бы слушаться, без единой ошибки.
    const { result } = mount();
    const held = result.current.inputsRef.current;
    const heldLeft = held.left;

    heldLeft.move = { x: 1, y: 0 };
    heldLeft.kick = true;
    act(() => { result.current.restart(); });

    expect(result.current.inputsRef.current).toBe(held);
    expect(result.current.inputsRef.current.left).toBe(heldLeft);
    expect(heldLeft.move).toEqual({ x: 0, y: 0 });
    expect(heldLeft.kick).toBe(false);
  });

  it('не доигрывает за игрока время, пока приложение было свёрнуто', () => {
    // Кадр после возвращения приносит разрыв в полминуты. Досчитать его
    // значило бы прокрутить полматча, которого никто не видел; цикл
    // ограничивает кадр и теряет остальное.
    const { result } = mount();
    act(() => raf.advance(32));
    result.current.stateRef.current.ball.vx = 100;
    const before = result.current.stateRef.current.ball.x;

    act(() => raf.advance(30_000, 30_000)); // один кадр длиной в полминуты
    const travelled = result.current.stateRef.current.ball.x - before;

    // 100 px/с за потолок в 0.25 с — самое большее 25 пикселей, а не 3000.
    expect(travelled).toBeGreaterThan(0);
    expect(travelled).toBeLessThan(30);
  });

  it('снимает кадр с очереди при размонтировании', () => {
    const { draw, unmount } = mount();
    act(() => raf.advance(48));
    const before = draw.mock.calls.length;
    unmount();
    act(() => raf.advance(160));
    expect(draw.mock.calls.length).toBe(before);
  });
});
