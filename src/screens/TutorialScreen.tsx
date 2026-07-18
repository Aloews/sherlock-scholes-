import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import type { PanInfo } from 'framer-motion';
import { cloudSet } from '@/shared/lib/telegram';
import {
  IconUsers,
  IconUserPlus,
  IconUsersGroup,
  IconCards,
  IconMicrophone,
  IconTrophy,
} from '@tabler/icons-react';

const ICONS = [IconUsers, IconUserPlus, IconUsersGroup, IconCards, IconMicrophone, IconTrophy];
const TOTAL = 6;
const SWIPE_THRESHOLD = 100;

const slideVariants = {
  enter: (dir: number) => ({ x: dir * 100, opacity: 0 }),
  center:              { x: 0,           opacity: 1 },
  exit:  (dir: number) => ({ x: dir * -100, opacity: 0 }),
};

export function TutorialScreen() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [current,   setCurrent]   = useState(0);
  const [direction, setDirection] = useState(1);

  const go = (next: number) => {
    if (next < 0 || next >= TOTAL) return;
    setDirection(next > current ? 1 : -1);
    setCurrent(next);
  };

  const finish = () => {
    // CloudStorage survives Telegram relaunches; localStorage is the fast
    // same-launch cache (see the check in HomeScreen).
    void cloudSet('sherlock_tutorial_seen', 'true');
    try { localStorage.setItem('sherlock_tutorial_seen', 'true'); } catch { /* private mode */ }
    navigate('/');
  };

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    // Swiping left past the last slide finishes the tutorial (same as the
    // Finish button) instead of dead-ending, since go() ignores next >= TOTAL.
    if (info.offset.x < -SWIPE_THRESHOLD) {
      if (current === TOTAL - 1) finish();
      else go(current + 1);
    } else if (info.offset.x > SWIPE_THRESHOLD) {
      go(current - 1);
    }
  };

  const Icon = ICONS[current];
  const isLast = current === TOTAL - 1;

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col">
      {/* Skip — finishes the tutorial from any slide (same finish() as the
          last-slide button / left-swipe). Hidden on the last slide where the
          primary action is already "Finish". */}
      {!isLast && (
        <div className="flex justify-end px-6 pt-6">
          <button
            onClick={finish}
            className="text-sm font-medium text-brand-muted hover:text-white transition-colors"
          >
            {t('tutorial.skip')}
          </button>
        </div>
      )}
      <div className="flex-1 flex flex-col items-center justify-center px-6 overflow-hidden">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={current}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.25, ease: 'easeOut' }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.15}
            onDragEnd={handleDragEnd}
            className="flex flex-col items-center text-center max-w-xs w-full select-none cursor-grab active:cursor-grabbing"
          >
            <Icon size={64} stroke={1.5} className="text-brand-accent" />
            <h2 className="text-3xl font-black text-white mt-6">
              {t(`tutorial.title_${current + 1}`)}
            </h2>
            <p className="text-base text-brand-muted mt-4 max-w-xs leading-relaxed">
              {t(`tutorial.text_${current + 1}`)}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Dot indicators */}
      <div className="flex justify-center gap-2 pb-6">
        {Array.from({ length: TOTAL }).map((_, i) => (
          <button
            key={i}
            onClick={() => go(i)}
            className={`w-2 h-2 rounded-full transition-colors ${
              i === current ? 'bg-brand-accent' : 'bg-brand-border'
            }`}
          />
        ))}
      </div>

      {/* Nav buttons */}
      <div className="flex gap-3 px-6 pb-10">
        <button
          disabled={current === 0}
          onClick={() => go(current - 1)}
          className="flex-1 py-3 rounded-2xl border border-brand-border text-brand-muted font-bold disabled:opacity-30 transition-opacity"
        >
          ← {t('tutorial.back')}
        </button>
        {isLast ? (
          <button
            onClick={finish}
            className="flex-1 py-3 rounded-2xl bg-brand-accent text-brand-bg font-black"
          >
            {t('tutorial.finish')}
          </button>
        ) : (
          <button
            onClick={() => go(current + 1)}
            className="flex-1 py-3 rounded-2xl bg-brand-accent text-brand-bg font-bold"
          >
            {t('tutorial.next')} →
          </button>
        )}
      </div>
    </div>
  );
}
