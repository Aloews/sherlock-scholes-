import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activateAliasRound,
  decideAliasCard,
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

  it('activates a round through the Rust API and validates the dealt card count', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ outcome: 'activated', card_count: 5 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(activateAliasRound('round-1', 'signed-data'))
      .resolves.toEqual({ outcome: 'activated', card_count: 5 });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/alias/rounds/round-1/activate', {
      method: 'POST',
      headers: { 'x-tg-init-data': 'signed-data', 'content-type': 'application/json' },
      body: '{}',
    });
  });

  it('rejects an invalid activation response and never deals from the client on API failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ outcome: 'activated', card_count: 101 }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'no_cards_for_room_deck' }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(activateAliasRound('round-1', 'signed-data'))
      .rejects.toThrow('INVALID_ALIAS_ROUND_ACTIVATION_RESPONSE');
    await expect(activateAliasRound('round-1', 'signed-data'))
      .rejects.toThrow('no_cards_for_room_deck');
  });


  it('records a card decision through Rust and validates idempotent results', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ outcome: 'decided', status: 'correct' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(decideAliasCard('round-card-1', 'correct', 'signed-data'))
      .resolves.toEqual({ outcome: 'decided', status: 'correct' });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/alias/cards/round-card-1/decision', {
      method: 'POST',
      headers: {
        'x-tg-init-data': 'signed-data',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ status: 'correct' }),
    });
  });

  it('rejects unauthenticated, invalid and conflicting card decisions', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'alias_explainer_required' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ outcome: 'decided', status: 'skipped' }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(decideAliasCard('round-card-1', 'correct', null))
      .rejects.toThrow('TELEGRAM_AUTH_REQUIRED');
    await expect(decideAliasCard('round-card-1', 'correct', 'signed-data'))
      .rejects.toThrow('alias_explainer_required');
    await expect(decideAliasCard('round-card-1', 'correct', 'signed-data'))
      .rejects.toThrow('INVALID_ALIAS_CARD_DECISION_RESPONSE');
  });

});
