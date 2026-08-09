// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// Holding the clock is the easy half. Where this refuses to act is the half
// that decides whether the game is playable: a pause nobody lifts is a worse
// bug than a round lost to a bad connection.

const rpc = vi.fn();
vi.mock('@/shared/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

let initData: string | null = 'signed-init-data';
vi.mock('@/shared/lib/telegram', () => ({
  getRawInitData: () => initData,
}));

const { usePauseOnVoiceDrop } = await import('./usePauseOnVoiceDrop');

type Input = Parameters<typeof usePauseOnVoiceDrop>[0];

const base: Input = {
  roundId: 'round-1',
  roundActive: true,
  isExplainer: true,
  voiceInUse: true,
  status: 'on',
};

const calls = () => rpc.mock.calls.map((c) => c[0] as string);

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
  initData = 'signed-init-data';
});

describe('holding the clock', () => {
  it('pauses when the explainer loses the link', () => {
    const { rerender } = renderHook((p: Input) => usePauseOnVoiceDrop(p), { initialProps: base });
    expect(calls()).toEqual([]);

    rerender({ ...base, status: 'unavailable' });
    expect(calls()).toEqual(['pause_round']);
    expect(rpc.mock.calls[0][1]).toEqual({
      p_round_id: 'round-1',
      p_init_data: 'signed-init-data',
    });
  });

  it('lifts the pause when the link comes back', () => {
    const { rerender } = renderHook((p: Input) => usePauseOnVoiceDrop(p), { initialProps: base });
    rerender({ ...base, status: 'unavailable' });
    rerender({ ...base, status: 'on' });
    expect(calls()).toEqual(['pause_round', 'resume_round']);
  });

  // The RPCs are idempotent, but a request per render is still a request per
  // render, and the render count here is not ours to predict.
  it('does not repeat itself on a re-render', () => {
    const { rerender } = renderHook((p: Input) => usePauseOnVoiceDrop(p), { initialProps: base });
    rerender({ ...base, status: 'unavailable' });
    rerender({ ...base, status: 'unavailable' });
    rerender({ ...base, status: 'unavailable' });
    expect(calls()).toEqual(['pause_round']);
  });

  // A pause that failed to send must be retried, or the round stays held on a
  // request that never landed — the one failure here that stops the game.
  // Nothing about the props changes when a request fails, so the effect will
  // never re-run: the retry has to come from the hook itself. A resume that
  // silently failed leaves the round held forever.
  it('sends it again on its own after a request that did not land', async () => {
    vi.useFakeTimers();
    rpc.mockResolvedValueOnce({ error: new Error('offline') });
    const { rerender } = renderHook((p: Input) => usePauseOnVoiceDrop(p), { initialProps: base });
    rerender({ ...base, status: 'unavailable' });

    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toEqual(['pause_round']);

    await vi.advanceTimersByTimeAsync(2500);
    expect(calls()).toEqual(['pause_round', 'pause_round']);
    vi.useRealTimers();
  });
});

describe('where it refuses to act', () => {
  it('leaves a game played without voice alone', () => {
    const { rerender } = renderHook((p: Input) => usePauseOnVoiceDrop(p), {
      initialProps: { ...base, voiceInUse: false },
    });
    rerender({ ...base, voiceInUse: false, status: 'unavailable' });
    expect(calls()).toEqual([]);
  });

  // Only the explainer's link stops the round. Letting any of four phones
  // freeze the clock hands the pace of the game to the flakiest one.
  it('ignores a guesser losing their link', () => {
    const { rerender } = renderHook((p: Input) => usePauseOnVoiceDrop(p), {
      initialProps: { ...base, isExplainer: false },
    });
    rerender({ ...base, isExplainer: false, status: 'unavailable' });
    expect(calls()).toEqual([]);
  });

  // A refused microphone is an answer, not a lost link. Pausing for it would
  // hold the round open forever waiting for something nobody is going to do.
  it('does not hold the clock for a microphone the player refused', () => {
    const { rerender } = renderHook((p: Input) => usePauseOnVoiceDrop(p), { initialProps: base });
    rerender({ ...base, status: 'denied' });
    expect(calls()).toEqual([]);
  });

  // Voice joins as the round starts and takes a moment. Pausing for that would
  // mean every round began on hold.
  it('does not pause for an ordinary first connect', () => {
    const { rerender } = renderHook((p: Input) => usePauseOnVoiceDrop(p), {
      initialProps: { ...base, status: 'off' } as Input,
    });
    rerender({ ...base, status: 'connecting' });
    expect(calls()).toEqual([]);
  });

  it('stays out of a round that is not running', () => {
    const { rerender } = renderHook((p: Input) => usePauseOnVoiceDrop(p), {
      initialProps: { ...base, roundActive: false },
    });
    rerender({ ...base, roundActive: false, status: 'unavailable' });
    expect(calls()).toEqual([]);
  });

  it('says nothing when Telegram gave it nothing to prove who it is', () => {
    initData = null;
    const { rerender } = renderHook((p: Input) => usePauseOnVoiceDrop(p), { initialProps: base });
    rerender({ ...base, status: 'unavailable' });
    expect(calls()).toEqual([]);
  });

  // 'off' is both "not connected yet" and "was connected and dropped". At the
  // start of a round it is always the first, and pausing for it would mean
  // every round began on hold.
  it('does not mistake a link that never came up for one that was lost', () => {
    const { rerender } = renderHook((p: Input) => usePauseOnVoiceDrop(p), {
      initialProps: { ...base, status: 'off' } as Input,
    });
    rerender({ ...base, status: 'off' });
    rerender({ ...base, status: 'unavailable' });
    expect(calls()).toEqual([]);
  });

  it('forgets the previous round, including that its link was ever up', () => {
    const { rerender } = renderHook((p: Input) => usePauseOnVoiceDrop(p), { initialProps: base });
    rerender({ ...base, status: 'unavailable' });
    expect(calls()).toEqual(['pause_round']);

    // A new round starts from nothing: its own link has not been up yet.
    rerender({ ...base, roundId: 'round-2', status: 'unavailable' });
    expect(calls()).toEqual(['pause_round']);
  });
});
