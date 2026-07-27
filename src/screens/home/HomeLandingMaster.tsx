import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { IconChevronRight, IconCards } from '@tabler/icons-react';
import { Button } from '@/shared/ui/Button';
import { GradientText } from '@/shared/ui/GradientText';
import type { PlayerStats } from '@/shared/types/database';

// Landing block of the Home screen in the MASTER design — the prototype's
// layout: greeting, a three-cell stat strip with gradient numerals, a tall
// primary CTA over two outline actions, and a card-catalog row.
//
// Deliberately NOT ported from the prototype, because the schema has no such
// data (see docs/DESIGN_V2_HANDOFF.md §3): the streak chip, the daily-tasks
// card, level/rank, and achievements. The stat strip shows the three counters
// player_stats actually carries.
//
// The classic landing lives in HomeScreen.tsx and is untouched.

interface HomeLandingMasterProps {
  playerName: string | null;
  stats: PlayerStats | null;
  statsLoading: boolean;
  onQuickGame(): void;
  onCompetitive(): void;
  onJoin(): void;
  onCollection(): void;
}

export function HomeLandingMaster({
  playerName, stats, statsLoading,
  onQuickGame, onCompetitive, onJoin, onCollection,
}: HomeLandingMasterProps) {
  const { t } = useTranslation();

  return (
    <div className="w-full max-w-sm space-y-4 animate-fade-in">
      {/* Greeting */}
      <div>
        <p className="text-brand-muted text-xs">{t('home.welcome_back')}</p>
        <p className="ds-display text-xl font-bold text-white mt-0.5">
          {playerName ?? t('home.welcome_stranger')}
        </p>
      </div>

      {/* Primary actions — the tall gradient CTA is the design's signature. */}
      <div className="space-y-2.5">
        <Button fullWidth size="lg" className="h-[58px]" onClick={onQuickGame}>
          {t('home.mode_training_title')}
        </Button>
        <Button fullWidth size="lg" variant="secondary" onClick={onCompetitive}>
          {t('home.competitive_mode')}
        </Button>
        <Button fullWidth size="lg" variant="secondary" onClick={onJoin}>
          {t('home.join_game')}
        </Button>
      </div>

      {/* Card catalog row */}
      <motion.button
        type="button"
        whileTap={{ scale: 0.94 }}
        transition={{ duration: 0.1 }}
        onClick={onCollection}
        className="ds-panel w-full flex items-center gap-3 rounded-2xl bg-brand-surface
                   border border-brand-border p-4 text-left"
      >
        <span className="w-11 h-11 shrink-0 rounded-xl bg-brand-accent/10 flex items-center justify-center">
          <IconCards size={20} stroke={1.75} className="text-brand-accent" />
        </span>
        <span className="flex-1">
          <span className="block text-[13px] font-bold text-white">{t('home.collection')}</span>
          <span className="block text-[11px] text-brand-muted mt-0.5">
            {t('home.collection_hint')}
          </span>
        </span>
        <IconChevronRight size={18} stroke={1.75} className="text-brand-muted" />
      </motion.button>

      {/* Stat strip — gradient numerals, one divider between cells. */}
      {!statsLoading && (
        stats ? (
          <div className="ds-panel flex rounded-2xl bg-brand-surface border border-brand-border overflow-hidden">
            {[
              { label: t('stats.games'), value: stats.games_played },
              { label: t('stats.wins'),  value: stats.games_won },
              { label: t('stats.score'), value: stats.total_score },
            ].map((item, i) => (
              <div
                key={item.label}
                className={`flex-1 text-center py-3.5 px-1.5 ${i > 0 ? 'border-l border-brand-accent/15' : ''}`}
              >
                <GradientText className="ds-display block text-xl font-extrabold leading-none">
                  {item.value}
                </GradientText>
                <p className="text-[10px] text-brand-muted uppercase tracking-[0.08em] mt-1">
                  {item.label}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl bg-brand-surface/50 border border-brand-border/50 p-3 text-center">
            <p className="text-brand-muted/70 text-sm">{t('stats.first_game')}</p>
          </div>
        )
      )}
    </div>
  );
}
