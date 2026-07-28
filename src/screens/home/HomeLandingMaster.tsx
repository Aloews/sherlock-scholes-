import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { IconChevronRight, IconCards, IconCrown } from '@tabler/icons-react';
import { Button } from '@/shared/ui/Button';

// Landing block of the Home screen in the MASTER design: greeting, a tall
// primary CTA over two outline actions, and a card-catalog row.
//
// Deliberately NOT ported from the prototype, because the schema has no such
// data (see docs/DESIGN_V2_HANDOFF.md §3): the streak chip, the daily-tasks
// card, level/rank, and achievements. The prototype's stat strip is left out
// too — by product decision the master landing stays a clean action stack, so
// neither the counters nor the commentator quotes appear here.
//
// The classic landing lives in HomeScreen.tsx and is untouched.

interface HomeLandingMasterProps {
  playerName: string | null;
  /** The catalog is Pro-only; free users see the crown and land on the upsell. */
  isPro: boolean;
  onQuickGame(): void;
  onCompetitive(): void;
  onJoin(): void;
  onCollection(): void;
}

export function HomeLandingMaster({
  playerName, isPro, onQuickGame, onCompetitive, onJoin, onCollection,
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
          <span className="flex items-center gap-1.5 text-[13px] font-bold text-white">
            {t('home.collection')}
            {!isPro && <IconCrown size={13} stroke={2} className="text-brand-accent" />}
          </span>
          <span className="block text-[11px] text-brand-muted mt-0.5">
            {t('home.collection_hint')}
          </span>
        </span>
        <IconChevronRight size={18} stroke={1.75} className="text-brand-muted" />
      </motion.button>

    </div>
  );
}
