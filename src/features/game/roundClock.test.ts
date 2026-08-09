import { describe, it, expect } from 'vitest';
import { elapsedMs, remainingSeconds, deadlineAt, isPaused, type RoundClock } from './roundClock';

// The deadline is derived, never counted down, so that two phones agree to the
// second. A pause has to survive that derivation — on every client at once,
// including the one that ends the round when the explainer's device does not.

const T0 = Date.parse('2026-08-09T12:00:00.000Z');

const clock = (over: Partial<RoundClock> = {}): RoundClock => ({
  startedAt: new Date(T0).toISOString(),
  seconds: 60,
  pausedMs: 0,
  pausedAt: null,
  ...over,
});

describe('a round that runs without interruption', () => {
  it('counts down from the server start', () => {
    expect(remainingSeconds(clock(), T0)).toBe(60);
    expect(remainingSeconds(clock(), T0 + 10_000)).toBe(50);
  });

  it('floors at zero rather than going negative', () => {
    expect(remainingSeconds(clock(), T0 + 90_000)).toBe(0);
  });

  it('has not started until the server says it has', () => {
    expect(remainingSeconds(clock({ startedAt: null }), T0 + 99_000)).toBe(60);
    expect(elapsedMs(clock({ startedAt: null }), T0 + 99_000)).toBe(0);
  });
});

describe('a clock that is being held', () => {
  it('stops moving while the pause is in progress', () => {
    // 10s played, then held at T0+10s.
    const held = clock({ pausedAt: new Date(T0 + 10_000).toISOString() });
    expect(remainingSeconds(held, T0 + 10_000)).toBe(50);
    expect(remainingSeconds(held, T0 + 40_000)).toBe(50);
    expect(remainingSeconds(held, T0 + 600_000)).toBe(50);
  });

  it('says so', () => {
    expect(isPaused(clock())).toBe(false);
    expect(isPaused(clock({ pausedAt: new Date(T0).toISOString() }))).toBe(true);
  });

  // THE ONE THAT MATTERS MOST. The fallback that ends a round when the
  // explainer's device does not used to read started_at directly. Left that
  // way, it would end a held round on the original schedule — every screen
  // still showing time left, the round already over.
  it('pushes the deadline out for as long as it is held', () => {
    const held = clock({ pausedAt: new Date(T0 + 10_000).toISOString() });
    expect(deadlineAt(held, T0 + 10_000)).toBe(T0 + 60_000);
    expect(deadlineAt(held, T0 + 45_000)).toBe(T0 + 95_000);
  });
});

describe('a round that was held and released', () => {
  it('gives back exactly the time it lost', () => {
    const resumed = clock({ pausedMs: 30_000 });
    // 40s of wall clock, 30s of it paused — 10s actually played.
    expect(remainingSeconds(resumed, T0 + 40_000)).toBe(50);
    expect(deadlineAt(resumed, T0 + 40_000)).toBe(T0 + 90_000);
  });

  it('adds a fresh pause on top of the ones already folded in', () => {
    const again = clock({
      pausedMs: 20_000,
      pausedAt: new Date(T0 + 30_000).toISOString(),
    });
    // 30s wall, 20s of it already paused → 10s played, and it stays there.
    expect(remainingSeconds(again, T0 + 30_000)).toBe(50);
    expect(remainingSeconds(again, T0 + 120_000)).toBe(50);
  });

  it('still expires once the played seconds run out', () => {
    const resumed = clock({ pausedMs: 30_000 });
    expect(remainingSeconds(resumed, T0 + 90_000)).toBe(0);
  });
});

// Clocks disagree, and a phone that woke from sleep can report a moment before
// the pause began. Negative time is not a thing the timer may show.
describe('a clock that disagrees with the server', () => {
  it('never counts a pause backwards', () => {
    const held = clock({ pausedAt: new Date(T0 + 10_000).toISOString() });
    expect(remainingSeconds(held, T0 + 5_000)).toBe(55);
    expect(deadlineAt(held, T0 + 5_000)).toBe(T0 + 60_000);
  });

  it('never reports negative elapsed time', () => {
    expect(elapsedMs(clock(), T0 - 10_000)).toBe(0);
  });
});
