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


describe('resolveLineupSelection', () => {
  const positions = [
    ...Array.from({ length: 1 }, () => 'goalkeeper' as const),
    ...Array.from({ length: 4 }, () => 'defender' as const),
    ...Array.from({ length: 3 }, () => 'midfielder' as const),
    ...Array.from({ length: 3 }, () => 'forward' as const),
  ];
  const players = [
    ...positions,
    ...Array.from({ length: 7 }, (_, index) => index % 2 === 0 ? 'defender' as const : 'midfielder' as const),
  ].map((position, index) => ({
    id: `player-${index + 1}`, full_name: `Player ${index + 1}`, position,
    shirt_number: index + 1, age: 24, pace: 70, shooting: 70, passing: 70,
    defending: 70, physical: 70, goalkeeping: 10, stamina: 70, morale: 70,
    fatigue: 0, potential: 80, market_value_minor: 100000, wage_minor: 1000,
    contract_until: null, injured_until: null, suspended_until: null,
    training_focus: null, training_intensity: null,
  }));
  const squad = {
    team_id: 'team-1', team_name: 'Northbridge United', formation: '4-3-3', next_fixture_id: 'fixture-1',
    starter_ids: players.slice(0, 11).map((player) => player.id),
    substitute_ids: players.slice(11).map((player) => player.id), players,
  };

  it('restores a persisted lineup exactly while every selected player remains eligible', async () => {
    const { resolveLineupSelection } = await import('./api');
    expect(resolveLineupSelection(squad, '2026-01-01')).toEqual({
      formation: '4-3-3', starterIds: squad.starter_ids, substituteIds: squad.substitute_ids,
    });
  });

  it('rebuilds a valid XI and bench when a saved starter becomes injured', async () => {
    const { resolveLineupSelection } = await import('./api');
    const injuredSquad = {
      ...squad,
      players: squad.players.map((player, index) => index === 1 ? { ...player, injured_until: '2026-01-05' } : player),
    };
    const selection = resolveLineupSelection(injuredSquad, '2026-01-05');
    expect(selection.starterIds).toHaveLength(11);
    expect(selection.substituteIds).toHaveLength(6);
    expect(new Set([...selection.starterIds, ...selection.substituteIds]).size).toBe(17);
    expect(selection.starterIds).not.toContain('player-2');
  });

  it('rejects duplicate or malformed saved IDs and falls back to eligible players', async () => {
    const { resolveLineupSelection } = await import('./api');
    const malformed = { ...squad, starter_ids: [...squad.starter_ids.slice(0, 10), squad.starter_ids[0]] };
    const selection = resolveLineupSelection(malformed, '2026-01-01');
    expect(selection.starterIds).toHaveLength(11);
    expect(new Set(selection.starterIds).size).toBe(11);
    expect(selection.substituteIds).toHaveLength(7);
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


describe('setPlayerTraining', () => {
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

  it('sends an authenticated idempotent training command for selected players', async () => {
    const result = { campaign_id: 'campaign-1', team_id: 'team-1', assigned_players: 1, focus: 'balanced', intensity: 80 };
    fetchMock.mockResolvedValue({ ok: true, json: async () => result });
    const { setPlayerTraining } = await import('./api');
    await expect(setPlayerTraining('campaign-1', { player_ids: ['player-1'], focus: 'balanced', intensity: 80 })).resolves.toEqual(result);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://test.local/api/v1/campaigns/campaign-1/training');
    expect(init.method).toBe('POST');
    expect(init.headers.get('x-tg-init-data')).toBe('signed-test-init-data');
    expect(init.headers.get('idempotency-key')).toBeTruthy();
    expect(JSON.parse(init.body)).toEqual({ player_ids: ['player-1'], focus: 'balanced', intensity: 80 });
  });
});
