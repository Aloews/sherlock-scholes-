import { createContext, useContext, type ReactNode } from 'react';
import { useGameStore } from '@/shared/store/gameStore';
import { useVoiceChat } from './useVoiceChat';

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
  const session = useVoiceChat(roomId);
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
