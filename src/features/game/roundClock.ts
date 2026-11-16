/**
 * Where the round's deadline actually is, once pauses are counted.
 *
 * Pure, and shared by both halves that care: the countdown on screen and the
 * fallback that ends the round when the explainer's device does not. Those two
 * used to compute the deadline separately from `started_at`, which was fine
 * while there was one formula. With a pause there are two places to forget it,
 * and forgetting it in the fallback is the worse one — the round would end
 * while every screen still showed time left.
 */

export const MAX_ROUND_PAUSE_MS = 120_000;

export interface RoundClock {
  /** When the round's clock started, from the server. */
  startedAt: string | null;
  /** Round length in seconds. */
  seconds: number;
  /** Milliseconds already spent paused and folded in. */
  pausedMs: number;
  /** When the current pause began, or null when running. */
  pausedAt: string | null;
}

/**
 * Active pause time is capped by the same two-minute allowance as pause_round.
 * If the explainer never reconnects, the clock resumes when that allowance is
 * exhausted; a stale paused_at value must not freeze a room indefinitely.
 */
function activePauseMs(clock: RoundClock, now: number): number {
  if (!clock.pausedAt) return 0;
  const allowance = Math.max(0, MAX_ROUND_PAUSE_MS - clock.pausedMs);
  const spent = Math.max(0, now - new Date(clock.pausedAt).getTime());
  return Math.min(allowance, spent);
}

/** Milliseconds of the round that have actually been played by `now`. */
export function elapsedMs(clock: RoundClock, now: number): number {
  if (!clock.startedAt) return 0;
  const since = now - new Date(clock.startedAt).getTime();
  return Math.max(0, since - clock.pausedMs - activePauseMs(clock, now));
}

/** Whole seconds left, floored at zero. */
export function remainingSeconds(clock: RoundClock, now: number): number {
  if (!clock.startedAt) return clock.seconds;
  return Math.max(0, clock.seconds - Math.floor(elapsedMs(clock, now) / 1000));
}

/**
 * The wall-clock moment this round runs out, including only the unused part
 * of the two-minute pause allowance.
 */
export function deadlineAt(clock: RoundClock, now: number): number {
  if (!clock.startedAt) return now + clock.seconds * 1000;
  return new Date(clock.startedAt).getTime()
    + clock.seconds * 1000
    + clock.pausedMs
    + activePauseMs(clock, now);
}

/** Whether the clock is being held right now. */
export function isPaused(clock: RoundClock, now: number = Date.now()): boolean {
  const allowance = Math.max(0, MAX_ROUND_PAUSE_MS - clock.pausedMs);
  return clock.pausedAt !== null && allowance > 0 && activePauseMs(clock, now) < allowance;
}
