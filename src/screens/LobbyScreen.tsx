import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLobby } from '@/features/lobby/useLobby';
import { useRoom } from '@/features/room/useRoom';
import { useGameStore } from '@/shared/store/gameStore';
import { useAuthStore } from '@/shared/store/authStore';
import { Button } from '@/shared/ui/Button';
import { Avatar } from '@/shared/ui/Avatar';
import { LanguageToggle } from '@/shared/ui/LanguageToggle';
import { QuoteRotator } from '@/shared/ui/QuoteRotator';
import { hapticImpact, hapticError, openTelegramLink } from '@/shared/lib/telegram';
import { copyText, deepLink, shareLink } from '@/features/lobby/invite';
import { RoomDeckPanel } from '@/features/lobby/RoomDeckPanel';
import { InviteFriendsPanel } from '@/features/lobby/InviteFriendsPanel';
import { VoiceControl } from '@/features/voice/VoiceControl';
import { QrCode } from '@/shared/ui/QrCode';
import { useDesign } from '@/shared/design/useDesign';
import { IconCheck, IconUserPlus, IconQrcode } from '@tabler/icons-react';

/** How long the code label stays on "Copied" before going back to the hint. */
const COPY_FEEDBACK_MS = 2000;

type CopyState = 'idle' | 'code' | 'link' | 'failed';

export function LobbyScreen() {
  const master = useDesign() === 'master';
  const navigate = useNavigate();
  const {
    room, teams, roomPlayers, isHost, isTeamMode, myTeamId, canStart, assignTeam, startGame,
    deckFilter, deckCount, deckError, setDeck,
  } = useLobby();
  const { leaveRoom } = useRoom();
  const { loading, error } = useGameStore();
  const me = useAuthStore((s) => s.player);
  const { t } = useTranslation();

  useEffect(() => {
    if (!room) navigate('/');
  }, [room, navigate]);

  // The label under the code answers back for a moment, so copying is not a
  // silent act of faith. Cleared on unmount — the timer outlives the screen.
  const [copied, setCopied] = useState<CopyState>('idle');
  // The QR is for the table, not the chat: the other phone is right here, and
  // reading six characters aloud is what it replaces. Hidden until asked for —
  // it is a big white square in a dark room.
  const [showQr, setShowQr] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  const flash = (state: CopyState) => {
    setCopied(state);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied('idle'), COPY_FEEDBACK_MS);
  };

  if (!room) return null;

  // Buzz only on success. The old version fired the haptic unconditionally
  // next to an unawaited clipboard promise, so a refused copy still felt like
  // one that worked.
  const copyCode = async () => {
    const ok = await copyText(room.code);
    if (ok) hapticImpact('light'); else hapticError();
    flash(ok ? 'code' : 'failed');
  };

  // Telegram's share sheet with a startapp link, so the invitee lands in the
  // Mini App with the code already in the field instead of retyping six
  // characters read out loud. Outside Telegram there is no sheet: copy the
  // same link and say so.
  const invite = async () => {
    hapticImpact('light');
    const text = t('lobby.invite_text', { code: room.code });
    if (openTelegramLink(shareLink(room.code, text))) return;
    const ok = await copyText(deepLink(room.code));
    flash(ok ? 'link' : 'failed');
  };

  const codeHint = copied === 'code'   ? t('lobby.copied')
                 : copied === 'link'   ? t('lobby.link_copied')
                 : copied === 'failed' ? t('lobby.copy_failed')
                 : t('lobby.tap_to_copy');

  const playersByTeam = (teamId: string) =>
    roomPlayers.filter((rp) => rp.team_id === teamId);

  const unassigned = roomPlayers.filter((rp) => rp.team_id === null);

  // 1v1 helpers
  const hostPlayer  = roomPlayers.find((rp) => rp.player_id === room.host_id);
  const player2     = roomPlayers.find((rp) => rp.player_id !== room.host_id);
  const isMe1v1Host = room.host_id === (hostPlayer?.player_id ?? -1);

  return (
    <div className="min-h-screen bg-brand-bg ds-screen flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between p-4 pt-8 border-b border-brand-border">
        <button
          className="text-brand-muted hover:text-white transition-colors p-2 -ml-2"
          onClick={() => { hapticImpact('light'); leaveRoom(); }}
        >
          {t('lobby.leave')}
        </button>
        <div className="flex flex-col items-center">
          <p className="text-brand-muted text-xs">{t('lobby.room_code')}</p>
          <button
            className={`text-2xl font-black text-white tracking-widest hover:text-brand-accent transition-colors ${master ? 'ds-display' : ''}`}
            onClick={() => { void copyCode(); }}
          >
            {room.code}
          </button>
          <p
            className={`text-xs ${copied === 'failed' ? 'text-red-400'
              : copied === 'idle' ? 'text-brand-muted/50' : 'text-brand-accent'}`}
            aria-live="polite"
          >
            {codeHint}
          </p>
        </div>
        <div className="w-16 flex justify-end">
          <LanguageToggle />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        <div className="flex gap-2">
          <Button fullWidth variant="secondary" onClick={() => { void invite(); }}>
            <IconUserPlus size={18} stroke={2} />
            {t('lobby.invite_button')}
          </Button>
          <Button
            variant="secondary"
            onClick={() => { hapticImpact('light'); setShowQr((v) => !v); }}
            aria-expanded={showQr}
          >
            <IconQrcode size={18} stroke={2} />
            <span className="sr-only">{t('lobby.qr_button')}</span>
          </Button>
        </div>

        {showQr && (
          <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-4 flex flex-col items-center gap-3 animate-fade-in">
            <QrCode
              value={deepLink(room.code)}
              size={200}
              label={t('lobby.qr_alt', { code: room.code })}
            />
            <p className="text-brand-muted text-xs text-center">{t('lobby.qr_hint')}</p>
          </div>
        )}

        {/* The code-free way in: tap a name, and they get an invitation on
            their home screen. The link and QR above stay for everybody the
            game has never seen this player with. */}
        <InviteFriendsPanel roomId={room.id} playerId={me?.id ?? null} />

        {/* Voice is opt-in and asks for the microphone only when tapped.
            Renders nothing when LiveKit is unconfigured. In team mode the
            channel is the team's, so there is nothing to join until a team is
            picked — say that instead of "unavailable". */}
        <VoiceControl roomId={room.id} needsTeam={isTeamMode && !myTeamId} />

        {/* What this room deals. The host edits it; everyone else reads it,
            following through the realtime UPDATE on `rooms`. */}
        <RoomDeckPanel
          filter={deckFilter}
          count={deckCount}
          isHost={isHost}
          failed={deckError}
          onChange={setDeck}
        />

        {/* ── 1v1 layout: two player slots ── */}
        {!isTeamMode && (
          <div className="space-y-3">
            {/* Host slot */}
            <div className="ds-panel bg-brand-surface rounded-2xl border border-brand-border p-4 flex items-center gap-3">
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
              <div className="ds-panel bg-brand-surface rounded-2xl border border-brand-border p-4 flex items-center gap-3">
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
                    className={`ds-panel bg-brand-surface rounded-2xl border overflow-hidden ${
                      master && isMyTeam ? 'border-brand-accent/45' : 'border-brand-border'
                    }`}
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
                        <div className="flex items-center justify-center gap-1.5 text-xs text-brand-accent font-semibold py-1">
                          {master && <IconCheck size={13} stroke={2.5} />}
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
              <div className="ds-panel bg-brand-surface rounded-2xl border border-brand-border p-4">
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
