// Which services this build can talk to, and how their SDKs get loaded.
//
// TWO variables, not one, because failover needs two adapters in the bundle:
//
//   VITE_VOICE_PROVIDER   the service to use
//   VITE_VOICE_FALLBACK   the one to try when that service will not come up
//
// Both are substituted by Vite as literals before Rollup runs, so the guards
// below fold away and an adapter nobody named — with its SDK, several hundred
// KB — never enters the build. A deployment with no fallback ships one SDK; a
// deployment with no voice at all ships none.
//
// THE SHAPE OF THESE GUARDS IS LOAD-BEARING, and both halves were arrived at
// by building and measuring `dist/`:
//
//   * Compare against the RAW literal. Routing through a function defeats the
//     fold: the call is not evaluable at build time, every branch survives,
//     and every deployment ships every SDK.
//   * `if`, not `switch`. Rollup eliminates dead if-branches and does NOT
//     eliminate dead switch-cases. The switch version built all three.
//
// See docs/VOICE_PROVIDERS.md §5 for the measured table.

import { isVoiceProviderId, type VoiceProviderId, type VoiceTransport } from './types';

const CONFIGURED = import.meta.env.VITE_VOICE_PROVIDER as string | undefined;
const FALLBACK = import.meta.env.VITE_VOICE_FALLBACK as string | undefined;

/**
 * The service this build prefers.
 *
 * Defaults to LiveKit because that is what production ran first: a deployment
 * that sets only `VITE_LIVEKIT_URL` keeps working untouched.
 */
export function voiceProvider(): VoiceProviderId {
  return isVoiceProviderId(CONFIGURED) ? CONFIGURED : 'livekit';
}

/**
 * The service to try when the preferred one will not come up. Null when none
 * is configured, which is the ordinary case.
 *
 * A fallback equal to the primary is treated as absent — retrying the same
 * service through the same path is not failover, it is a second helping of
 * the same failure.
 */
export function voiceFallback(): VoiceProviderId | null {
  if (!isVoiceProviderId(FALLBACK)) return null;
  return FALLBACK === voiceProvider() ? null : FALLBACK;
}

/** Preferred first, fallback second. What connect() walks. */
export function voiceChain(): VoiceProviderId[] {
  const fallback = voiceFallback();
  return fallback ? [voiceProvider(), fallback] : [voiceProvider()];
}

/** True when either variable is set to a name nobody implements. */
export function voiceProviderMisconfigured(): boolean {
  const named = (value: string | undefined) =>
    typeof value === 'string' && value.length > 0 && !isVoiceProviderId(value);
  return named(CONFIGURED) || named(FALLBACK);
}

/**
 * The adapter for one service.
 *
 * Throws rather than falling back to LiveKit when asked for something this
 * build does not carry: a silent substitution would hand LiveKit a Daily
 * token and wait for a connection that cannot happen, which is the failure
 * this whole seam exists to make loud.
 */
export async function loadTransport(id: VoiceProviderId): Promise<VoiceTransport> {
  // Unreachable at runtime — connect() checks voiceEnabled() first — and that
  // is not what this is for. Against the raw literals it folds to a bare
  // `throw` in a build with no voice configured, making every import() below
  // unreachable and taking all three SDKs out of `dist/`.
  if (!import.meta.env.VITE_LIVEKIT_URL && import.meta.env.VITE_VOICE_ENABLED !== 'true') {
    throw new Error('voice is not configured in this build');
  }

  if (id === 'daily' && (
    import.meta.env.VITE_VOICE_PROVIDER === 'daily' || import.meta.env.VITE_VOICE_FALLBACK === 'daily'
  )) {
    return (await import('./daily')).dailyTransport;
  }

  if (id === 'agora' && (
    import.meta.env.VITE_VOICE_PROVIDER === 'agora' || import.meta.env.VITE_VOICE_FALLBACK === 'agora'
  )) {
    return (await import('./agora')).agoraTransport;
  }

  if (id === 'livekit' && (
    import.meta.env.VITE_VOICE_PROVIDER !== 'daily' && import.meta.env.VITE_VOICE_PROVIDER !== 'agora'
      ? true
      : import.meta.env.VITE_VOICE_FALLBACK === 'livekit'
  )) {
    return (await import('./livekit')).livekitTransport;
  }

  throw new Error(`voice: this build does not carry the ${id} adapter`);
}

export type { VoiceCredentials, VoiceProviderId, VoiceSession, VoiceTransport } from './types';
export { VOICE_PROVIDER_IDS, isVoiceProviderId } from './types';
