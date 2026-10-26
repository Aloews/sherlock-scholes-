import { useTranslation } from 'react-i18next';
import { IconBallFootball, IconUsers, IconDoorEnter, IconArrowLeft } from '@tabler/icons-react';
import { Button } from '@/shared/ui/Button';

/**
 * What you can do with the football Alias: play alone, play against someone,
 * or join a game somebody else opened.
 *
 * THIS USED TO BE THE HOME SCREEN — `HomeLandingMaster`, greeting and all.
 * It moved one level down when the home screen became a list of games, and
 * that is the whole change: the three actions, the order and the wording are
 * untouched, because they were not the problem.
 *
 * The greeting went with the move rather than following it here. "Welcome
 * back, <name>" over a menu says nothing the avatar in the header does not
 * already say, and it pushed the first real thing on the screen below the
 * fold on a small phone.
 *
 * ONE TAP MORE ON THE FLAGSHIP, and it is worth naming rather than hiding:
 * a quick game is now two taps instead of one. What buys it back is that the
 * two commonest ways into a game do not pass through here at all — an
 * invitation from a friend has its own panel above the list, and a `startapp`
 * link joins the room outright without the home screen getting a say.
 */
interface HomeAliasActionsProps {
  onQuickGame(): void;
  onCompetitive(): void;
  onJoin(): void;
  onBack(): void;
}

export function HomeAliasActions({
  onQuickGame, onCompetitive, onJoin, onBack,
}: HomeAliasActionsProps) {
  const { t, i18n } = useTranslation();

  return (
    <div className="w-full max-w-sm space-y-2.5 animate-slide-up">
      <p className="text-brand-muted text-xs text-center uppercase tracking-wider mb-1">
        {t('home.alias_link')}
      </p>
      {/* The tall gradient CTA is the design's signature and stays on the
          action that starts a game fastest. */}
      <Button fullWidth size="lg" className="h-[58px]" onClick={onQuickGame}>
        <span className="flex w-full items-center justify-center gap-2.5"><IconBallFootball size={19} stroke={1.9} />{t('home.mode_training_title')}</span>
      </Button>
      <Button fullWidth size="lg" variant="secondary" onClick={onCompetitive}>
        <span className="flex w-full items-center justify-center gap-2.5"><IconUsers size={18} stroke={1.9} />{t('home.competitive_mode')}</span>
      </Button>
      <Button fullWidth size="lg" variant="secondary" onClick={onJoin}>
        <span className="flex w-full items-center justify-center gap-2.5"><IconDoorEnter size={18} stroke={1.9} />{t('home.join_game')}</span>
      </Button>
      <Button fullWidth variant="ghost" onClick={onBack}>
        <span className="flex w-full items-center justify-center gap-2"><IconArrowLeft size={17} stroke={1.9} />{t('home.back')}</span>
      </Button>
    </div>
  );
}
