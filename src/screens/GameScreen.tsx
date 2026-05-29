import { useEffect, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { IconVolume, IconVolumeOff } from '@tabler/icons-react';
import { useGame } from '@/features/game/useGame';
import { useTimer } from '@/features/game/useTimer';
import { useGameStore } from '@/shared/store/gameStore';
import { Timer } from '@/shared/ui/Timer';
import { PlayerCard } from '@/shared/ui/PlayerCard';
import { Button } from '@/shared/ui/Button';
import { Scoreboard } from '@/shared/ui/Scoreboard';
import { hapticImpact } from '@/shared/lib/telegram';
import { playSound, isMuted, toggleMute } from '@/shared/lib/sounds';

function MuteButton() {
  const [muted, setMuted] = useState(isMuted);
  const { t } = useTranslation();

  const toggle = () => {
    toggleMute();
    setMuted((m) => !m);
  };

  return (
    <button
      onClick={toggle}
      aria-label={muted ? t('sound.unmute') : t('sound.mute')}
      className="p-1.5 rounded-lg text-brand-muted hover:text-white transition-colors"
    >
      {muted
        ? <IconVolumeOff size={18} stroke={1.5} />
        : <IconVolume    size={18} stroke={1.5} />}
    </button>
  );
}

function CountdownOverlay({ n }: { n: number }) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 bg-brand-bg/90 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="text-center space-y-4">
        <p className="text-brand-muted text-lg">{t('game.round_starting')}</p>
        <AnimatePresence mode="wait">
          <motion.p
            key={n}
            initial={{ scale: 1.5, opacity: 0 }}
            animate={{ scale: 1,   opacity: 1 }}
            exit={{ scale: 0.5,    opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="text-9xl font-black text-brand-accent"
          >
            {n > 0 ? n : t('game.go')}
          </motion.p>
        </AnimatePresence>
      </div>
    </div>
  );
}

function RoundSummaryOverlay() {
  const { teamScores, currentRound } = useGameStore();
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 bg-brand-bg/95 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-6 gap-6">
      <div className="text-center">
        <p className="text-brand-muted text-sm uppercase tracking-wider">
          {t('game.round_finished', { n: currentRound?.round_number })}
        </p>
      </div>
      <div className="w-full max-w-sm">
        <Scoreboard scores={teamScores} />
      </div>
      <div className="flex justify-center gap-1 mt-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-2 h-2 rounded-full bg-brand-border animate-pulse"
            style={{ animationDelay: `${i * 200}ms` }}
          />
        ))}
      </div>
      <p className="text-brand-muted text-sm">{t('game.next_round_soon')}</p>
    </div>
  );
}

export function GameScreen() {
  const navigate = useNavigate();
  const { phase, countdown, teamScores, currentRound } = useGameStore();
  const { t } = useTranslation();
  const {
    activeCard,
    correctCount,
    isExplainer,
    isMyTeamsTurn,
    explainerTeam,
    pendingCards,
    is1v1,
    myPersonalScore,
    opponentScore,
    markCorrect,
    markSkipped,
    handleRoundEnd,
  } = useGame();

  const { remaining } = useTimer(currentRound, {
    onExpire: useCallback(() => {
      if (isExplainer) handleRoundEnd();
    }, [isExplainer, handleRoundEnd]),
    onTick: useCallback((rem: number) => {
      if (rem > 0 && rem <= 10) playSound('tick');
      if (rem === 0) playSound('gong');
    }, []),
  });

  useEffect(() => {
    if (phase === 'game_end') navigate('/end');
  }, [phase, navigate]);

  useEffect(() => {
    if (phase !== 'countdown') return;
    let n = 3;
    useGameStore.getState().setCountdown(n);
    hapticImpact('medium');

    const id = setInterval(() => {
      n -= 1;
      useGameStore.getState().setCountdown(n);
      if (n > 0) hapticImpact('light');
      if (n <= 0) clearInterval(id);
    }, 1000);

    return () => clearInterval(id);
  }, [phase]);

  if (!currentRound) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center">
        <div className="text-brand-muted text-center">
          <div className="text-4xl mb-3">⚽</div>
          <p>{t('game.loading')}</p>
        </div>
      </div>
    );
  }

  const totalCards = pendingCards.length + correctCount;
  const roundLabel = t('game.round_label', { n: currentRound.round_number });

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col">
      {phase === 'countdown' && countdown > 0 && <CountdownOverlay n={countdown} />}
      {phase === 'round_summary' && <RoundSummaryOverlay />}

      {/* Score bar */}
      <div className="flex items-center justify-between px-4 pt-6 pb-3 border-b border-brand-border">
        <Scoreboard scores={teamScores} compact />
        <div className="flex items-center gap-2">
          <div className="text-xs text-brand-muted font-medium">{roundLabel}</div>
          <MuteButton />
        </div>
      </div>

      {/* Timer */}
      <div className="flex flex-col items-center py-4">
        {currentRound.status === 'active' ? (
          <Timer remaining={remaining} total={currentRound.time_seconds} size="lg" />
        ) : (
          <div className="text-4xl font-black text-brand-muted">{currentRound.time_seconds}</div>
        )}
        <p className="text-brand-muted text-xs mt-1">
          {t('game.guessed_progress', { correct: correctCount })}
        </p>
      </div>

      {/* Main content */}
      <div className="flex-1 px-4 overflow-y-auto">
        {isExplainer ? (
          <div className="space-y-3">
            <AnimatePresence mode="wait">
              {activeCard?.card ? (
                <motion.div
                  key={activeCard.id}
                  initial={{ x: 64, opacity: 0 }}
                  animate={{ x: 0,  opacity: 1 }}
                  exit={{ x: -64,   opacity: 0 }}
                  transition={{ duration: 0.18, ease: 'easeInOut' }}
                >
                  <PlayerCard card={activeCard.card} mode="explainer" />
                </motion.div>
              ) : (
                <motion.div
                  key="all-done"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                >
                  <div className="rounded-2xl bg-brand-surface border border-brand-border p-8 text-center min-h-[260px] flex flex-col items-center justify-center gap-3">
                    <div className="text-5xl">✅</div>
                    <p className="text-brand-accent font-semibold text-lg">{t('game.all_cards_done')}</p>
                    <p className="text-brand-muted text-sm">{t('game.waiting_timer')}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {totalCards > 0 && (
              <div className="flex justify-center gap-2 py-1">
                {Array.from({ length: totalCards }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      i < correctCount ? 'bg-brand-accent' : 'bg-brand-border'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center min-h-[300px] gap-4 text-center">

            {/* ── 1v1 guesser view ── */}
            {is1v1 ? (
              <>
                <div className="text-6xl">👂</div>
                <p className="text-white text-3xl font-bold">{t('game.listening')}</p>

                <div className="bg-brand-surface border border-brand-border rounded-2xl px-8 py-4">
                  <p className="text-brand-accent font-black text-5xl">{correctCount}</p>
                  <p className="text-brand-muted text-xs mt-1">
                    {t('game.opponent_progress', { n: correctCount })}
                  </p>
                </div>

                {teamScores.length > 0 && (
                  <div className="flex items-center gap-3 text-sm mt-1">
                    <span className="text-white font-semibold">
                      {t('game.score_you')}: {myPersonalScore}
                    </span>
                    <span className="text-brand-border">|</span>
                    <span className="text-brand-muted">
                      {t('game.score_opponent')}: {opponentScore}
                    </span>
                  </div>
                )}
              </>
            ) : (
              /* ── Team mode guesser view ── */
              <>
                {isMyTeamsTurn ? (
                  <>
                    <div className="text-6xl">👂</div>
                    <p className="text-white text-xl font-bold">{t('game.your_team_explaining')}</p>
                    <p className="text-brand-muted">{t('game.listen_and_guess')}</p>
                    <div className="bg-brand-surface border border-brand-border rounded-2xl px-6 py-3">
                      <p className="text-brand-accent font-black text-4xl">{correctCount}</p>
                      <p className="text-brand-muted text-xs">{t('game.guessed_count')}</p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-6xl">👀</div>
                    <div>
                      <p className="text-white text-xl font-bold">
                        {t('game.team_playing', { name: explainerTeam?.name ?? t('game.other_team') })}
                      </p>
                      <p className="text-brand-muted text-sm mt-1">{t('game.wait_your_turn')}</p>
                    </div>
                    <div className="bg-brand-surface border border-brand-border rounded-2xl px-6 py-3">
                      <p className="text-blue-400 font-black text-4xl">{correctCount}</p>
                      <p className="text-brand-muted text-xs">{t('game.their_round_points')}</p>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Action buttons — explainer only */}
      {isExplainer && activeCard && activeCard.status === 'pending' && (
        <div className="px-4 pb-6 pt-3 grid grid-cols-2 gap-3 border-t border-brand-border">
          <Button size="lg" variant="secondary" onClick={markSkipped}>
            {t('game.skip')}
          </Button>
          <Button size="lg" onClick={markCorrect}>
            {t('game.correct')}
          </Button>
        </div>
      )}

      {isExplainer && (!activeCard || activeCard.status !== 'pending') && (
        <div className="px-4 pb-6 pt-3 border-t border-brand-border">
          <Button fullWidth size="lg" variant="secondary" disabled>
            {t('game.waiting_timer')}
          </Button>
        </div>
      )}
    </div>
  );
}
