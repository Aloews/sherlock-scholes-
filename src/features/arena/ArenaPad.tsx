import { useEffect, useRef } from 'react';
import { hapticImpact } from '@/shared/lib/telegram';
import type { PlayerInput } from './physics';

/**
 * Управление одного игрока: джойстик и удар.
 *
 * ПИШЕТ ПРЯМО В REF, А НЕ В СОСТОЯНИЕ REACT. Палец двигается непрерывно, и
 * setState на каждое движение перерисовывал бы дерево десятки раз в секунду —
 * ради двух чисел, которые нужны только игровому циклу. Ручка джойстика по
 * той же причине двигается прямым transform, а не рендером.
 *
 * ПАЛЬЦЕВ ДВА, И ОНИ ОДНОВРЕМЕННЫЕ. Играют вдвоём на одном телефоне: до
 * четырёх касаний живут на экране сразу. Поэтому pointer events с
 * setPointerCapture и разбором по pointerId — обработчик на весь экран,
 * который помнит «текущее касание», отдал бы оба джойстика тому, кто нажал
 * последним.
 */

/** Радиус, на котором джойстик даёт полный ход. */
const STICK_R = 46;

interface ArenaPadProps {
  side: 'left' | 'right';
  /** Куда класть ввод. Тот же объект читает игровой цикл. */
  input: PlayerInput;
  /** Смена состояния кнопки удара — экран рисует по ней кольцо заряда. */
  onKickChange(down: boolean): void;
  label: string;
  kickLabel: string;
  color: string;
}

export function ArenaPad({ side, input, onKickChange, label, kickLabel, color }: ArenaPadProps) {
  const zoneRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  // Касание, которое ведёт джойстик, и точка, где оно началось. Джойстик
  // ОТНОСИТЕЛЬНЫЙ: центр там, где палец опустился, а не в середине площадки —
  // иначе первое движение всегда рывок к центру.
  const stick = useRef<{ id: number; x: number; y: number } | null>(null);

  const moveKnob = (dx: number, dy: number) => {
    const knob = knobRef.current;
    if (knob) knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };

  // Отпускание — ОДНО НА ВСЕ ПРИЧИНЫ: палец убрали, приложение свернули,
  // экран размонтировали. Пока прятание ручки жило только в обработчике
  // pointerup, свёрнутое приложение возвращалось с ручкой, висящей посреди
  // площадки без пальца.
  const release = () => {
    stick.current = null;
    input.move = { x: 0, y: 0 };
    input.kick = false;
    moveKnob(0, 0);
    if (knobRef.current) knobRef.current.style.opacity = '0';
    onKickChange(false);
  };

  // Палец может уйти вместе со свёрнутым приложением, и тогда pointerup не
  // придёт вовсе — игрок побежит в стену навсегда. Это дешевле предусмотреть,
  // чем объяснять.
  useEffect(() => {
    const stop = () => release();
    window.addEventListener('blur', stop);
    document.addEventListener('visibilitychange', stop);
    return () => {
      window.removeEventListener('blur', stop);
      document.removeEventListener('visibilitychange', stop);
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stick.current) return; // джойстик уже ведёт другой палец
    e.currentTarget.setPointerCapture(e.pointerId);
    stick.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    moveKnob(0, 0);
    // Ручка появляется под пальцем — она скрыта, пока джойстика нет.
    const knob = knobRef.current;
    const zone = zoneRef.current;
    if (knob && zone) {
      const box = zone.getBoundingClientRect();
      knob.style.left = `${e.clientX - box.left}px`;
      knob.style.top = `${e.clientY - box.top}px`;
      knob.style.opacity = '1';
    }
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = stick.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    const dist = Math.hypot(dx, dy);
    const clamped = Math.min(dist, STICK_R);
    const k = dist > 0 ? clamped / dist : 0;
    moveKnob(dx * k, dy * k);
    // Наружу уходит доля от полного хода: физика сама нормализует длину, но
    // ждёт 0..1, а не пиксели.
    input.move = { x: (dx * k) / STICK_R, y: (dy * k) / STICK_R };
  };

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stick.current?.id !== e.pointerId) return;
    release();
    if (knobRef.current) knobRef.current.style.opacity = '0';
  };

  const setKick = (down: boolean) => {
    if (input.kick === down) return;
    input.kick = down;
    onKickChange(down);
    if (down) hapticImpact('light');
  };

  // Кнопка удара — с внутренней стороны, джойстик с внешней: телефон держат
  // вдвоём за края, и большой палец каждого приходит со своего края.
  const stickFirst = side === 'left';

  return (
    <div className={`flex-1 flex items-stretch gap-2 ${stickFirst ? '' : 'flex-row-reverse'}`}>
      <div
        ref={zoneRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        // touch-none обязателен: без него браузер считает то же движение
        // прокруткой и джойстик перестаёт получать события на середине жеста.
        className="relative flex-1 min-h-[132px] rounded-2xl border border-brand-border bg-brand-surface/60 touch-none select-none overflow-hidden"
        aria-label={label}
      >
        <span className="absolute inset-x-0 top-2 text-center text-[10px] uppercase tracking-wider text-brand-muted pointer-events-none">
          {label}
        </span>
        <div
          ref={knobRef}
          aria-hidden
          className="absolute w-11 h-11 -ml-[22px] -mt-[22px] rounded-full pointer-events-none opacity-0 transition-opacity duration-100"
          style={{ background: color, boxShadow: `0 0 0 2px ${color}` }}
        />
      </div>

      <button
        type="button"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setKick(true); }}
        onPointerUp={() => setKick(false)}
        onPointerCancel={() => setKick(false)}
        onContextMenu={(e) => e.preventDefault()}
        className="w-[74px] shrink-0 rounded-2xl border border-brand-border bg-brand-surface/60 touch-none select-none flex flex-col items-center justify-center gap-1 active:bg-brand-surface"
        style={{ color }}
      >
        <span className="w-8 h-8 rounded-full" style={{ background: color }} aria-hidden />
        <span className="text-[10px] uppercase tracking-wider text-brand-muted">{kickLabel}</span>
      </button>
    </div>
  );
}
