import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { useTraining } from '@/features/game/useTraining';
import { playSound } from '@/shared/lib/sounds';
import { PlayerCard } from '@/shared/ui/PlayerCard';
import { Button } from '@/shared/ui/Button';
import type { CardCategory } from '@/shared/types/database';

interface TrainingState {
  categories: CardCategory[] | null;
}

export function TrainingScreen() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { t }     = useTranslation();

  const state      = location.state as TrainingState | null;
  const categories = state?.categories ?? null;

  const { currentCard, index, loading, next } = useTraining(categories);

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center">
        <div className="text-brand-muted text-center">
          <div className="text-4xl mb-3 animate-pulse">⚽</div>
          <p>{t('app.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col">
      {/* Minimal header */}
      <div className="flex items-center justify-between px-4 pt-8 pb-3 border-b border-brand-border">
        <button
          className="text-brand-muted hover:text-white transition-colors text-sm p-1 -ml-1"
          onClick={() => navigate('/')}
        >
          ← {t('training.finish')}
        </button>
        <p className="text-brand-muted text-xs uppercase tracking-wider">
          {t('home.mode_training_title')}
        </p>
        <p className="text-brand-muted text-xs font-medium w-16 text-right">
          {t('training.card_n', { n: index + 1 })}
        </p>
      </div>

      {/* Card area */}
      <div className="flex-1 flex flex-col justify-center px-4 py-6">
        <AnimatePresence mode="wait">
          {currentCard ? (
            <motion.div
              key={currentCard.id}
              initial={{ x: 64, opacity: 0 }}
              animate={{ x: 0,  opacity: 1 }}
              exit={{ x: -64,   opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeInOut' }}
            >
              <PlayerCard card={currentCard} mode="explainer" />
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <div className="rounded-2xl bg-brand-surface border border-brand-border p-10 text-center">
                <div className="text-5xl mb-4">🃏</div>
                <p className="text-brand-muted">{t('training.no_cards')}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Actions */}
      <div className="px-4 pb-8 space-y-3">
        <Button
          fullWidth
          size="lg"
          disabled={!currentCard}
          onClick={() => { playSound('swipe'); next(); }}
        >
          {t('training.next')}
        </Button>
        <Button
          fullWidth
          variant="ghost"
          onClick={() => navigate('/')}
        >
          {t('training.finish')}
        </Button>
      </div>
    </div>
  );
}
