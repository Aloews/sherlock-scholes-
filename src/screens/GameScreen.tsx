import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useGame } from '@/features/game/useGame';
import { useTimer } from '@/features/game/useTimer';
import { useGameStore } from '@/shared/store/gameStore';
import { Timer } from '@/shared/ui/Timer';
import { PlayerCard } from '@/shared/ui/PlayerCard';
import { Button } from '@/shared/ui/Button';
import { Scoreboard } from '@/shared/ui/Scoreboard';
import { hapticImpact } from '@/shared/lib/telegram';

function CountdownOverlay({ n }: { n: number }) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 bg-zinc-950/90 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="text-center space-y-4 animate-fade-in">
        <p className="text-zinc-400 text-lg">{t('game.round_starting')}</p>
        <p className="text-9xl font-black text-emerald-400 animate-pulse-fast">
          {n > 0 ? n : t('game.go')}
        </p>
      </div>
    </div>
  );
}

function RoundSummaryOverlay() {
  const { teamScores, currentRound } = useGameStore();
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 bg-zinc-950/95 backdrop-blur-sm z-50 flex flex-col items-center justify-center p-6 gap-6">
      <div className="text-center">
        <p className="text-zinc-400 text-sm uppercase tracking-wider">
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
            className="w-2 h-2 rounded-full bg-zinc-600 animate-pulse"
            style={{ animationDelay: `${i * 200}ms` }}
          />
        ))}
      </div>
      <p className="text-zinc-500 text-sm">{t('game.next_round_soon')}</p>
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
    markCorrect,
    markSkipped,
    handleRoundEnd,
  } = useGame();

  const { remaining } = useTimer(currentRound, {
    onExpire: useCallback(() => {
      if (isExplainer) handleRoundEnd();
    }, [isExplainer, handleRoundEnd]),
  });

  // Navigate to end screen when game finishes
  useEffect(() => {
    if (phase === 'game_end') navigate('/end');
  }, [phase, navigate]);

  // Countdown animation — runs when phase transitions to 'countdown'
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
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-500 text-center">
          <div className="text-4xl mb-3">⚽</div>
          <p>{t('game.loading')}</p>
        </div>
      </div>
    );
  }

  const totalCards = pendingCards.length + correctCount;
  const roundLabel = t('game.round_label', { n: currentRound.round_number });

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      {/* Phase overlays */}
      {phase === 'countdown' && countdown > 0 && <CountdownOverlay n={countdown} />}
      {phase === 'round_summary' && <RoundSummaryOverlay />}

      {/* Score bar */}
      <div className="flex items-center justify-between px-4 pt-6 pb-3 border-b border-zinc-900">
        <Scoreboard scores={teamScores} compact />
        <div className="text-xs text-zinc-600 font-medium">{roundLabel}</div>
      </div>

      {/* Timer */}
      <div className="flex flex-col items-center py-4">
        {currentRound.status === 'active' ? (
          <Timer remaining={remaining} total={currentRound.time_seconds} size="lg" />
        ) : (
          <div className="text-4xl font-black text-zinc-600">{currentRound.time_seconds}</div>
        )}
        <p className="text-zinc-600 text-xs mt-1">
          {t('game.guessed_progress', { correct: correctCount, total: totalCards })}
        </p>
      </div>

      {/* Main content */}
      <div className="flex-1 px-4 overflow-y-auto">
        {isExplainer ? (
          /* Explainer sees the full card */
          <div className="space-y-3">
            {activeCard?.card ? (
              <PlayerCard card={activeCard.card} mode="explainer" />
            ) : (
              <div className="rounded-3xl bg-zinc-900 border border-zinc-800 p-8 text-center min-h-[260px] flex flex-col items-center justify-center gap-3">
                <div className="text-5xl">✅</div>
                <p className="text-emerald-400 font-semibold text-lg">{t('game.all_cards_done')}</p>
                <p className="text-zinc-500 text-sm">{t('game.waiting_timer')}</p>
              </div>
            )}

            {/* Progress dots */}
            {totalCards > 0 && (
              <div className="flex justify-center gap-2 py-1">
                {Array.from({ length: totalCards }).map((_, i) => (
                  <div
                    key={i}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      i < correctCount ? 'bg-emerald-500' : 'bg-zinc-700'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          /* Guesser / spectator */
          <div className="flex flex-col items-center justify-center min-h-[300px] gap-4 text-center">
            {isMyTeamsTurn ? (
              <>
                <div className="text-6xl">👂</div>
                <p className="text-white text-xl font-bold">{t('game.your_team_explaining')}</p>
                <p className="text-zinc-400">{t('game.listen_and_guess')}</p>
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-3">
                  <p className="text-emerald-400 font-black text-4xl">{correctCount}</p>
                  <p className="text-zinc-500 text-xs">{t('game.guessed_count')}</p>
                </div>
              </>
            ) : (
              <>
                <div className="text-6xl">👀</div>
                <div>
                  <p className="text-white text-xl font-bold">
                    {t('game.team_playing', { name: explainerTeam?.name ?? t('game.other_team') })}
                  </p>
                  <p className="text-zinc-400 text-sm mt-1">{t('game.wait_your_turn')}</p>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl px-6 py-3">
                  <p className="text-blue-400 font-black text-4xl">{correctCount}</p>
                  <p className="text-zinc-500 text-xs">{t('game.their_round_points')}</p>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Action buttons — explainer only */}
      {isExplainer && activeCard && activeCard.status === 'pending' && (
        <div className="px-4 pb-6 pt-3 grid grid-cols-2 gap-3 border-t border-zinc-900">
          <Button size="lg" variant="secondary" onClick={markSkipped}>
            {t('game.skip')}
          </Button>
          <Button size="lg" onClick={markCorrect}>
            {t('game.correct')}
          </Button>
        </div>
      )}

      {isExplainer && (!activeCard || activeCard.status !== 'pending') && (
        <div className="px-4 pb-6 pt-3 border-t border-zinc-900">
          <Button fullWidth size="lg" variant="secondary" disabled>
            {t('game.waiting_timer')}
          </Button>
        </div>
      )}
    </div>
  );
}
