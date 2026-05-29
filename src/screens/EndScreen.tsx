import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconShare } from '@tabler/icons-react';
import { useGameStore } from '@/shared/store/gameStore';
import { useAuthStore } from '@/shared/store/authStore';
import { Scoreboard } from '@/shared/ui/Scoreboard';
import { Button } from '@/shared/ui/Button';
import { hapticSuccess, hapticImpact } from '@/shared/lib/telegram';

export function EndScreen() {
  const navigate = useNavigate();
  const { room, teams, teamScores, scores, roomPlayers, reset } = useGameStore();
  const { player } = useAuthStore();
  const { t } = useTranslation();

  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(true);
      hapticSuccess();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

  const sorted  = [...teamScores].sort((a, b) => b.total_points - a.total_points);
  const winner  = sorted[0];
  const isDraw  = sorted.length >= 2 && sorted[0].total_points === sorted[1].total_points;
  const is1v1   = room?.mode === '1v1';

  const allRoundsData = teams.map((team) => {
    const teamRoundScores = scores.filter((s) => s.team_id === team.id);
    return { team, rounds: teamRoundScores };
  });

  const handlePlayAgain = () => {
    reset();
    navigate('/');
  };

  const handleShare = () => {
    hapticImpact('medium');

    const myRoomPlayer = roomPlayers.find((rp) => rp.player_id === player?.id);
    const myTeamScore  = teamScores.find((ts) => ts.team_id === myRoomPlayer?.team_id);
    const otherScores  = teamScores.filter((ts) => ts.team_id !== myRoomPlayer?.team_id);

    const myScore       = myTeamScore?.total_points ?? 0;
    const opponentScore = otherScores.length > 0
      ? Math.max(...otherScores.map((s) => s.total_points))
      : 0;
    const diff = myScore - opponentScore;

    let key: string;
    if      (diff >= 5)  key = 'share.win_blowout';
    else if (diff >= 2)  key = 'share.win_normal';
    else if (diff === 1) key = 'share.win_close';
    else if (diff === 0) key = 'share.draw';
    else if (diff === -1) key = 'share.lose_close';
    else if (diff <= -5) key = 'share.lose_blowout';
    else                 key = 'share.lose_normal';

    const win  = Math.max(myScore, opponentScore);
    const lose = Math.min(myScore, opponentScore);
    const text = t(key, { win, lose, score: myScore });

    const botLink = 'https://t.me/sherlock_scholes_bot';
    const url = `https://t.me/share/url?url=${encodeURIComponent(botLink)}&text=${encodeURIComponent(text)}`;

    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.openTelegramLink(url);
    } else {
      window.open(url, '_blank');
    }
  };

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col overflow-y-auto">
      {/* Trophy hero */}
      <div
        className={`flex flex-col items-center pt-12 pb-8 px-6 transition-all duration-700 ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}
      >
        <div className="text-8xl mb-4">{isDraw ? '🤝' : '🏆'}</div>
        <h1 className="text-3xl font-black text-white text-center">
          {isDraw ? t('end.draw') : t('end.wins', { name: winner?.team_name })}
        </h1>
        {!isDraw && winner && (
          <p className="text-brand-accent font-semibold mt-2">
            {t('end.points', { count: winner.total_points })}
          </p>
        )}
      </div>

      {/* Scoreboard — works for both modes (1v1 teams are named after players) */}
      <div className={`px-4 transition-all duration-700 delay-200 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      }`}>
        <Scoreboard scores={teamScores} showWinner={!isDraw} animated />
      </div>

      {/* Per-round breakdown */}
      {allRoundsData.some((d) => d.rounds.length > 0) && (
        <div className={`px-4 mt-6 transition-all duration-700 delay-300 ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}>
          <p className="text-brand-muted text-sm uppercase tracking-wider mb-3">
            {t('end.round_breakdown')}
          </p>
          <div className="space-y-2">
            {allRoundsData.map(({ team, rounds }) => (
              <div key={team.id} className="bg-brand-surface rounded-2xl border border-brand-border p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: team.color }} />
                  <span className="font-semibold text-white">{team.name}</span>
                </div>
                <div className="flex gap-3 flex-wrap">
                  {rounds.map((r, i) => (
                    <div key={r.id} className="flex flex-col items-center gap-1">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center font-black text-base ${
                        r.points >= 1
                          ? 'bg-brand-accent text-brand-bg'
                          : 'bg-transparent border-2 border-brand-border text-brand-muted'
                      }`}>
                        {i + 1}
                      </div>
                      <span className={`text-xs font-bold ${
                        r.points >= 1 ? 'text-brand-accent' : 'text-brand-muted'
                      }`}>
                        {r.points >= 1 ? `+${r.points}` : '0'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Players — hidden in 1v1 (scoreboard already shows players by name) */}
      {!is1v1 && (
        <div className={`px-4 mt-4 transition-all duration-700 delay-400 ${
          visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
        }`}>
          <p className="text-brand-muted text-sm uppercase tracking-wider mb-3">{t('end.players')}</p>
          <div className="bg-brand-surface rounded-2xl border border-brand-border p-4">
            <div className="flex flex-wrap gap-2">
              {roomPlayers.map((rp) => {
                const team = teams.find((tm) => tm.id === rp.team_id);
                return (
                  <div
                    key={rp.id}
                    className="flex items-center gap-2 bg-brand-border rounded-xl px-3 py-1"
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: team?.color ?? '#1F2740' }}
                    />
                    <span className="text-sm text-white">
                      {rp.player?.first_name ?? t('end.player_default')}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className={`px-4 py-8 mt-auto space-y-3 transition-all duration-700 delay-500 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      }`}>
        <Button fullWidth size="lg" onClick={handleShare}>
          <span className="flex items-center justify-center gap-2">
            <IconShare size={20} stroke={1.5} />
            {t('share.button')}
          </span>
        </Button>
        <Button fullWidth size="lg" variant="secondary" onClick={handlePlayAgain}>
          {t('end.play_again')}
        </Button>
      </div>
    </div>
  );
}
