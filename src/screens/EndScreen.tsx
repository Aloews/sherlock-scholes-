import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useGameStore } from '@/shared/store/gameStore';
import { Scoreboard } from '@/shared/ui/Scoreboard';
import { Button } from '@/shared/ui/Button';
import { hapticSuccess } from '@/shared/lib/telegram';

export function EndScreen() {
  const navigate = useNavigate();
  const { teams, teamScores, scores, roomPlayers, reset } = useGameStore();
  const { t } = useTranslation();

  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(true);
      hapticSuccess();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const sorted = [...teamScores].sort((a, b) => b.total_points - a.total_points);
  const winner = sorted[0];
  const isDraw = sorted.length >= 2 && sorted[0].total_points === sorted[1].total_points;

  // Per-round breakdown
  const allRoundsData = teams.map((team) => {
    const teamRoundScores = scores.filter((s) => s.team_id === team.id);
    return { team, rounds: teamRoundScores };
  });

  const handlePlayAgain = () => {
    reset();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col overflow-y-auto">
      {/* Trophy hero */}
      <div
        className={`flex flex-col items-center pt-12 pb-8 px-6 transition-all duration-700 ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
        <div className="text-8xl mb-4">
          {isDraw ? '🤝' : '🏆'}
        </div>
        <h1 className="text-3xl font-black text-white text-center">
          {isDraw ? t('end.draw') : t('end.wins', { name: winner?.team_name })}
        </h1>
        {!isDraw && winner && (
          <p className="text-emerald-400 font-semibold mt-2">
            {t('end.points', { count: winner.total_points })}
          </p>
        )}
      </div>

      {/* Scoreboard */}
      <div className={`px-4 transition-all duration-700 delay-200 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      }`}>
        <Scoreboard scores={teamScores} showWinner={!isDraw} />
      </div>

      {/* Per-round breakdown */}
      {allRoundsData.some((d) => d.rounds.length > 0) && (
        <div className={`px-4 mt-6 transition-all duration-700 delay-300 ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}>
          <p className="text-zinc-500 text-sm uppercase tracking-wider mb-3">
            {t('end.round_breakdown')}
          </p>
          <div className="space-y-2">
            {allRoundsData.map(({ team, rounds }) => (
              <div key={team.id} className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: team.color }} />
                  <span className="font-semibold text-white">{team.name}</span>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {rounds.map((r, i) => (
                    <div key={r.id} className="bg-zinc-800 rounded-xl px-3 py-1 text-center">
                      <p className="text-white font-bold text-sm">{r.points}</p>
                      <p className="text-zinc-500 text-xs">{t('end.round_short', { n: i + 1 })}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Player list */}
      <div className={`px-4 mt-4 transition-all duration-700 delay-400 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      }`}>
        <p className="text-zinc-500 text-sm uppercase tracking-wider mb-3">{t('end.players')}</p>
        <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
          <div className="flex flex-wrap gap-2">
            {roomPlayers.map((rp) => {
              const team = teams.find((tm) => tm.id === rp.team_id);
              return (
                <div
                  key={rp.id}
                  className="flex items-center gap-2 bg-zinc-800 rounded-xl px-3 py-1"
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: team?.color ?? '#52525b' }}
                  />
                  <span className="text-sm text-zinc-300">
                    {rp.player?.first_name ?? t('end.player_default')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className={`px-4 py-8 mt-auto transition-all duration-700 delay-500 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      }`}>
        <Button fullWidth size="lg" onClick={handlePlayAgain}>
          {t('end.play_again')}
        </Button>
      </div>
    </div>
  );
}
