import { describe, it, expect } from 'vitest';
import {
  decideRetry, isTransient, retryDelayMs, shouldAutoConnect,
  JOIN_TIMEOUT_MS, MAX_RETRIES,
} from './connectPolicy';
import type { VoiceUnavailableReason } from './voiceApi';

// The rules that decide whether the app tries again and whether it may connect
// unasked. Pure on purpose: the alternative is learning the policy from a
// phone, which is exactly how the voice channel ate a week.

describe('isTransient', () => {
  it.each<VoiceUnavailableReason>([
    'network', 'join_timeout', 'join_failed', 'sdk_failed', 'lookup_failed', 'issue_failed',
  ])('retries %s — it may work in a second', (reason) => {
    expect(isTransient(reason)).toBe(true);
  });

  // These are answers, not hiccups. Asking again gets the same answer and
  // spends the player's battery to hear it.
  it.each<VoiceUnavailableReason>([
    'not_in_room', 'no_team_yet', 'room_finished', 'unauthorized',
    'provider_mismatch', 'voice_not_configured', 'not_configured',
    'no_init_data', 'bad_request', 'no_such_room', 'malformed',
  ])('does not retry %s — it is a verdict', (reason) => {
    expect(isTransient(reason)).toBe(false);
  });

  it('treats "no reason at all" as nothing to retry', () => {
    expect(isTransient(null)).toBe(false);
  });
});

describe('retryDelayMs', () => {
  const mid = () => 0.5; // no jitter, so the shape is visible

  it('backs off exponentially', () => {
    expect(retryDelayMs(1, mid)).toBe(1000);
    expect(retryDelayMs(2, mid)).toBe(2000);
    expect(retryDelayMs(3, mid)).toBe(4000);
  });

  it('stops growing at the ceiling', () => {
    expect(retryDelayMs(9, mid)).toBe(8000);
    expect(retryDelayMs(50, mid)).toBe(8000);
  });

  // Two players whose room dropped together must not retry in lockstep; a
  // service reads that as an attack rather than an accident.
  it('jitters by ±25% and never collapses to zero', () => {
    expect(retryDelayMs(1, () => 0)).toBe(750);
    expect(retryDelayMs(1, () => 0.999)).toBeGreaterThan(1240);
    expect(retryDelayMs(1, () => 0)).toBeGreaterThan(0);
  });
});

describe('decideRetry', () => {
  const mid = () => 0.5;

  it('retries a transient failure and waits longer each time', () => {
    expect(decideRetry('network', 0, mid)).toEqual({ retry: true, delayMs: 1000 });
    expect(decideRetry('network', 1, mid)).toEqual({ retry: true, delayMs: 2000 });
    expect(decideRetry('network', 2, mid)).toEqual({ retry: true, delayMs: 4000 });
  });

  it('gives up after the budget rather than forever', () => {
    expect(decideRetry('network', MAX_RETRIES, mid).retry).toBe(false);
    expect(decideRetry('network', MAX_RETRIES + 5, mid).retry).toBe(false);
  });

  it('never retries a refusal, however early', () => {
    expect(decideRetry('no_team_yet', 0, mid).retry).toBe(false);
    expect(decideRetry('provider_mismatch', 0, mid).retry).toBe(false);
  });
});

describe('shouldAutoConnect', () => {
  const base = {
    enabled: true,
    status: 'off' as const,
    reason: null,
    roomId: 'room-1',
    needsTeam: false,
    optedOut: false,
  };

  it('connects on its own in a room where it can', () => {
    expect(shouldAutoConnect(base)).toBe(true);
  });

  it('stays out of the way when the player switched voice off', () => {
    expect(shouldAutoConnect({ ...base, optedOut: true })).toBe(false);
  });

  it('does nothing when voice is not configured in this build', () => {
    expect(shouldAutoConnect({ ...base, enabled: false })).toBe(false);
  });

  it('waits for a room', () => {
    expect(shouldAutoConnect({ ...base, roomId: null })).toBe(false);
  });

  // The server would refuse with no_team_yet; asking is pure noise.
  it('waits for a team in team mode', () => {
    expect(shouldAutoConnect({ ...base, needsTeam: true })).toBe(false);
  });

  it.each(['connecting', 'on'] as const)('leaves a session alone when it is %s', (status) => {
    expect(shouldAutoConnect({ ...base, status })).toBe(false);
  });

  // The one that matters most: a refused microphone must never be asked for
  // again by a timer. Only a tap may do that.
  it('never re-prompts a player who refused the microphone', () => {
    expect(shouldAutoConnect({ ...base, status: 'denied' })).toBe(false);
    expect(shouldAutoConnect({ ...base, status: 'off', reason: 'no_init_data' })).toBe(false);
  });

  it('is willing to try again after a transient failure', () => {
    expect(shouldAutoConnect({ ...base, reason: 'join_timeout' })).toBe(true);
  });

  it('does not try again after a verdict', () => {
    expect(shouldAutoConnect({ ...base, reason: 'not_in_room' })).toBe(false);
  });
});

describe('the join deadline', () => {
  // A join with no deadline is how "Подключаемся…" becomes permanent.
  it('is long enough for a slow phone and short enough to notice', () => {
    expect(JOIN_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    expect(JOIN_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
  });
});
