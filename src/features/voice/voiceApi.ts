import { supabase } from '@/shared/lib/supabase';
import { getRawInitData } from '@/shared/lib/telegram';

// The LiveKit server URL is public — it is just an address, and the browser
// has to know it to connect. The API key and secret are NOT here and must
// never be: they live in Supabase secrets, and only the livekit-token Edge
// Function ever sees them.
const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL as string | undefined;

/**
 * Whether voice is configured at all. When it is not — no env var, no
 * deployed function — every entry point hides itself and the game plays
 * exactly as it does today. Voice is a layer on top, never a dependency.
 */
export function voiceEnabled(): boolean {
  return typeof LIVEKIT_URL === 'string' && LIVEKIT_URL.length > 0;
}

export function livekitUrl(): string {
  return LIVEKIT_URL ?? '';
}

export interface VoiceToken {
  token: string;
  /** The channel the server picked. Informational — the token already binds it. */
  channel: string;
}

/**
 * Asks the server for permission to talk in this room.
 *
 * Note what is NOT sent: the channel name, and the player id. The server
 * derives both — the id from the validated Telegram initData, the channel
 * from the player's team in that room. A client that could name its own
 * channel could join the opposing team's and hear the explainer.
 *
 * Returns null whenever voice is unavailable for this player right now
 * (not configured, not in the room, no team picked yet, game finished).
 * That is an ordinary answer, not an error: the caller hides the button.
 */
export async function fetchVoiceToken(roomId: string): Promise<VoiceToken | null> {
  if (!voiceEnabled()) return null;
  const initData = getRawInitData();
  if (!initData) return null;

  const { data, error } = await supabase.functions.invoke('livekit-token', {
    body: { initData, roomId },
  });
  if (error || !data?.token) return null;
  return { token: data.token as string, channel: data.channel as string };
}
