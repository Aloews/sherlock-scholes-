import { useEffect, useRef, useState } from 'react';
import {
  kickoff,
  PITCH_H,
  PITCH_W,
  PLAYER_ACCEL,
  PLAYER_DAMPING,
  PLAYER_MAX_V,
  PLAYER_R,
  type ArenaState,
  type Inputs,
} from './physics';
import {
  INPUT_HZ,
  SnapshotBuffer,
  reconcile,
  toInputMessage,
  type Snapshot,
} from './net';
import type { ArenaNet } from './useArenaNet';

/**
 * Цикл гостя: он НЕ СЧИТАЕТ ФИЗИКУ.
 *
 * Авторитет один — хост, и это то, что делает онлайн возможным при задержке в
 * сотни миллисекунд. Гость только:
 *   1) рисует чужие тела и мяч по снимкам, интерполируя между двумя и потому
 *      отставая на INTERP_DELAY_MS;
 *   2) двигает СВОЮ ракетку локально, сразу, теми же правилами, что и хост, —
 *      иначе собственное управление ощущалось бы как залипание;
 *   3) стягивает её к присланной хостом позиции (reconcile), чтобы предсказание
 *      не расходилось с правдой.
 *
 * ПОЧЕМУ НЕ ОБЩИЙ ЦИКЛ С ХОСТОМ. У них разная работа: хост тратит время на
 * `step`, гость — на выборку из буфера. Сведение их в один хук дало бы ветвление
 * `if (isHost)` вокруг каждой строки, и ошибка в любой ветви была бы видна
 * только на втором телефоне.
 */
export function useArenaGuest(
  draw: (state: ArenaState) => void,
  net: ArenaNet,
): {
  stateRef: React.MutableRefObject<ArenaState>;
  inputsRef: React.MutableRefObject<Inputs>;
  score: { left: number; right: number };
  pushSnapshot: (snapshot: Snapshot) => void;
} {
  const stateRef = useRef<ArenaState>(kickoff());
  const inputsRef = useRef<Inputs>({
    left: { move: { x: 0, y: 0 }, kick: false },
    right: { move: { x: 0, y: 0 }, kick: false },
  });
  const bufferRef = useRef(new SnapshotBuffer());
  const [score, setScore] = useState({ left: 0, right: 0 });

  const drawRef = useRef(draw);
  drawRef.current = draw;
  const netRef = useRef(net);
  netRef.current = net;

  const pushSnapshot = useRef((snapshot: Snapshot) => {
    bufferRef.current.push(snapshot, performance.now());
  }).current;

  // Ввод уходит реже кадра: тридцать посылок в секунду хватает, чтобы
  // движение выглядело непрерывным, а шестьдесят — это вдвое больше трафика
  // за разницу, которой не видно.
  useEffect(() => {
    let seq = 0;
    const id = setInterval(() => {
      seq += 1;
      netRef.current.sendInput(toInputMessage(inputsRef.current.right, seq));
    }, 1000 / INPUT_HZ);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 0.25);
      last = now;

      const sample = bufferRef.current.sample(now);
      if (!sample) {
        // Ни одного снимка — рисуем начальную расстановку. Пустой холст
        // читался бы как «не загрузилось», хотя идёт обычное ожидание.
        drawRef.current(stateRef.current);
        return;
      }

      const state = stateRef.current;
      state.left.x = sample.lx;
      state.left.y = sample.ly;
      state.ball.x = sample.bx;
      state.ball.y = sample.by;

      // Своя ракетка — местное предсказание теми же правилами, что у хоста.
      predict(state.right, inputsRef.current.right.move, dt);
      const pulled = reconcile(
        { x: state.right.x, y: state.right.y },
        { x: sample.rx, y: sample.ry },
      );
      state.right.x = pulled.x;
      state.right.y = pulled.y;

      if (state.score.left !== sample.sl || state.score.right !== sample.sr) {
        state.score = { left: sample.sl, right: sample.sr };
        setScore({ left: sample.sl, right: sample.sr });
      }

      drawRef.current(state);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return { stateRef, inputsRef, score, pushSnapshot };
}

/**
 * Тот же разгон, потолок скорости и затухание, что в physics.step.
 *
 * ⚠️ Затухание задаётся ЗА СЕКУНДУ и берётся в степень dt — как в физике.
 * Применить его покадрово (умножить на 0.086 каждый кадр) значит остановить
 * игрока мгновенно; ровно этой ошибкой арена уже болела, только в другую
 * сторону, и на глаз это читается как «управление залипает».
 */
function predict(b: { x: number; y: number; vx: number; vy: number }, move: { x: number; y: number }, dt: number): void {
  const len = Math.hypot(move.x, move.y);
  if (len > 0) {
    const k = len > 1 ? 1 / len : 1;
    b.vx += move.x * k * PLAYER_ACCEL * dt;
    b.vy += move.y * k * PLAYER_ACCEL * dt;
  }
  const speed = Math.hypot(b.vx, b.vy);
  if (speed > PLAYER_MAX_V) {
    b.vx = (b.vx / speed) * PLAYER_MAX_V;
    b.vy = (b.vy / speed) * PLAYER_MAX_V;
  }
  const damp = Math.pow(PLAYER_DAMPING, dt);
  b.vx *= damp;
  b.vy *= damp;
  b.x = Math.min(PITCH_W - PLAYER_R, Math.max(PLAYER_R, b.x + b.vx * dt));
  b.y = Math.min(PITCH_H - PLAYER_R, Math.max(PLAYER_R, b.y + b.vy * dt));
}
