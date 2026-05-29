import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLobby } from '@/features/lobby/useLobby';
import { useRoom } from '@/features/room/useRoom';
import { useGameStore } from '@/shared/store/gameStore';
import { Button } from '@/shared/ui/Button';
import { Avatar } from '@/shared/ui/Avatar';
import { LanguageToggle } from '@/shared/ui/LanguageToggle';
import { hapticImpact } from '@/shared/lib/telegram';

export function LobbyScreen() {
  const navigate = useNavigate();
  const { room, teams, roomPlayers, isHost, myTeamId, canStart, assignTeam, startGame } = useLobby();
  const { leaveRoom } = useRoom();
  const { loading, error } = useGameStore();
  const { t } = useTranslation();

  useEffect(() => {
    if (!room) navigate('/');
  }, [room, navigate]);

  if (!room) return null;

  const copyCode = () => {
    navigator.clipboard.writeText(room.code);
    hapticImpact('light');
  };

  const playersByTeam = (teamId: string) =>
    roomPlayers.filter((rp) => rp.team_id === teamId);

  const unassigned = roomPlayers.filter((rp) => rp.team_id === null);

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between p-4 pt-8 border-b border-zinc-900">
        <button
          className="text-zinc-400 hover:text-white transition-colors p-2 -ml-2"
          onClick={() => leaveRoom()}
        >
          {t('lobby.leave')}
        </button>
        <div className="flex flex-col items-center">
          <p className="text-zinc-500 text-xs">{t('lobby.room_code')}</p>
          <button
            className="text-2xl font-black text-white tracking-widest hover:text-emerald-400 transition-colors"
            onClick={copyCode}
          >
            {room.code}
          </button>
          <p className="text-zinc-600 text-xs">{t('lobby.tap_to_copy')}</p>
        </div>
        <div className="w-16 flex justify-end">
          <LanguageToggle />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Teams */}
        <div className="grid grid-cols-2 gap-3">
          {teams.map((team) => {
            const members = playersByTeam(team.id);
            const isMyTeam = myTeamId === team.id;

            return (
              <div
                key={team.id}
                className="bg-zinc-900 rounded-2xl border border-zinc-800 overflow-hidden"
              >
                <div
                  className="px-4 py-3 flex items-center justify-between"
                  style={{ borderBottom: `2px solid ${team.color}` }}
                >
                  <span className="font-bold text-white">{team.name}</span>
                  <span className="text-zinc-500 text-sm">{members.length}</span>
                </div>
                <div className="px-3 py-2 space-y-2 min-h-[80px]">
                  {members.map((rp) => (
                    <div key={rp.id} className="flex items-center gap-2">
                      <Avatar
                        name={rp.player?.first_name ?? '?'}
                        src={rp.player?.avatar_url}
                        size="sm"
                      />
                      <span className="text-sm text-zinc-300 truncate">
                        {rp.player?.first_name}
                        {room.host_id === rp.player_id && (
                          <span className="text-emerald-500 ml-1">👑</span>
                        )}
                      </span>
                    </div>
                  ))}
                  {members.length === 0 && (
                    <p className="text-zinc-700 text-xs text-center pt-2">
                      {t('lobby.empty')}
                    </p>
                  )}
                </div>
                {myTeamId !== team.id && (
                  <div className="px-3 pb-3">
                    <Button
                      fullWidth
                      size="sm"
                      variant={isMyTeam ? 'primary' : 'ghost'}
                      onClick={() => assignTeam(team.id)}
                    >
                      {t('lobby.join_team')}
                    </Button>
                  </div>
                )}
                {isMyTeam && (
                  <div className="px-3 pb-3">
                    <div className="text-center text-xs text-emerald-500 font-semibold py-1">
                      {t('lobby.your_team')}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Unassigned players */}
        {unassigned.length > 0 && (
          <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-4">
            <p className="text-zinc-500 text-sm mb-3">{t('lobby.not_assigned')}</p>
            <div className="flex flex-wrap gap-2">
              {unassigned.map((rp) => (
                <div key={rp.id} className="flex items-center gap-2 bg-zinc-800 rounded-xl px-3 py-1">
                  <Avatar name={rp.player?.first_name ?? '?'} size="sm" />
                  <span className="text-sm text-zinc-300">{rp.player?.first_name}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Player count */}
        <div className="text-center">
          <p className="text-zinc-600 text-sm">
            {t('lobby.players_in_lobby', { count: roomPlayers.length })}
          </p>
          <p className="text-zinc-700 text-xs mt-1">
            {t('lobby.invite_friends')}
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-3 text-center">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}
      </div>

      {/* Start button (host only) */}
      <div className="p-4 border-t border-zinc-900 safe-bottom">
        {isHost ? (
          <Button
            fullWidth
            size="lg"
            loading={loading}
            disabled={!canStart}
            onClick={startGame}
          >
            {canStart ? t('lobby.start_game') : t('lobby.waiting_for_teams')}
          </Button>
        ) : (
          <div className="text-center py-3">
            <p className="text-zinc-500 text-sm">{t('lobby.waiting_for_host')}</p>
            <div className="flex justify-center gap-1 mt-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-zinc-600 animate-pulse"
                  style={{ animationDelay: `${i * 200}ms` }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
