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

import { isVoiceProviderId, type VoiceProviderId, type VoiceTransport } from './types';

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
export { VOICE_PROVIDER_IDS, isVoiceProviderId } from './types';
