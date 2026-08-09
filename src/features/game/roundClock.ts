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
 * Milliseconds of the round that have actually been played by `now`.
 *
 * A pause in progress is subtracted as it happens, so the number simply stops
 * moving — which is what "the timer is on hold" has to mean for every client
 * at once, not just the one that noticed the drop.
 */
export function elapsedMs(clock: RoundClock, now: number): number {
  if (!clock.startedAt) return 0;
  const since = now - new Date(clock.startedAt).getTime();
  const held = clock.pausedAt ? now - new Date(clock.pausedAt).getTime() : 0;
  return Math.max(0, since - clock.pausedMs - Math.max(0, held));
}

/** Whole seconds left, floored at zero. */
export function remainingSeconds(clock: RoundClock, now: number): number {
  if (!clock.startedAt) return clock.seconds;
  return Math.max(0, clock.seconds - Math.floor(elapsedMs(clock, now) / 1000));
}

/**
 * The wall-clock moment this round runs out, given the pauses so far.
 *
 * For a round on hold this keeps moving into the future with every call —
 * correctly: nobody can say when a paused round ends, and a fallback timer
 * scheduled against it simply keeps being rescheduled until the clock runs
 * again.
 */
export function deadlineAt(clock: RoundClock, now: number): number {
  if (!clock.startedAt) return now + clock.seconds * 1000;
  return new Date(clock.startedAt).getTime()
    + clock.seconds * 1000
    + clock.pausedMs
    + (clock.pausedAt ? Math.max(0, now - new Date(clock.pausedAt).getTime()) : 0);
}

/** Whether the clock is being held right now. */
export function isPaused(clock: RoundClock): boolean {
  return clock.pausedAt !== null;
}
