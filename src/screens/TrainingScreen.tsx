import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { IconArrowsExchange, IconReload, IconUser } from '@tabler/icons-react';
import { useTraining, type Team } from '@/features/game/useTraining';
import { playSound } from '@/shared/lib/sounds';
import { hapticImpact } from '@/shared/lib/telegram';
import type { CardCategory } from '@/shared/types/database';
import { CATEGORY_LABEL_RU } from '@/shared/types/database';

interface TrainingState {
  categories: CardCategory[] | null;
}

const TEAM_COLOR: Record<Team, string> = {
  orange: '#FF6300',
  blue:   '#4A9EFF',
};

// Score separator — muted slate, NOT a pure grey (Variant 5 palette).
const SCORE_DIVIDER = '#4A5270';

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

/** 32x32 round avatar for the summary history. Falls back to a silhouette
 * circle when the card has no photo_url or the image fails to load. */
function HistoryAvatar({ photoUrl, alt }: { photoUrl?: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  // Commons URLs are stored with ?width=256; the 32px avatar only needs 128.
  const src = photoUrl ? photoUrl.replace('width=256', 'width=128') : null;
  if (!src || failed) {
    return (
      <span className="w-8 h-8 shrink-0 rounded-full bg-brand-surface border border-brand-border flex items-center justify-center">
        <IconUser size={16} className="text-brand-muted" />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className="w-8 h-8 shrink-0 rounded-full object-cover"
    />
  );
}

/** Big centred score line "orange : blue" in team colours (Variant 5). */
function ScoreLine({ orange, blue, activeTeam }: {
  orange: number;
  blue: number;
  activeTeam?: Team;
}) {
  return (
    <div className="flex items-center justify-center gap-3 text-[30px] font-medium leading-none">
      <span style={{ color: TEAM_COLOR.orange, opacity: activeTeam && activeTeam !== 'orange' ? 0.4 : 1 }}>
        {orange}
      </span>
      <span style={{ color: SCORE_DIVIDER }}>:</span>
      <span style={{ color: TEAM_COLOR.blue, opacity: activeTeam && activeTeam !== 'blue' ? 0.4 : 1 }}>
        {blue}
      </span>
    </div>
  );
}

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
  const { t, i18n } = useTranslation();

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
    // EN interface → show the card's English name when available; otherwise
    // fall back to the Russian name (never blank).
    const isEn = i18n.language.startsWith('en');
    return (
      <div className="min-h-screen bg-brand-bg flex flex-col">
        {/* Header */}
        <div className="px-4 pt-8 pb-4 border-b border-brand-border">
          <h1 className="text-2xl font-medium text-white text-center">
            {t('quick.summary_title')}
          </h1>
        </div>

        {/* Final score — numbers only, no team labels underneath */}
        <div className="px-4 pt-6">
          <ScoreLine orange={scores.orange} blue={scores.blue} />
        </div>

        {/* Card history */}
        <div className="flex-1 px-4 pt-6 pb-4 overflow-y-auto">
          <p className="text-brand-muted text-sm uppercase tracking-wider mb-3">
            {t('quick.history_title')}
          </p>

          {history.length === 0 ? (
            <div className="rounded-md bg-brand-surface border border-brand-border p-8 text-center">
              <p className="text-brand-muted">{t('quick.history_empty')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((entry, i) => {
                const catColor = CATEGORY_COLOR[entry.category] ?? '#7A8499';
                const guessed  = entry.status === 'guessed';
                // On EN use name_en when present; else Russian name (fallback).
                const displayName = isEn && entry.name_en ? entry.name_en : entry.name;
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 bg-brand-surface border border-brand-border rounded-md px-3 py-2.5"
                  >
                    <div className="flex-1 min-w-0">
                      <span
                        className="text-[11px] uppercase tracking-widest font-medium"
                        style={{ color: catColor }}
                      >
                        {CATEGORY_LABEL_RU[entry.category] ?? entry.category}
                      </span>
                      <div className="flex items-center gap-2">
                        <HistoryAvatar photoUrl={entry.photo_url} alt={displayName} />
                        <button
                          type="button"
                          onClick={() => { hapticImpact('light'); googleSearch(displayName); }}
                          className="flex-1 min-w-0 text-left text-xl font-medium text-white leading-snug truncate transition-colors hover:text-[#FF6300] hover:underline"
                        >
                          {displayName}
                        </button>
                      </div>
                      <span
                        className="text-xs font-medium"
                        style={{ color: guessed ? TEAM_COLOR.orange : '#7A8499' }}
                      >
                        {guessed ? t('quick.guessed_label') : t('quick.skipped_label')}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-4 pb-8 pt-2 space-y-3">
          <button
            className="w-full h-14 rounded-md text-lg font-medium transition-opacity hover:opacity-90 flex items-center justify-center gap-2"
            style={{ backgroundColor: TEAM_COLOR.orange, color: '#0A0E1A' }}
            onClick={() => { hapticImpact('light'); onPlayAgain(); }}
          >
            {/* Match the game screen's IconArrowsExchange: same icon set, size 16, stroke 2 */}
            <IconReload size={16} stroke={2} />
            {t('end.play_again')}
          </button>
          <button
            className="w-full h-14 rounded-md text-lg font-medium text-white bg-brand-surface transition-colors hover:opacity-90"
            onClick={() => { hapticImpact('light'); navigate('/'); }}
          >
            {t('quick.home')}
          </button>
        </div>
      </div>
    );
  }

  // ── Game screen ─────────────────────────────────────────────────
  const catColor = currentCard ? (CATEGORY_COLOR[currentCard.category] ?? '#7A8499') : '#7A8499';
  const catLabel = currentCard
    ? (currentCard.category_ru ?? CATEGORY_LABEL_RU[currentCard.category] ?? currentCard.category)
    : '';
  // EN interface → English card name when available, Russian fallback (same rule as the summary)
  const cardName = currentCard
    ? (i18n.language.startsWith('en') && currentCard.name_en ? currentCard.name_en : currentCard.name)
    : '';

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-8 pb-3 border-b border-brand-border">
        <button
          className="text-brand-muted hover:text-white transition-colors text-sm p-1 -ml-1"
          onClick={() => { hapticImpact('heavy'); playSound('fanfare'); setFinished(true); }}
        >
          {t('quick.finish')}
        </button>
        <p className="text-brand-muted text-xs uppercase tracking-wider">
          {t('home.mode_training_title')}
        </p>
        <span className="w-16" />
      </div>

      {/* Score line */}
      <div className="px-4 pt-6">
        <ScoreLine orange={scores.orange} blue={scores.blue} activeTeam={activeTeam} />
      </div>

      {/* Pass turn — compact text row, no heavy button */}
      <div className="px-4 pt-3 flex justify-center">
        <button
          className="inline-flex items-center gap-1.5 text-brand-muted hover:text-white transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => { hapticImpact('light'); playSound('swipe'); passTurn(); }}
          disabled={!currentCard}
        >
          <IconArrowsExchange size={16} stroke={2} />
          {t('quick.pass_turn')}
        </button>
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
              {/* Word card — large, centred, surface, 6px radius, no accent strip */}
              <div className="rounded-md bg-brand-surface border border-brand-border text-center px-[14px] py-[30px]">
                <span
                  className="text-[11px] uppercase tracking-widest font-medium"
                  style={{ color: catColor }}
                >
                  {catLabel}
                </span>
                <p className="text-[30px] font-medium text-white leading-snug mt-2">
                  {cardName}
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <div className="rounded-md bg-brand-surface border border-brand-border p-10 text-center">
                <div className="text-5xl mb-4">🃏</div>
                <p className="text-brand-muted">{t('training.no_cards')}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Actions */}
      <div className="px-4 pb-8 flex gap-3">
        <button
          className="flex-1 h-14 rounded-md text-lg font-medium transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ backgroundColor: TEAM_COLOR.orange, color: '#0A0E1A' }}
          disabled={!currentCard}
          onClick={() => { hapticImpact('medium'); playSound('correct'); guess(); }}
        >
          {t('quick.guessed')}
        </button>
        <button
          className="flex-1 h-14 rounded-md text-lg font-medium text-white bg-brand-surface transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={!currentCard}
          onClick={() => { hapticImpact('light'); playSound('skip'); skip(); }}
        >
          {t('quick.skip')}
        </button>
      </div>
    </div>
  );
}
