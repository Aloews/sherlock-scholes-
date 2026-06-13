import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import {
  IconArrowsExchange,
  IconBallFootball,
  IconBuildingStadium,
  IconFlag,
  IconReload,
  IconShield,
  IconUser,
} from '@tabler/icons-react';
import { useTraining, type HistoryEntry, type Team } from '@/features/game/useTraining';
import { cardDisplayName } from '@/shared/lib/cardName';
import { isoToFlag } from '@/shared/lib/flag';
import { trackEvent } from '@/shared/lib/analytics';
import { countryName, positionName } from '@/shared/lib/countryName';
import { playSound } from '@/shared/lib/sounds';
import { hapticImpact } from '@/shared/lib/telegram';
import type { CardCategory, ContinentFilter } from '@/shared/types/database';
import { CATEGORY_LABEL_RU } from '@/shared/types/database';

interface TrainingState {
  categories: CardCategory[] | null;
  continents?: ContinentFilter[] | null; // player cards only; null = all
  minPageviews?: number | null;          // "Только звёзды" floor; null = whole deck
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

// Club first words that are ambiguous on their own (several clubs share them),
// so the short form would mislead — keep the full name and let it ellipsis.
const AMBIGUOUS_CLUB_FIRST = new Set([
  'манчестер', 'manchester', 'реал', 'real',
]);

/** Compact club name for the history table: the part before a '(' qualifier
 * ("Боруссия (Дортмунд)" -> "Боруссия") or the first word
 * ("Тоттенхэм Хотспур" -> "Тоттенхэм"). Ambiguous first words (Манчестер
 * Сити/Юнайтед, Реал Мадрид/Сосьедад) keep the full name -> truncates. */
function clubShort(name: string): string {
  const beforeParen = name.split('(')[0].trim();
  const words = beforeParen.split(/\s+/);
  if (AMBIGUOUS_CLUB_FIRST.has(words[0].toLowerCase())) return name;
  return words.length > 1 ? words[0] : beforeParen;
}

const googleSearch = (name: string) => {
  const q   = encodeURIComponent(`${name} football wiki`);
  const url = `https://www.google.com/search?q=${q}`;
  const tg  = window.Telegram?.WebApp as { openLink?: (url: string) => void } | undefined;
  if (tg?.openLink) tg.openLink(url);
  else window.open(url, '_blank');
};

// Placeholder icon per category when a history entry has no photo: a user
// silhouette makes no sense for a term or a stadium. People keep IconUser.
const PLACEHOLDER_ICON: Partial<Record<CardCategory, typeof IconUser>> = {
  term:          IconBallFootball,
  position:      IconBallFootball,
  club:          IconShield,
  club_nickname: IconShield,
  stadium:       IconBuildingStadium,
  // No IconWhistle in tabler — IconFlag is the referee icon used in-game too.
  referee:       IconFlag,
};

/** 32x32 round avatar for the summary history. Falls back to a category
 * placeholder circle when the card has no photo_url or the image fails.
 * (The country flag lives in the meta line under the name, not here.) */
function HistoryAvatar({ photoUrl, category, alt }: {
  photoUrl?: string | null;
  category: CardCategory;
  alt: string;
}) {
  const [failed, setFailed] = useState(false);
  // Commons URLs are stored with ?width=256; the 32px avatar only needs 128.
  const src = photoUrl ? photoUrl.replace('width=256', 'width=128') : null;
  if (!src || failed) {
    const Placeholder = PLACEHOLDER_ICON[category] ?? IconUser;
    return (
      <span className="w-8 h-8 shrink-0 rounded-full bg-brand-surface border border-brand-border flex items-center justify-center">
        <Placeholder size={16} className="text-brand-muted" />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      // object-top: football photos have the face in the upper third, so the
      // circle crops from the top — centre-cropping cuts the head off.
      className="w-8 h-8 shrink-0 rounded-full object-cover object-top"
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
  const continents = state?.continents ?? null;
  const minPageviews = state?.minPageviews ?? null;

  const [gameKey, setGameKey] = useState(0);

  return (
    <TrainingGame
      key={gameKey}
      categories={categories}
      continents={continents}
      minPageviews={minPageviews}
      onPlayAgain={() => setGameKey((k) => k + 1)}
    />
  );
}

interface TrainingGameProps {
  categories: CardCategory[] | null;
  continents: ContinentFilter[] | null;
  minPageviews: number | null;
  onPlayAgain: () => void;
}

function TrainingGame({ categories, continents, minPageviews, onPlayAgain }: TrainingGameProps) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const { currentCard, loading, scores, activeTeam, history, guess, skip, passTurn } =
    useTraining(categories, continents, minPageviews);

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

  // Bottom line under the name: "🇩🇪 Германия · Защитник" (country name and
  // position follow the interface language). Country (flag + name) and/or
  // position; whichever is missing is dropped. No flag when there's no
  // country. Empty when neither is known.
  const metaLine = (entry: HistoryEntry): string | null => {
    const flag = isoToFlag(entry.country);
    const country = countryName(entry.country, i18n.language);
    const left = country ? `${flag ? flag + ' ' : ''}${country}` : null;
    const parts = [left, positionName(entry.position_ru, i18n.language)].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  };

  // ── Summary screen ──────────────────────────────────────────────
  if (finished) {
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
                const guessed = entry.status === 'guessed';
                // Category label for everything but players: photo + name
                // already identify a player, the rest need the context.
                const showCategory = entry.category !== 'player';
                const catColor = CATEGORY_COLOR[entry.category] ?? '#7A8499';
                // Translation -> name_en -> name, per the interface language.
                const displayName = cardDisplayName(entry, i18n.language);
                // clubs_minutes (any size) -> the compact club|minutes table
                // on the right, always; legends without it leave the right empty.
                const clubs = entry.clubs_minutes?.length
                  ? entry.clubs_minutes.slice(0, 4)
                  : null;
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 bg-brand-surface border border-brand-border rounded-md px-3 py-2.5"
                  >
                    <div className="flex-1 min-w-0 overflow-hidden">
                      {showCategory && (
                        <span
                          className="text-[11px] uppercase tracking-widest font-medium"
                          style={{ color: catColor }}
                        >
                          {entry.category_ru ?? CATEGORY_LABEL_RU[entry.category] ?? entry.category}
                        </span>
                      )}
                      <div className="flex items-center gap-2">
                        <HistoryAvatar photoUrl={entry.photo_url} category={entry.category} alt={displayName} />
                        <button
                          type="button"
                          onClick={() => { hapticImpact('light'); googleSearch(displayName); }}
                          className="flex-1 min-w-0 text-left text-xl font-medium text-white leading-snug truncate transition-colors hover:text-[#FF6300] hover:underline"
                        >
                          {displayName}
                        </button>
                      </div>
                      {metaLine(entry) && (
                        <p className="text-brand-muted text-xs leading-snug truncate mt-0.5">
                          {metaLine(entry)}
                        </p>
                      )}
                      <span
                        className="text-xs font-medium"
                        style={{ color: guessed ? TEAM_COLOR.orange : '#7A8499' }}
                      >
                        {guessed ? t('quick.guessed_label') : t('quick.skipped_label')}
                      </span>
                    </div>
                    {clubs && (
                      <div className="shrink-0 w-[124px] space-y-0.5">
                        {clubs.map((c) => (
                          <div key={c.club} className="flex items-baseline justify-between gap-2 text-[11px] leading-tight">
                            <span className="text-brand-muted truncate" title={c.club}>{clubShort(c.club)}</span>
                            <span className="text-white tabular-nums shrink-0">
                              {c.minutes}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
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
  // Translation -> name_en -> name, per the interface language (same rule
  // as the summary history).
  const cardName = currentCard ? cardDisplayName(currentCard, i18n.language) : '';

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-8 pb-3 border-b border-brand-border">
        <button
          className="text-brand-muted hover:text-white transition-colors text-sm p-1 -ml-1"
          onClick={() => {
            hapticImpact('heavy');
            playSound('fanfare');
            trackEvent('quick_game_end', {
              orange: scores.orange,
              blue: scores.blue,
              cards: history.length,
            });
            setFinished(true);
          }}
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
