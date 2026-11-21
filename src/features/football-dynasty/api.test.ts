import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/shared/lib/telegram', () => ({
  getRawInitData: () => 'signed-test-init-data',
}));

describe('listGameEvents', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn();
    vi.stubGlobal('window', { location: { origin: 'https://test.local' } });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the event list when the API responds with an array', async () => {
    const events = [{ id: 'event-1', status: 'pending' }];
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => events,
    });

    const { listGameEvents } = await import('./api');

    await expect(listGameEvents('campaign-1')).resolves.toEqual(events);
  });

  it('rejects a non-array payload instead of silently treating it as an empty inbox', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ events: [] }),
    });

    const { listGameEvents } = await import('./api');

    await expect(listGameEvents('campaign-1')).rejects.toThrow('invalid_events_response');
  });
});

describe('listWorldEvents', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    fetchMock = vi.fn();
    vi.stubGlobal('window', { location: { origin: 'https://test.local' } });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns persisted campaign world events', async () => {
    const events = [{ id: 'world-1', event_type: 'theft_near_club', state: 'known' }];
    fetchMock.mockResolvedValue({ ok: true, json: async () => events });
    const { listWorldEvents } = await import('./api');
    await expect(listWorldEvents('campaign-1')).resolves.toEqual(events);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://test.local/api/v1/campaigns/campaign-1/world/events',
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it('rejects malformed world-event payloads', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ events: [] }) });
    const { listWorldEvents } = await import('./api');
    await expect(listWorldEvents('campaign-1')).rejects.toThrow('invalid_world_events_response');
  });
});
