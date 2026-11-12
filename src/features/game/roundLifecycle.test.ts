import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  endAliasRound,
  setAliasRoundVoiceState,
} from './roundLifecycle';

describe('Alias round lifecycle API', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('requires Telegram initData and does not make an unauthenticated request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(endAliasRound('round-1', null)).rejects.toThrow('TELEGRAM_AUTH_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ends a round through the Rust API and validates its result', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ outcome: 'next_round', next_round_id: 'round-2' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(endAliasRound('round-1', 'signed-data')).resolves.toEqual({
      outcome: 'next_round',
      next_round_id: 'round-2',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/alias/rounds/round-1/end', {
      method: 'POST',
      headers: { 'x-tg-init-data': 'signed-data' },
    });
  });

  it('uses the Rust pause/resume endpoints and validates persisted pause state', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ paused_at: '2026-11-12T12:00:00Z', paused_ms: 0 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ paused_at: null, paused_ms: 120000 }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(setAliasRoundVoiceState('round-1', 'pause', 'signed-data'))
      .resolves.toEqual({ paused_at: '2026-11-12T12:00:00Z', paused_ms: 0 });
    await expect(setAliasRoundVoiceState('round-1', 'resume', 'signed-data'))
      .resolves.toEqual({ paused_at: null, paused_ms: 120000 });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/v1/alias/rounds/round-1/pause',
      '/api/v1/alias/rounds/round-1/resume',
    ]);
  });

  it('surfaces backend errors and rejects malformed response data', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'room_membership_required' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ outcome: 'next_round', next_round_id: null }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(endAliasRound('round-1', 'signed-data')).rejects.toThrow('room_membership_required');
    await expect(endAliasRound('round-1', 'signed-data')).rejects.toThrow('INVALID_ALIAS_ROUND_END_RESPONSE');
  });
});
