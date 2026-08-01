import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/Button';

// Landing block of the Home screen in the MASTER design: greeting plus a
// tall primary CTA over two outline actions. The card-catalog row was
// removed — Collection is reachable from the bottom tab bar, so it doesn't
// need a second entry point on the landing itself.
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
  onQuickGame(): void;
  onCompetitive(): void;
  onJoin(): void;
}

export function HomeLandingMaster({
  playerName, onQuickGame, onCompetitive, onJoin,
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
    </div>
  );
}
