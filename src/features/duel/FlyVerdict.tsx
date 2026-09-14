import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { Outcome } from './forecastApi';

/**
 * Муха думает — летает между командами; решила — садится на победителя.
 *
 * Владелец: «пусть муха когда думает летает между командами, а когда приняла
 * решение, то красиво приземляется на победителя и даёт другие данные».
 *
 * ⚠️ АНИМАЦИЯ НИЧЕГО НЕ РЕШАЕТ И НИЧЕГО НЕ СЧИТАЕТ. Исход уже назван ночным
 * прогоном и лежит в базе; полёт — это показ уже принятого решения, а не его
 * имитация. Делать вид, что мозг думает прямо сейчас, значило бы врать
 * картинкой: настоящее решение принято на настоящих связях, но раньше.
 *
 * ⚠️ ПРИ `prefers-reduced-motion` МУХА НЕ ЛЕТАЕТ ВООБЩЕ, а сразу сидит на
 * ответе. Это не «упрощённая версия»: для человека, которому движение мешает,
 * прыгающая по экрану точка — не украшение, а помеха.
 */

interface FlyVerdictProps {
  home: string;
  away: string;
  /** Что назвала муха. null — прогноза нет, и тогда мухи тоже нет. */
  pick: Outcome | null;
  /** Отрыв первого варианта от второго, 0..1. */
  confidence: number | null;
  /** Крутить полёт заново по нажатию. */
  replayKey?: number;
}

/** Куда садиться: доли ширины полосы. */
const SEAT: Record<Outcome, number> = { H: 0.12, D: 0.5, A: 0.88 };

/** Сколько думает, прежде чем сесть. */
const THINK_MS = 1700;

export function FlyVerdict({ home, away, pick, confidence, replayKey = 0 }: FlyVerdictProps) {
  const reduced = useReducedMotion();
  const [landed, setLanded] = useState(reduced || !pick);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (reduced || !pick) { setLanded(true); return; }
    setLanded(false);
    timer.current = setTimeout(() => setLanded(true), THINK_MS);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [pick, replayKey, reduced]);

  const seat = pick ? SEAT[pick] : 0.5;

  // ⚠️ ПУТЬ РАЗДУМЬЯ НЕ СЛУЧАЙНЫЙ И НЕ БЕСКОНЕЧНЫЙ: три прохода между
  // командами и посадка. Случайное блуждание выглядело бы как «зависла», а
  // бесконечное — как «никогда не решит».
  const path = useMemo(() => ({
    x: ['12%', '88%', '12%', '88%', `${seat * 100}%`],
    y: [0, -10, 4, -8, 0],
    rotate: [0, 12, -10, 8, 0],
  }), [seat]);

  if (!pick) return null;

  return (
    <div className="relative h-12 select-none" aria-live="polite">
      {/* Полоса: хозяева слева, ничья посередине, гости справа. */}
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between
                      text-[11px] leading-tight">
        <span className={`max-w-[38%] truncate ${landed && pick === 'H'
          ? 'text-white font-semibold' : 'text-brand-muted'}`}>{home}</span>
        <span className={`${landed && pick === 'D'
          ? 'text-white font-semibold' : 'text-brand-muted'}`}>×</span>
        <span className={`max-w-[38%] truncate text-right ${landed && pick === 'A'
          ? 'text-white font-semibold' : 'text-brand-muted'}`}>{away}</span>
      </div>

      <motion.div
        className="absolute top-0"
        style={{ translateX: '-50%' }}
        initial={reduced ? false : { left: '12%', y: 0, rotate: 0 }}
        animate={landed
          ? { left: `${seat * 100}%`, y: 0, rotate: 0, scale: 1 }
          : { left: path.x, y: path.y, rotate: path.rotate, scale: 1 }}
        transition={landed
          ? { type: 'spring', stiffness: 260, damping: 18 }
          : { duration: THINK_MS / 1000, ease: 'easeInOut', times: [0, 0.25, 0.5, 0.75, 1] }}
      >
        <FlyGlyph flapping={!landed} />
      </motion.div>

      {landed && confidence != null && (
        <motion.span
          className="absolute -top-0.5 text-[10px] text-brand-muted"
          style={{ left: `${seat * 100}%`, translateX: '-50%' }}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: -12 }}
          transition={{ delay: 0.15 }}
        >
          {Math.round(confidence * 100)}%
        </motion.span>
      )}
    </div>
  );
}

/** Сама муха: тельце, два крыла, шесть ног. Крылья дрожат только в полёте. */
function FlyGlyph({ flapping }: { flapping: boolean }) {
  return (
    <svg width="22" height="18" viewBox="0 0 22 18" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="0.9" className="text-brand-muted"
         strokeLinecap="round" fill="none">
        <path d="M8 12 L5 16 M10 12.5 L9 17 M12 12.5 L13 17" />
        <path d="M8 11 L4 13 M13 11 L17 13" />
      </g>
      <motion.ellipse
        cx="7.5" cy="6" rx="5" ry="2.6" fill="currentColor"
        className="text-sky-200/70"
        style={{ originX: '100%', originY: '100%' }}
        animate={flapping ? { rotate: [-18, 12, -18], opacity: [0.5, 0.85, 0.5] }
                          : { rotate: -24, opacity: 0.55 }}
        transition={flapping ? { duration: 0.14, repeat: Infinity } : { duration: 0.2 }}
      />
      <motion.ellipse
        cx="14" cy="6" rx="5" ry="2.6" fill="currentColor"
        className="text-sky-200/70"
        style={{ originX: '0%', originY: '100%' }}
        animate={flapping ? { rotate: [18, -12, 18], opacity: [0.5, 0.85, 0.5] }
                          : { rotate: 24, opacity: 0.55 }}
        transition={flapping ? { duration: 0.14, repeat: Infinity } : { duration: 0.2 }}
      />
      <ellipse cx="11" cy="9" rx="3.6" ry="4" fill="currentColor" className="text-amber-300" />
      <circle cx="11" cy="4.6" r="2.4" fill="currentColor" className="text-amber-200" />
      <circle cx="9.7" cy="4.1" r="0.9" fill="currentColor" className="text-red-400" />
      <circle cx="12.3" cy="4.1" r="0.9" fill="currentColor" className="text-red-400" />
    </svg>
  );
}
