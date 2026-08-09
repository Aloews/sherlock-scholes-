import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useGameStore } from '@/shared/store/gameStore';
import { useSettingsStore } from '@/shared/store/settingsStore';
import { useAuthStore } from '@/shared/store/authStore';
import { useVoiceChat } from './useVoiceChat';
import { useAutoConnect } from './useAutoConnect';
import { voiceEnabled } from './voiceApi';

/**
 * One voice session for the whole app, held ABOVE the router.
 *
 * THE BUG THIS FIXES. VoiceControl lived only in LobbyScreen, and
 * useVoiceChat disconnects on unmount — deliberately, so leaving a screen
 * never leaves a microphone open. But starting a game navigates lobby →
 * /game, which unmounts the lobby, which tore the channel down at exactly the
 * moment the players needed it. Voice could be joined in the lobby and was
 * physically impossible during the game.
 *
 * Mounting the session here, outside the routes, means the connection
 * survives navigation. The unmount cleanup still holds: this provider only
 * unmounts when the app itself goes away.
 *
 * The room comes from the store rather than a prop, because the screens that
 * show the controls are on different routes and must not have to agree about
 * which room is current.
 */
type VoiceSession = ReturnType<typeof useVoiceChat>;

const VoiceContext = createContext<VoiceSession | null>(null);

export function VoiceProvider({ children }: { children: ReactNode }) {
  const roomId = useGameStore((s) => s.room?.id ?? null);
  const mode = useGameStore((s) => s.room?.mode ?? null);
  const myId = useAuthStore((s) => s.player?.id ?? null);
  const myTeamId = useGameStore(
    (s) => s.roomPlayers.find((rp) => rp.player_id === myId)?.team_id ?? null,
  );
  const optedOut = useSettingsStore((s) => !s.voiceAutoConnect);
  // The service the ROOM is on. Written only by the server, and it arrives
  // here through the ordinary realtime UPDATE on `rooms` that the lobby and
  // the game already subscribe to.
  const roomProvider = useGameStore((s) => s.room?.voice_provider ?? null);
  const session = useVoiceChat(roomId);

  /**
   * Follow the room when it changes service.
   *
   * One player's failure moves the whole room — that is the only way a channel
   * stays shared, because a channel lives inside one vendor. Everyone else is
   * still happily connected to the old one, talking to nobody. They cannot
   * notice on their own: their link is fine, it is simply somewhere the others
   * are not, and it looks exactly like a room where nobody is speaking.
   *
   * Dropping the session is enough to fix it. Auto-connect below sees 'off'
   * and reconnects, and the server now signs for the new service.
   */
  const { status, active, disconnect } = session;
  useEffect(() => {
    if (status !== 'on' || !roomProvider || roomProvider === active) return;
    disconnect();
  }, [status, active, roomProvider, disconnect]);

  // Joining on arrival rather than on a tap. The policy — and every place it
  // refuses to act — is in connectPolicy.ts, next to its tests.
  useAutoConnect({
    enabled: voiceEnabled(),
    status: session.status,
    reason: session.reason,
    roomId,
    // Team mode with nobody's team picked: the server refuses by design, so
    // there is nothing to attempt yet.
    needsTeam: mode !== '1v1' && myTeamId === null,
    optedOut,
    connect: session.connect,
  });

  return <VoiceContext.Provider value={session}>{children}</VoiceContext.Provider>;
}

/**
 * The shared session. Throws rather than silently handing back a dead stub:
 * a VoiceControl rendered outside the provider would look connected and
 * carry no audio, which is the failure this whole file exists to end.
 */
export function useVoice(): VoiceSession {
  const ctx = useContext(VoiceContext);
  if (!ctx) throw new Error('useVoice() outside <VoiceProvider>');
  return ctx;
}
