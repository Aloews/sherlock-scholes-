// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTimer } from './useTimer';
import type { Round } from '@/shared/types/database';

// The timer derives remaining time from the server started_at so every client
// agrees — no local countdown state to drift. We freeze time and drive fake
// timers to assert the derivations and the single onExpire.

const round = (over: Partial<Round> = {}): Round =>
  ({
    id: 'r1',
    status: 'active',
    started_at: new Date('2026-01-01T00:00:00Z').toISOString(),
    time_seconds: 60,
    ...over,
  }) as unknown as Round;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useTimer', () => {
  it('starts at full time and counts down with elapsed wall-clock', () => {
    const { result } = renderHook(() => useTimer(round()));
    expect(result.current.remaining).toBe(60);
    act(() => {
      vi.advanceTimersByTime(10_000); // 10s elapsed
    });
    expect(result.current.remaining).toBe(50);
    expect(result.current.pct).toBeCloseTo(50 / 60, 5);
  });

  it('flags warning (≤10s) and danger (≤5s) windows', () => {
    const { result } = renderHook(() => useTimer(round()));
    act(() => vi.advanceTimersByTime(52_000)); // 8s left
    expect(result.current.isWarning).toBe(true);
    expect(result.current.isDanger).toBe(false);
    act(() => vi.advanceTimersByTime(4_000)); // 4s left
    expect(result.current.isDanger).toBe(true);
  });

  it('clamps at zero, sets isExpired, and calls onExpire exactly once', () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() => useTimer(round(), { onExpire }));
    act(() => vi.advanceTimersByTime(65_000)); // past the end
    expect(result.current.remaining).toBe(0);
    expect(result.current.isExpired).toBe(true);
    expect(result.current.isWarning).toBe(false); // not warning once expired
    act(() => vi.advanceTimersByTime(5_000)); // keep ticking past zero
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('does not run for a non-active round (shows full time)', () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() => useTimer(round({ status: 'pending' }), { onExpire }));
    act(() => vi.advanceTimersByTime(120_000));
    expect(result.current.remaining).toBe(60);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('is zero-safe for a null round', () => {
    const { result } = renderHook(() => useTimer(null));
    expect(result.current.remaining).toBe(0);
    expect(result.current.pct).toBe(0);
    expect(result.current.isExpired).toBe(true);
  });

  it('clears its interval on unmount (no leak)', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = renderHook(() => useTimer(round()));
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });
});
