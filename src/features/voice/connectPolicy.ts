/**
 * When to try again, and when to stop.
 *
 * Written as pure functions because the alternative is discovering the policy
 * from a phone: the voice channel has already cost a week of "не работает"
 * with nothing to look at, and a retry loop that is only observable in
 * production is how that happens twice.
 */

import type { VoiceUnavailableReason } from './voiceApi';

/** A join that has not answered by now is not going to. */
export const JOIN_TIMEOUT_MS = 15_000;

/** Attempts after the first, before the app stops on its own. */
export const MAX_RETRIES = 3;

const BASE_DELAY_MS = 1_000;
const MAX_DELAY_MS = 8_000;

/**
 * Reasons worth another attempt.
 *
 * Everything else is a verdict, not a hiccup: a refusal by the server
 * (`not_in_room`, `no_team_yet`, `room_finished`), a build that cannot be
 * served (`provider_mismatch`), a deployment with no keys
 * (`voice_not_configured`), or a player who said no to the microphone. Retrying
 * those burns battery to be told the same thing.
 */
const TRANSIENT: readonly VoiceUnavailableReason[] = [
  'network',        // never reached the function, or the link to the service died
  'join_timeout',   // the service accepted the token and then said nothing
  'join_failed',    // the service refused the join itself
  'sdk_failed',     // the adapter's chunk did not load — usually a flaky network
  'lookup_failed',  // the server could not read the room; it may next time
  'issue_failed',   // the provider would not mint; often rate limiting
];

export function isTransient(reason: VoiceUnavailableReason | null): boolean {
  return reason !== null && TRANSIENT.includes(reason);
}

/**
 * Delay before attempt number `attempt` (1 = the first retry).
 *
 * Exponential with a ceiling, and jittered: two players whose room dropped at
 * the same instant would otherwise retry in lockstep forever, which is how a
 * service decides you are the problem.
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
  // ±25%, so the herd spreads without any delay collapsing to nothing.
  return Math.round(exponential * (0.75 + random() * 0.5));
}

export interface RetryDecision {
  retry: boolean;
  delayMs: number;
}

/** Whether to try again after a failure, and how long to wait. */
export function decideRetry(
  reason: VoiceUnavailableReason | null,
  attemptsSoFar: number,
  random: () => number = Math.random,
): RetryDecision {
  if (!isTransient(reason) || attemptsSoFar >= MAX_RETRIES) {
    return { retry: false, delayMs: 0 };
  }
  return { retry: true, delayMs: retryDelayMs(attemptsSoFar + 1, random) };
}

/**
 * Whether the app may connect on its own, without the player asking.
 *
 * Auto-connect exists because the microphone in a party game is not a feature
 * anybody wants to enable per room — but it must never fight the player. Three
 * rules, and they are the whole policy:
 *
 *   • a player who turned voice off stays off;
 *   • a player who refused the microphone is never asked again by a timer;
 *   • a session already up, or on its way up, is left alone.
 */
export function shouldAutoConnect(input: {
  enabled: boolean;
  status: 'off' | 'connecting' | 'on' | 'denied' | 'unavailable';
  reason: VoiceUnavailableReason | null;
  roomId: string | null;
  /** Team mode with no team picked: the server would refuse anyway. */
  needsTeam: boolean;
  /** The player switched voice off for this device. */
  optedOut: boolean;
}): boolean {
  if (!input.enabled || input.optedOut || !input.roomId || input.needsTeam) return false;
  if (input.status !== 'off') return false;
  // 'off' with a reason means a previous attempt ended; only retry the ones
  // worth retrying, and let the retry schedule — not this — decide when.
  return input.reason === null || isTransient(input.reason);
}
