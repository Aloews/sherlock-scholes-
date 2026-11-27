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


describe('getSquad', () => {
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

  it('loads the owner-scoped campaign squad with the authenticated request helper', async () => {
    const squad = { team_id: 'team-1', team_name: 'Northbridge United', formation: '4-3-3', next_fixture_id: null, starter_ids: [], substitute_ids: [], players: [] };
    fetchMock.mockResolvedValue({ ok: true, json: async () => squad });
    const { getSquad } = await import('./api');
    await expect(getSquad('campaign-1')).resolves.toEqual(squad);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://test.local/api/v1/campaigns/campaign-1/squad',
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it('rejects a malformed squad payload instead of treating it as an empty squad', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ team_id: 'team-1', players: {} }) });
    const { getSquad } = await import('./api');
    await expect(getSquad('campaign-1')).rejects.toThrow('invalid_squad_response');
  });

  it('rejects a squad payload without persisted lineup fields', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ team_id: 'team-1', team_name: 'Northbridge United', formation: '4-3-3', players: [] }) });
    const { getSquad } = await import('./api');
    await expect(getSquad('campaign-1')).rejects.toThrow('invalid_squad_response');
  });
});


describe('saveLineup', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => { vi.resetModules(); fetchMock = vi.fn(); vi.stubGlobal('window', { location: { origin: 'https://test.local' } }); vi.stubGlobal('fetch', fetchMock); });
  afterEach(() => { vi.unstubAllGlobals(); });
  it('sends an authenticated lineup mutation to the fixture endpoint', async () => {
    const result = { fixture_id: 'fixture-1', team_id: 'team-1', formation: '4-3-3', starters_saved: 11, substitutes_saved: 7 };
    fetchMock.mockResolvedValue({ ok: true, json: async () => result });
    const { saveLineup } = await import('./api');
    const payload = { formation: '4-3-3', starter_ids: Array.from({ length: 11 }, (_, i) => `starter-${i}`), substitute_ids: Array.from({ length: 7 }, (_, i) => `sub-${i}`) };
    await expect(saveLineup('campaign-1', 'fixture-1', payload)).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith('https://test.local/api/v1/campaigns/campaign-1/fixtures/fixture-1/lineup', expect.objectContaining({ method: 'POST', body: JSON.stringify(payload), headers: expect.any(Headers) }));
  });
});
