import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { useTraining, type Team } from '@/features/game/useTraining';
import { playSound } from '@/shared/lib/sounds';
import { PlayerCard } from '@/shared/ui/PlayerCard';
import { Button } from '@/shared/ui/Button';
import type { CardCategory } from '@/shared/types/database';

interface TrainingState {
  categories: CardCategory[] | null;
}

const TEAM_COLOR: Record<Team, string> = {
  orange: '#FF6300',
  blue:   '#4A9EFF',
};

export function TrainingScreen() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { t }     = useTranslation();

  const state      = location.state as TrainingState | null;
  const categories = state?.categories ?? null;

  const { currentCard, loading, scores, activeTeam, guess, skip, passTurn } =
    useTraining(categories);

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

  const renderTeam = (team: Team) => {
    const active = activeTeam === team;
    const color  = TEAM_COLOR[team];
    return (
      <div
        className="flex-1 rounded-2xl px-3 py-2.5 border transition-all text-center"
        style={
          active
            ? { borderColor: color, backgroundColor: `${color}1f` }
            : { borderColor: 'transparent', backgroundColor: 'rgba(255,255,255,0.04)' }
        }
      >
        <p
          className="text-xs font-semibold uppercase tracking-wide truncate"
          style={{ color: active ? color : undefined }}
        >
          {t(`quick.team_${team}`)}
        </p>
        <p
          className="text-3xl font-black leading-tight"
          style={{ color: active ? color : '#6b7280' }}
        >
          {scores[team]}
        </p>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-8 pb-3 border-b border-brand-border">
        <button
          className="text-brand-muted hover:text-white transition-colors text-sm p-1 -ml-1"
          onClick={() => navigate('/')}
        >
          {t('quick.finish')}
        </button>
        <p className="text-brand-muted text-xs uppercase tracking-wider">
          {t('home.mode_training_title')}
        </p>
        <span className="w-16" />
      </div>

      {/* Scoreboard */}
      <div className="flex items-stretch gap-2 px-4 pt-4">
        {renderTeam('orange')}
        {renderTeam('blue')}
      </div>

      {/* Pass turn */}
      <div className="px-4 pt-3">
        <Button
          fullWidth
          variant="secondary"
          onClick={() => { playSound('whistle_start'); passTurn(); }}
          disabled={!currentCard}
        >
          {t('quick.pass_turn')} →
        </Button>
      </div>

      {/* Card area */}
      <div className="flex-1 flex flex-col justify-center px-4 py-4">
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
      <div className="px-4 pb-8 flex gap-3">
        <Button
          size="lg"
          disabled={!currentCard}
          className="flex-1 text-white"
          style={{ backgroundColor: TEAM_COLOR[activeTeam] }}
          onClick={() => { playSound('correct'); guess(); }}
        >
          {t('quick.guessed')}
        </Button>
        <Button
          size="lg"
          variant="secondary"
          className="flex-1"
          disabled={!currentCard}
          onClick={() => { playSound('skip'); skip(); }}
        >
          {t('quick.skip')}
        </Button>
      </div>
    </div>
  );
}
