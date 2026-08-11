import { useCallback, useEffect, useRef, useState } from 'react';
import { kickoff, scored, step, type ArenaState, type Inputs } from './physics';

/**
 * Игровой цикл арены.
 *
 * ЗДЕСЬ ЖИВЁТ ВРЕМЯ, а в physics.ts — только правила. Разделение не
 * косметическое: шаг симуляции обязан получать маленький и предсказуемый dt,
 * а откуда он такой берётся — вопрос цикла, а не физики.
 *
 * СОСТОЯНИЕ ЛЕЖИТ В REF, НЕ В useState. Шестьдесят раз в секунду вызывать
 * setState значит шестьдесят раз в секунду перерисовывать дерево React ради
 * одного canvas, который перерисовал бы себя сам. Через useState проходит
 * только то, что меняется по событию: счёт, баннер гола, победитель.
 */

/** До скольки играем. Пять — это минуты три, ровно один перерыв. */
export const WIN_SCORE = 5;

/**
 * Шаг симуляции фиксирован, а не равен кадру.
 *
 * Иначе физика зависит от телефона: на 120 Гц столкновения считаются вдвое
 * чаще и мяч отскакивает иначе, чем на 60 Гц. Кадр только НАКАПЛИВАЕТ время,
 * а тратится оно всегда порциями по 1/60.
 */
const FIXED_DT = 1 / 60;

/**
 * Сколько времени кадр имеет право принести.
 *
 * Свёрнутая вкладка возвращается с разрывом в полминуты. Без потолка цикл
 * попытается досчитать 1800 шагов в одном кадре — телефон замрёт, а мяч
 * окажется где угодно. Пропущенное время ПРОСТО ТЕРЯЕТСЯ: доигрывать за
 * игрока полминуты матча — хуже, чем не доиграть.
 */
const MAX_FRAME = 0.25;

/** Пауза после гола: увидеть счёт и вернуться на свою половину. */
const GOAL_PAUSE_MS = 1400;

export type Side = 'left' | 'right';

export interface Arena {
  /** Текущее состояние. Читает только отрисовка — по кадру, а не по рендеру. */
  stateRef: React.MutableRefObject<ArenaState>;
  /** Куда экран КЛАДЁТ ввод. Цикл читает его сам, React в этом не участвует. */
  inputsRef: React.MutableRefObject<Inputs>;
  score: { left: number; right: number };
  /** Кто только что забил — пока висит баннер. */
  celebrating: Side | null;
  winner: Side | null;
  restart(): void;
}

export function useArena(draw: (state: ArenaState) => void): Arena {
  const stateRef = useRef<ArenaState>(kickoff());
  // Свои объекты move, а не общий из IDLE: площадки управления присваивают
  // move целиком, но одна опечатка в них — и общий ноль стал бы «бежать
  // вправо» сразу у обоих игроков.
  const inputsRef = useRef<Inputs>({
    left: { move: { x: 0, y: 0 }, kick: false },
    right: { move: { x: 0, y: 0 }, kick: false },
  });

  const [score, setScore] = useState({ left: 0, right: 0 });
  const [celebrating, setCelebrating] = useState<Side | null>(null);
  const [winner, setWinner] = useState<Side | null>(null);

  // Цикл читает их, но не должен из-за них перезапускаться: пересоздать rAF на
  // каждом голе значит потерять накопленное время и дёрнуть картинку.
  const frozenUntil = useRef(0);
  const stopped = useRef(false);

  // Отрисовка приходит из экрана и меняется на каждом его рендере. Через ref —
  // чтобы цикл не перезапускался вместе с ней.
  const drawRef = useRef(draw);
  drawRef.current = draw;

  const restart = useCallback(() => {
    stateRef.current = kickoff();
    // ОБНУЛЯЕТСЯ НА МЕСТЕ, а не заменяется новым объектом: площадки управления
    // держат ссылку на этот же и пишут в неё напрямую. Подмена объекта тихо
    // отрезала бы их от цикла — управление после «ещё раз» перестало бы
    // работать, и без единой ошибки в консоли.
    for (const side of ['left', 'right'] as const) {
      inputsRef.current[side].move = { x: 0, y: 0 };
      inputsRef.current[side].kick = false;
    }
    frozenUntil.current = 0;
    stopped.current = false;
    setScore({ left: 0, right: 0 });
    setCelebrating(null);
    setWinner(null);
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let carry = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);

      const elapsed = Math.min((now - last) / 1000, MAX_FRAME);
      last = now;

      // ТРИ ВЗАИМОИСКЛЮЧАЮЩИХ СОСТОЯНИЯ КАДРА, и они разнесены по ветвям
      // намеренно. Сначала пауза проверялась флагом, снятым в начале кадра, а
      // гол назначал её ниже по тому же кадру — и «пауза кончилась» срабатывало
      // мгновенно после гола: счёт рос, а надпись ГОЛ не появлялась ни разу.
      // Флаг был прав на момент, когда его считали, и устарел через двадцать
      // строк.
      if (frozenUntil.current > 0) {
        if (now < frozenUntil.current) {
          // Пауза. Время не копится — иначе после неё мяч рванул бы вперёд на
          // всю её длину.
          carry = 0;
        } else {
          frozenUntil.current = 0;
          stateRef.current = kickoff(stateRef.current.score);
          setCelebrating(null);
        }
      } else if (!stopped.current) {
        carry += elapsed;
        // Остаток переносится на следующий кадр, а не округляется: без этого
        // при 59.7 Гц матч шёл бы медленнее реального времени, и заметить
        // такое можно только секундомером.
        while (carry >= FIXED_DT) {
          carry -= FIXED_DT;
          stateRef.current = step(stateRef.current, inputsRef.current, FIXED_DT);

          const goal = scored(stateRef.current);
          if (!goal) continue;

          const next = {
            left: stateRef.current.score.left + (goal === 'left' ? 1 : 0),
            right: stateRef.current.score.right + (goal === 'right' ? 1 : 0),
          };
          // Расстановка ставится СРАЗУ, а показывается после паузы: замерший
          // кадр с мячом в сетке — это и есть повтор гола.
          stateRef.current = { ...kickoff(next), ball: stateRef.current.ball };
          setScore(next);
          setCelebrating(goal);
          frozenUntil.current = now + GOAL_PAUSE_MS;
          carry = 0;

          if (next[goal] >= WIN_SCORE) {
            stopped.current = true;
            setWinner(goal);
          }
          break;
        }
      }

      // Матч окончен — третья ветвь, и в ней нечего делать: состояние
      // замерло, а рисовать его всё равно надо, поэтому она пустая, а не
      // выходит из кадра.

      drawRef.current(stateRef.current);
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return { stateRef, inputsRef, score, celebrating, winner, restart };
}
