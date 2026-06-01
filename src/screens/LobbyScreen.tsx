import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLobby } from '@/features/lobby/useLobby';
import { useRoom } from '@/features/room/useRoom';
import { useGameStore } from '@/shared/store/gameStore';
import { Button } from '@/shared/ui/Button';
import { Avatar } from '@/shared/ui/Avatar';
import { LanguageToggle } from '@/shared/ui/LanguageToggle';
import { QuoteRotator } from '@/shared/ui/QuoteRotator';
import { hapticImpact } from '@/shared/lib/telegram';

export function LobbyScreen() {
  const navigate = useNavigate();
  const {
    room, teams, roomPlayers, isHost, isTeamMode, myTeamId, canStart, assignTeam, startGame,
  } = useLobby();
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

  // 1v1 helpers
  const hostPlayer  = roomPlayers.find((rp) => rp.player_id === room.host_id);
  const player2     = roomPlayers.find((rp) => rp.player_id !== room.host_id);
  const isMe1v1Host = room.host_id === (hostPlayer?.player_id ?? -1);

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between p-4 pt-8 border-b border-brand-border">
        <button
          className="text-brand-muted hover:text-white transition-colors p-2 -ml-2"
          onClick={() => leaveRoom()}
        >
          {t('lobby.leave')}
        </button>
        <div className="flex flex-col items-center">
          <p className="text-brand-muted text-xs">{t('lobby.room_code')}</p>
          <button
            className="text-2xl font-black text-white tracking-widest hover:text-brand-accent transition-colors"
            onClick={copyCode}
          >
            {room.code}
          </button>
          <p className="text-brand-muted/50 text-xs">{t('lobby.tap_to_copy')}</p>
        </div>
        <div className="w-16 flex justify-end">
          <LanguageToggle />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* ── 1v1 layout: two player slots ── */}
        {!isTeamMode && (
          <div className="space-y-3">
            {/* Host slot */}
            <div className="bg-brand-surface rounded-2xl border border-brand-border p-4 flex items-center gap-3">
              {hostPlayer ? (
                <>
                  <Avatar
                    name={hostPlayer.player?.first_name ?? '?'}
                    src={hostPlayer.player?.avatar_url}
                    size="md"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-semibold truncate">
                      {hostPlayer.player?.first_name}
                      <span className="text-brand-accent ml-1.5">👑</span>
                    </p>
                    {isMe1v1Host && (
                      <p className="text-brand-accent text-xs">{t('lobby.your_team')}</p>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-brand-muted text-sm">…</p>
              )}
            </div>

            {/* Slot 2 */}
            {player2 ? (
              <div className="bg-brand-surface rounded-2xl border border-brand-border p-4 flex items-center gap-3">
                <Avatar
                  name={player2.player?.first_name ?? '?'}
                  src={player2.player?.avatar_url}
                  size="md"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold truncate">{player2.player?.first_name}</p>
                  {!isMe1v1Host && (
                    <p className="text-brand-accent text-xs">{t('lobby.your_team')}</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-brand-surface/50 rounded-2xl border border-brand-border/50 border-dashed p-6 flex flex-col items-center gap-2">
                <p className="text-brand-muted text-sm">{t('lobby.share_code')}</p>
                <p
                  className="text-3xl font-black tracking-widest"
                  style={{ color: '#22c55e' }}
                >
                  {room.code}
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Team mode: existing grid ── */}
        {isTeamMode && (
          <>
            <div className="grid grid-cols-2 gap-3">
              {teams.map((team) => {
                const members = playersByTeam(team.id);
                const isMyTeam = myTeamId === team.id;

                return (
                  <div
                    key={team.id}
                    className="bg-brand-surface rounded-2xl border border-brand-border overflow-hidden"
                  >
                    <div
                      className="px-4 py-3 flex items-center justify-between"
                      style={{ borderBottom: `2px solid ${team.color}` }}
                    >
                      <span className="font-bold text-white">{team.name}</span>
                      <span className="text-brand-muted text-sm">{members.length}</span>
                    </div>
                    <div className="px-3 py-2 space-y-2 min-h-[80px]">
                      {members.map((rp) => (
                        <div key={rp.id} className="flex items-center gap-2">
                          <Avatar
                            name={rp.player?.first_name ?? '?'}
                            src={rp.player?.avatar_url}
                            size="sm"
                          />
                          <span className="text-sm text-white truncate">
                            {rp.player?.first_name}
                            {room.host_id === rp.player_id && (
                              <span className="text-brand-accent ml-1">👑</span>
                            )}
                          </span>
                        </div>
                      ))}
                      {members.length === 0 && (
                        <p className="text-brand-muted/50 text-xs text-center pt-2">
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
                        <div className="text-center text-xs text-brand-accent font-semibold py-1">
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
              <div className="bg-brand-surface rounded-2xl border border-brand-border p-4">
                <p className="text-brand-muted text-sm mb-3">{t('lobby.not_assigned')}</p>
                <div className="flex flex-wrap gap-2">
                  {unassigned.map((rp) => (
                    <div key={rp.id} className="flex items-center gap-2 bg-brand-border rounded-xl px-3 py-1">
                      <Avatar name={rp.player?.first_name ?? '?'} size="sm" />
                      <span className="text-sm text-white">{rp.player?.first_name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Player count */}
        <div className="text-center">
          <p className="text-brand-muted text-sm">
            {t('lobby.players_in_lobby', { count: roomPlayers.length })}
          </p>
          {isTeamMode && (
            <p className="text-brand-muted/50 text-xs mt-1">
              {t('lobby.invite_friends')}
            </p>
          )}
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-3 text-center">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <QuoteRotator className="pt-2" />
      </div>

      {/* Start button */}
      <div className="p-4 border-t border-brand-border safe-bottom">
        {isHost ? (
          <>
            <Button
              fullWidth
              size="lg"
              loading={loading}
              disabled={!canStart}
              onClick={startGame}
            >
              {canStart
                ? t('lobby.start_game')
                : (!isTeamMode ? t('lobby.waiting_opponent') : t('lobby.waiting_for_teams'))}
            </Button>
            {!canStart && isTeamMode && (
              <p className="text-brand-muted text-xs text-center mt-2">
                {t('lobby.min_players')}
              </p>
            )}
          </>
        ) : (
          <div className="text-center py-3">
            <p className="text-brand-muted text-sm">{t('lobby.waiting_for_host')}</p>
            <div className="flex justify-center gap-1 mt-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full bg-brand-border animate-pulse"
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
