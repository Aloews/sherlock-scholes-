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
 * Why voice is not available right now.
 *
 * This exists because "unavailable" used to cover every one of these at once.
 * On production the lobby said "Недоступен" and the Edge Function log showed a
 * preflight with no POST after it, and there was no way to tell from the app
 * whether the request had been refused or had never been sent
 * (docs/LOBBY_AND_VOICE_FIXES.md §3). The two need opposite fixes.
 *
 * `no_init_data` is the one that never reaches the server: Telegram gave the
 * WebApp nothing to prove who the player is, so there is nothing to ask with.
 */
export type VoiceUnavailableReason =
  // Never leaves the browser:
  | 'not_configured'        // no VITE_LIVEKIT_URL in this build
  | 'no_init_data'          // Telegram supplied no initData — outside Telegram, or a cold start
  // The server was asked and answered:
  | 'bad_request'           // 400
  | 'unauthorized'          // 401 — initData failed the HMAC check
  | 'not_in_room'           // 403
  | 'no_such_room'          // 404
  | 'room_finished'         // 409
  | 'no_team_yet'           // 409 — team mode, no side picked yet
  | 'voice_not_configured'  // 503 — the server's LiveKit secrets are missing
  // Neither:
  | 'network'               // no answer at all
  | 'malformed';            // 200 carrying no token

export type VoiceGrant =
  | { ok: true; token: string; channel: string }
  | { ok: false; reason: VoiceUnavailableReason };

/** Error codes the Edge Function returns; see its README for the full table. */
const SERVER_REASONS: readonly VoiceUnavailableReason[] = [
  'bad_request', 'unauthorized', 'not_in_room', 'no_such_room',
  'room_finished', 'no_team_yet', 'voice_not_configured',
];

/**
 * Pulls the function's own error code out of a supabase-js error.
 *
 * A non-2xx arrives as FunctionsHttpError with the untouched Response on
 * `context`, so the body has to be read back to learn WHICH refusal it was.
 * Anything unreadable is reported as a network failure rather than guessed at.
 */
async function reasonFromError(error: unknown): Promise<VoiceUnavailableReason> {
  const context = (error as { context?: unknown })?.context;
  const asResponse = context as { json?: () => Promise<unknown> } | undefined;
  if (typeof asResponse?.json !== 'function') return 'network';
  try {
    const body = await asResponse.json();
    const code = (body as { error?: unknown })?.error;
    return SERVER_REASONS.find((r) => r === code) ?? 'network';
  } catch {
    return 'network';
  }
}

/**
 * Asks the server for permission to talk in this room.
 *
 * Note what is NOT sent: the channel name, and the player id. The server
 * derives both — the id from the validated Telegram initData, the channel
 * from the player's team in that room. A client that could name its own
 * channel could join the opposing team's and hear the explainer.
 *
 * Unavailability is an ordinary answer, not an error — but it now comes back
 * WITH ITS REASON. Collapsing every refusal into one silent null is what made
 * the production failure impossible to place from the outside.
 */
export async function fetchVoiceToken(roomId: string): Promise<VoiceGrant> {
  if (!voiceEnabled()) return { ok: false, reason: 'not_configured' };

  // Nothing to prove who we are: the request is not sent at all, which is why
  // this failure leaves no POST in the function's log.
  const initData = getRawInitData();
  if (!initData) return { ok: false, reason: 'no_init_data' };

  const { data, error } = await supabase.functions.invoke('livekit-token', {
    body: { initData, roomId },
  });
  if (error) return { ok: false, reason: await reasonFromError(error) };
  if (!data?.token) return { ok: false, reason: 'malformed' };
  return { ok: true, token: data.token as string, channel: data.channel as string };
}
