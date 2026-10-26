import { useTranslation } from 'react-i18next';
import { IconBallFootball, IconUsers, IconDoorEnter, IconArrowLeft, IconChevronRight } from '@tabler/icons-react';
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
  const { t } = useTranslation();

  return (
    <div className="w-full max-w-sm space-y-2.5 animate-slide-up">
      <p className="text-brand-muted text-xs text-center uppercase tracking-wider mb-1">
        {t('home.alias_link')}
      </p>
      {/* The tall gradient CTA is the design's signature and stays on the
          action that starts a game fastest. */}
      <Button fullWidth size="lg" className="h-[64px] px-4" onClick={onQuickGame}>
        <span className="flex w-full items-center gap-3 text-left"><span className="w-10 h-10 rounded-xl bg-black/10 flex items-center justify-center shrink-0"><IconBallFootball size={20} stroke={1.9} /></span><span className="flex-1">{t('home.mode_training_title')}</span><IconChevronRight size={18} stroke={2} /></span>
      </Button>
      <Button fullWidth size="lg" variant="secondary" onClick={onCompetitive} className="h-[64px] px-4">
        <span className="flex w-full items-center gap-3 text-left"><span className="w-10 h-10 rounded-xl bg-brand-border/60 flex items-center justify-center text-brand-muted shrink-0"><IconUsers size={19} stroke={1.9} /></span><span className="flex-1">{t('home.competitive_mode')}</span><IconChevronRight size={18} stroke={2} className="text-brand-muted" /></span>
      </Button>
      <Button fullWidth size="lg" variant="secondary" onClick={onJoin} className="h-[64px] px-4">
        <span className="flex w-full items-center gap-3 text-left"><span className="w-10 h-10 rounded-xl bg-brand-border/60 flex items-center justify-center text-brand-muted shrink-0"><IconDoorEnter size={19} stroke={1.9} /></span><span className="flex-1">{t('home.join_game')}</span><IconChevronRight size={18} stroke={2} className="text-brand-muted" /></span>
      </Button>
      <Button fullWidth variant="ghost" onClick={onBack}>
        <span className="flex w-full items-center justify-center gap-2"><IconArrowLeft size={17} stroke={1.9} />{t('home.back')}</span>
      </Button>
    </div>
  );
}
