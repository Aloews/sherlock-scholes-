import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { IconArrowsExchange, IconChevronsRight, IconBrandGoogle } from '@tabler/icons-react';
import { useTraining, type Team } from '@/features/game/useTraining';
import { playSound } from '@/shared/lib/sounds';
import { PlayerCard } from '@/shared/ui/PlayerCard';
import { Button } from '@/shared/ui/Button';
import type { CardCategory } from '@/shared/types/database';
import { CATEGORY_LABEL_RU } from '@/shared/types/database';

interface TrainingState {
  categories: CardCategory[] | null;
}

const TEAM_COLOR: Record<Team, string> = {
  orange: '#FF6300',
  blue:   '#4A9EFF',
};

const CATEGORY_COLOR: Record<CardCategory, string> = {
  player:        '#FF6300',
  club:          '#4A9EFF',
  club_nickname: '#4A9EFF',
  stadium:       '#00C97D',
  term:          '#B47AFF',
  position:      '#B47AFF',
  referee:       '#FFD24A',
  coach:         '#FFD24A',
  commentator:   '#7A8499',
  woman:         '#FF6BA8',
};

const googleSearch = (name: string) => {
  const q   = encodeURIComponent(`${name} football wiki`);
  const url = `https://www.google.com/search?q=${q}`;
  const tg  = window.Telegram?.WebApp as { openLink?: (url: string) => void } | undefined;
  if (tg?.openLink) tg.openLink(url);
  else window.open(url, '_blank');
};

/** Outer wrapper — holds the remount key so "Play again" starts a fresh game. */
export function TrainingScreen() {
  const location = useLocation();
  const state    = location.state as TrainingState | null;
  const categories = state?.categories ?? null;

  const [gameKey, setGameKey] = useState(0);

  return (
    <TrainingGame
      key={gameKey}
      categories={categories}
      onPlayAgain={() => setGameKey((k) => k + 1)}
    />
  );
}

interface TrainingGameProps {
  categories: CardCategory[] | null;
  onPlayAgain: () => void;
}

function TrainingGame({ categories, onPlayAgain }: TrainingGameProps) {
  const navigate = useNavigate();
  const { t }    = useTranslation();

  const { currentCard, loading, scores, activeTeam, history, guess, skip, passTurn } =
    useTraining(categories);

  const [finished, setFinished] = useState(false);

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

  // ── Summary screen ──────────────────────────────────────────────
  if (finished) {
    return (
      <div className="min-h-screen bg-brand-bg flex flex-col">
        {/* Header */}
        <div className="px-4 pt-8 pb-4 border-b border-brand-border">
          <h1 className="text-2xl font-black text-white text-center">
            {t('quick.summary_title')}
          </h1>
        </div>

        {/* Final score */}
        <div className="flex items-center justify-center gap-3 px-4 pt-6">
          <span className="text-4xl font-black" style={{ color: TEAM_COLOR.orange }}>
            {scores.orange}
          </span>
          <span className="text-3xl font-black text-brand-muted">:</span>
          <span className="text-4xl font-black" style={{ color: TEAM_COLOR.blue }}>
            {scores.blue}
          </span>
        </div>
        <div className="flex items-center justify-center gap-3 px-4 pt-1 text-xs uppercase tracking-wide">
          <span style={{ color: TEAM_COLOR.orange }}>{t('quick.team_orange')}</span>
          <span className="text-brand-muted">:</span>
          <span style={{ color: TEAM_COLOR.blue }}>{t('quick.team_blue')}</span>
        </div>

        {/* Card history */}
        <div className="flex-1 px-4 pt-6 pb-4 overflow-y-auto">
          <p className="text-brand-muted text-sm uppercase tracking-wider mb-3">
            {t('quick.history_title')}
          </p>

          {history.length === 0 ? (
            <div className="rounded-2xl bg-brand-surface border border-brand-border p-8 text-center">
              <p className="text-brand-muted">{t('quick.history_empty')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((entry, i) => {
                const catColor = CATEGORY_COLOR[entry.category] ?? '#7A8499';
                const guessed  = entry.status === 'guessed';
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 bg-brand-surface border border-brand-border rounded-2xl px-3 py-2.5"
                  >
                    <div className="flex-1 min-w-0">
                      <span
                        className="text-[11px] uppercase tracking-widest font-medium"
                        style={{ color: catColor }}
                      >
                        {CATEGORY_LABEL_RU[entry.category] ?? entry.category}
                      </span>
                      <p className="text-lg font-semibold text-white leading-snug truncate">
                        {entry.name}
                      </p>
                      <span
                        className={`text-xs font-bold ${
                          guessed ? 'text-brand-accent' : 'text-brand-muted'
                        }`}
                      >
                        {guessed ? t('quick.guessed_label') : t('quick.skipped_label')}
                      </span>
                    </div>
                    <button
                      className="flex items-center gap-1.5 shrink-0 text-brand-muted hover:text-white transition-colors text-xs font-semibold rounded-xl border border-brand-border px-2.5 py-2"
                      onClick={() => googleSearch(entry.name)}
                    >
                      <IconBrandGoogle size={15} stroke={2} />
                      {t('quick.google')}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-4 pb-8 pt-2 space-y-3">
          <Button fullWidth size="lg" onClick={onPlayAgain}>
            {t('end.play_again')}
          </Button>
          <Button fullWidth size="lg" variant="secondary" onClick={() => navigate('/')}>
            {t('quick.home')}
          </Button>
        </div>
      </div>
    );
  }

  // ── Game screen ─────────────────────────────────────────────────
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
          onClick={() => setFinished(true)}
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
          <IconArrowsExchange size={18} stroke={2} />
          {t('quick.pass_turn')}
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
          <IconChevronsRight size={18} stroke={2} />
          {t('quick.skip')}
        </Button>
      </div>
    </div>
  );
}
