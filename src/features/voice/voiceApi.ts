import { supabase } from '@/shared/lib/supabase';
import { getRawInitData } from '@/shared/lib/telegram';
import {
  voiceProvider, voiceProviderMisconfigured,
  type VoiceCredentials, type VoiceProviderId,
} from './providers';

// Service addresses are public — they are just addresses, and the browser has
// to know where to connect. Every KEY and SECRET is absent by design: those
// live in Supabase secrets, where only the token Edge Function reads them.
//
// Daily and Agora need no address here at all: Daily's room URL is created
// per-room by the server, and Agora's app id travels with the token. So the
// "is voice configured" question is answered per provider, below.
const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL as string | undefined;

/**
 * Whether voice is configured at all. When it is not — no env var, no
 * deployed function — every entry point hides itself and the game plays
 * exactly as it does today. Voice is a layer on top, never a dependency.
 *
 * `VITE_VOICE_ENABLED` is the switch for providers that need nothing public.
 * Without it, a Daily or Agora deployment would have no way to say "yes, this
 * build has voice" and the UI would stay hidden with everything else correct.
 */
export function voiceEnabled(): boolean {
  if (voiceProviderMisconfigured()) return false;
  switch (voiceProvider()) {
    case 'livekit':
      return typeof LIVEKIT_URL === 'string' && LIVEKIT_URL.length > 0;
    case 'daily':
    case 'agora':
      return import.meta.env.VITE_VOICE_ENABLED === 'true';
  }
}

export function livekitUrl(): string {
  return LIVEKIT_URL ?? '';
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
  | 'provider_mismatch'     // 409 — this build and that deployment target different services
  | 'voice_not_configured'  // 503 — the server's secrets for its provider are missing
  | 'issue_failed'          // 503 — the voice service refused to mint a credential
  | 'lookup_failed'         // 503 — the server could not read the room, so it does not know
  // Neither:
  | 'network'               // no answer at all
  | 'malformed'             // 200 carrying no usable credential
  // The token was granted and the SERVICE is what failed. Split out of
  // 'network' because the two need opposite fixes and were indistinguishable
  // on the player's screen for a week: "нет связи с сервером" was reported
  // while the function answered 200 and the voice service was the half that
  // would not come up.
  | 'sdk_failed'            // the adapter's chunk would not load
  | 'join_failed'           // the service refused the join
  | 'join_timeout';         // the service took the token and never answered

export type VoiceGrant =
  | { ok: true; credentials: VoiceCredentials }
  | { ok: false; reason: VoiceUnavailableReason };

/** Error codes the Edge Function returns; see its README for the full table. */
const SERVER_REASONS: readonly VoiceUnavailableReason[] = [
  'bad_request', 'unauthorized', 'not_in_room', 'no_such_room',
  'room_finished', 'no_team_yet', 'provider_mismatch', 'voice_not_configured',
  'issue_failed', 'lookup_failed',
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
export async function fetchVoiceToken(
  roomId: string,
  /**
   * Which service to be signed for. Defaults to the build's own, so a caller
   * that is not walking the failover ladder behaves exactly as before. The
   * server will only honour a provider it holds secrets for — it answers with
   * the list it can serve, and refuses the rest (supabase/functions/README).
   */
  provider: VoiceProviderId = voiceProvider(),
): Promise<VoiceGrant> {
  if (!voiceEnabled()) return { ok: false, reason: 'not_configured' };

  // Nothing to prove who we are: the request is not sent at all, which is why
  // this failure leaves no POST in the function's log.
  const initData = getRawInitData();
  if (!initData) return { ok: false, reason: 'no_init_data' };

  // The function name is historical — it issues tokens for whichever service
  // is configured, not only LiveKit. Renaming it would strand the deployed
  // frontends that call this one, which is the mistake `pick_random_cards`
  // already taught this project once (CLAUDE.md).
  const { data, error } = await supabase.functions.invoke('livekit-token', {
    body: { initData, roomId, provider },
  });
  if (error) return { ok: false, reason: await reasonFromError(error) };
  if (!data?.token || !data?.channel) return { ok: false, reason: 'malformed' };

  return {
    ok: true,
    credentials: {
      // The server's answer wins over the build's guess: it is the side that
      // holds the secrets, so it is the side that knows which service it just
      // signed for. A build pointed at the wrong provider fails loudly in the
      // adapter rather than quietly joining nothing.
      provider: data.provider ?? voiceProvider(),
      token: data.token as string,
      channel: data.channel as string,
      // LiveKit's address is public and known at build time; the others are
      // per-room and only the server can say.
      url: (data.url as string | undefined) ?? (livekitUrl() || undefined),
      identity: data.identity as string | undefined,
      appId: data.appId as string | undefined,
    },
  };
}
