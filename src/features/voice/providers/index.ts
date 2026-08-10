// Which service this build talks to, and how its SDK gets loaded.
//
// WHY THE SWITCH IS WRITTEN LIKE THIS. `VITE_VOICE_PROVIDER` is substituted by
// Vite as a literal at build time, so the switch below folds to one branch and
// the other adapters — with their SDKs, several hundred KB each — are dropped
// from the build entirely. A deployment on Daily never downloads LiveKit, and
// a deployment with no provider configured downloads none of them.
//
// The same mechanism has a sharp edge worth knowing about: building without
// the variables set removes the whole voice path, so `dist/` legitimately
// contains no SDK chunk at all. That is correct, and it is also how a broken
// build looks. `npm run check:voice` reports which variables this build was
// compiled with; see docs/VOICE_PROVIDERS.md.

// FAILOVER CHANGES THE TRADE, WHICH IS WHY IT IS A SWITCH. `VITE_VOICE_FALLBACK`
// compiles all three adapters in so a dead service can be walked past at
// runtime. `dist/` then carries three SDK chunks instead of one — but they are
// still dynamic imports, so a session downloads only the ones it actually
// tries, and the second is fetched only after the first has failed. Left unset,
// every line below folds exactly as it did before and the bundle is unchanged.

import {
  isVoiceProviderId,
  OFFERED_VOICE_PROVIDER_IDS,
  type VoiceProviderId,
  type VoiceTransport,
} from './types';

const CONFIGURED = import.meta.env.VITE_VOICE_PROVIDER as string | undefined;

/**
 * The provider this build uses.
 *
 * Defaults to LiveKit because that is what production runs today: an existing
 * deployment that sets only `VITE_LIVEKIT_URL` keeps working untouched.
 */
export function voiceProvider(): VoiceProviderId {
  return isVoiceProviderId(CONFIGURED) ? CONFIGURED : 'livekit';
}

/** True when `VITE_VOICE_PROVIDER` is set to something nobody implements. */
export function voiceProviderMisconfigured(): boolean {
  return typeof CONFIGURED === 'string' && CONFIGURED.length > 0 && !isVoiceProviderId(CONFIGURED);
}

/**
 * Whether this build may walk past a dead service to the next one.
 *
 * Written against the raw literal for the same reason as everything below: it
 * gates the imports that decide the bundle.
 */
export function voiceFallbackEnabled(): boolean {
  return import.meta.env.VITE_VOICE_FALLBACK === 'true';
}

/**
 * The services whose adapters are actually in this build.
 *
 * Without fallback that is exactly one, and the failover ladder becomes a
 * single rung — the behaviour that shipped before any of this existed.
 */
export function availableProviders(): VoiceProviderId[] {
  if (!voiceFallbackEnabled()) return [voiceProvider()];
  // OFFERED, not every id we can parse: Daily is withdrawn, and a ladder rung
  // that is known to fail spends a real attempt and shows the player a fault
  // they cannot act on. See OFFERED_VOICE_PROVIDER_IDS.
  return [...OFFERED_VOICE_PROVIDER_IDS];
}

/**
 * Loads one named adapter.
 *
 * Every condition compares the RAW literals, and the `||` is what makes
 * failover possible without making it compulsory: with `VITE_VOICE_FALLBACK`
 * unset each disjunction folds to the single configured provider and the other
 * two `import()`s are dropped, SDKs and all. Routing this through
 * `voiceProvider()` or a lookup table defeats the folding and ships all three
 * to every deployment — see the note above `loadTransport`.
 */
export async function loadTransportFor(id: VoiceProviderId): Promise<VoiceTransport> {
  if (
    id === 'daily' &&
    (import.meta.env.VITE_VOICE_PROVIDER === 'daily' || import.meta.env.VITE_VOICE_FALLBACK === 'true')
  ) {
    return (await import('./daily')).dailyTransport;
  }
  if (
    id === 'agora' &&
    (import.meta.env.VITE_VOICE_PROVIDER === 'agora' || import.meta.env.VITE_VOICE_FALLBACK === 'true')
  ) {
    return (await import('./agora')).agoraTransport;
  }
  if (
    id === 'livekit' &&
    (import.meta.env.VITE_VOICE_PROVIDER !== 'daily' && import.meta.env.VITE_VOICE_PROVIDER !== 'agora'
      ? true
      : import.meta.env.VITE_VOICE_FALLBACK === 'true')
  ) {
    return (await import('./livekit')).livekitTransport;
  }
  // Asked for a service this build cannot load. The ladder above should have
  // filtered it out with availableProviders(), so this is a programming error
  // rather than a runtime state — and it must not resolve to the wrong vendor.
  throw new Error(`voice: ${id} is not compiled into this build`);
}

export async function loadTransport(): Promise<VoiceTransport> {
  // Unreachable at runtime — connect() checks voiceEnabled() first — and that
  // is not what this is for. Written against the raw literals, it folds to a
  // bare `throw` in a build with no voice configured, which makes every
  // import() below unreachable and takes all three SDKs out of `dist/`. A
  // deployment without voice does not pay for voice; that property predates
  // the providers and is worth the odd-looking guard.
  if (!import.meta.env.VITE_LIVEKIT_URL && import.meta.env.VITE_VOICE_ENABLED !== 'true') {
    throw new Error('voice is not configured in this build');
  }

  // Compared against the RAW literal, one `if` per provider. Both halves of
  // that are load-bearing, and both were arrived at by measuring `dist/`:
  //
  //   * Vite substitutes `import.meta.env.VITE_VOICE_PROVIDER` before Rollup
  //     runs, so each condition becomes `if (false)` and the branch — with its
  //     `import()`, and therefore its SDK chunk — is dropped. Routing this
  //     through voiceProvider() defeats it: the call is not foldable, every
  //     branch survives, and every deployment ships all three SDKs.
  //   * `if`, not `switch`: Rollup eliminates dead if-branches and does NOT
  //     eliminate dead switch-cases. The switch version built all three.
  if (import.meta.env.VITE_VOICE_PROVIDER === 'daily') {
    return (await import('./daily')).dailyTransport;
  }
  if (import.meta.env.VITE_VOICE_PROVIDER === 'agora') {
    return (await import('./agora')).agoraTransport;
  }
  return (await import('./livekit')).livekitTransport;
}

export type { VoiceCredentials, VoiceProviderId, VoiceSession, VoiceTransport } from './types';
export { VOICE_PROVIDER_IDS, OFFERED_VOICE_PROVIDER_IDS, isVoiceProviderId } from './types';
