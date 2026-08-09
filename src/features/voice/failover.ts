/**
 * Which service to try next, and when trying another one is pointless.
 *
 * THE DISTINCTION THIS FILE EXISTS FOR. "Try again" and "try someone else" are
 * different questions with different answers, and connectPolicy.ts only answers
 * the first. A join the vendor refused is worth taking to another vendor; a
 * room the player is not in will be refused by all three, and walking the
 * ladder to be told so twice more costs three microphone prompts and several
 * seconds before the same message appears.
 *
 * So: `isProviderFault` is about WHOSE fault it is, not about how likely it is
 * to clear. A reason can be one, the other, both or neither.
 */

import type { VoiceProviderId } from './providers';
import { VOICE_PROVIDER_IDS } from './providers';
import type { VoiceUnavailableReason } from './voiceApi';

/**
 * Failures that belong to one service, so another one might not have them.
 *
 * Everything absent from this list is about the room, the player or our own
 * server — the parts every service shares. `network` is the one worth pausing
 * on: it means our Edge Function could not be reached at all, and that same
 * function mints for all three, so the next service is behind the same
 * unreachable door.
 */
const PROVIDER_FAULTS: readonly VoiceUnavailableReason[] = [
  'sdk_failed',           // that vendor's chunk would not load
  'join_failed',          // that vendor refused the join
  'join_timeout',         // that vendor took the token and went quiet
  'issue_failed',         // our server could not get a credential OUT of that vendor
  'voice_not_configured', // our server holds no secrets for that vendor
  'provider_mismatch',    // that vendor is not one this deployment will serve
  'malformed',            // that vendor's credential came back unusable
  'bad_request',          // the server would not accept a request naming it
];

/** Whether another service could plausibly succeed where this one failed. */
export function isProviderFault(reason: VoiceUnavailableReason | null): boolean {
  return reason !== null && PROVIDER_FAULTS.includes(reason);
}

/**
 * The services to try, best first.
 *
 * `preferred` leads because it is what the deployment chose and what the server
 * defaults to; the rest follow in their canonical order so the sequence is the
 * same on every device and a support answer means something. Anything not
 * compiled into this build is dropped rather than attempted — its SDK is not
 * there to import.
 */
export function providerOrder(
  preferred: VoiceProviderId,
  available: readonly VoiceProviderId[],
): VoiceProviderId[] {
  const usable = VOICE_PROVIDER_IDS.filter((id) => available.includes(id));
  return usable.includes(preferred)
    ? [preferred, ...usable.filter((id) => id !== preferred)]
    : [...usable];
}

/**
 * The next service after one that just failed, or null to stop.
 *
 * Null covers both endings and they are not the same ending: a failure nobody
 * else can fix, and a ladder that has run out of rungs. The caller keeps the
 * failing reason either way, so the player is told what went wrong rather than
 * that everything did.
 */
export function nextProvider(
  order: readonly VoiceProviderId[],
  failed: VoiceProviderId,
  reason: VoiceUnavailableReason | null,
): VoiceProviderId | null {
  if (!isProviderFault(reason)) return null;
  const at = order.indexOf(failed);
  if (at < 0) return null;
  return order[at + 1] ?? null;
}
