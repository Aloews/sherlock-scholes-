import { afterEach, describe, expect, it, vi } from 'vitest';
import cases from '../../../contracts/alias_round_plan_cases.json';
import type { GameMode } from '@/shared/types/database';
import { buildRoundPlan, requestAliasRoundPlan } from './roundPlan';

const joinedAt = '2026-01-01T10:00:00Z';
const member = (player_id: number, team_id: string | null, joined_at = joinedAt) => ({
  player_id,
  team_id,
  joined_at,
});

describe('shared Rust round-plan contract', () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(buildRoundPlan(
        testCase.mode as GameMode,
        testCase.teams,
        testCase.members,
        testCase.host_id,
        testCase.total_rounds,
      )).toEqual(testCase.expected);
    });
  }
});

describe('round-plan input boundaries', () => {
  it('rejects missing teams, unsupported modes, and invalid round counts', () => {
    expect(() => buildRoundPlan('team', [], [member(1, null)], 1, 1))
      .toThrow('INVALID_ALIAS_ROUND_PLAN');
    expect(() => buildRoundPlan('unknown' as GameMode, ['blue'], [member(1, 'blue')], 1, 1))
      .toThrow('INVALID_ALIAS_ROUND_PLAN');
    for (const totalRounds of [0, -1, 1.5, 65, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => buildRoundPlan('team', ['blue'], [member(1, 'blue')], 1, totalRounds))
        .toThrow('INVALID_ALIAS_ROUND_PLAN');
    }
  });

  it('validates team identifiers at both empty and maximum boundaries', () => {
    for (const teamId of ['', ' ', 'blue team', 't'.repeat(65)]) {
      expect(() => buildRoundPlan('team', [teamId], [member(1, teamId)], 1, 1))
        .toThrow('INVALID_ALIAS_ROUND_PLAN');
    }
    expect(() => buildRoundPlan('team', ['t'.repeat(64)], [member(1, 't'.repeat(64))], 1, 1))
      .not.toThrow();
    expect(() => buildRoundPlan('team', ['blue', 'blue'], [member(1, 'blue')], 1, 1))
      .toThrow('INVALID_ALIAS_ROUND_PLAN');
  });

  it('enforces team and turn limits using a valid host roster', () => {
    const manyTeams = Array.from({ length: 17 }, (_, index) => `team-${index}`);
    const maximumTeams = manyTeams.slice(0, 16);
    expect(() => buildRoundPlan('team', manyTeams, [member(1, manyTeams[0])], 1, 1))
      .toThrow('INVALID_ALIAS_ROUND_PLAN');
    expect(() => buildRoundPlan('team', maximumTeams, [member(1, maximumTeams[0])], 1, 17))
      .toThrow('INVALID_ALIAS_ROUND_PLAN');

    const maximumMembers = Array.from({ length: 128 }, (_, index) => (
      member(index + 1, 'blue')
    ));
    expect(buildRoundPlan('team', ['blue'], maximumMembers, 1, 1)).toHaveLength(1);
    const maximumRoster = maximumMembers.map((player) => ({
      ...player,
      team_id: maximumTeams[0],
    }));
    expect(buildRoundPlan('team', maximumTeams, maximumRoster, 1, 16)).toHaveLength(256);
    expect(() => buildRoundPlan(
      'team',
      ['blue'],
      [...maximumMembers, member(129, 'blue')],
      1,
      1,
    )).toThrow('INVALID_ALIAS_ROUND_PLAN');
  });

  it('rejects duplicate, unsafe, and non-positive player identities', () => {
    expect(() => buildRoundPlan('team', ['blue'], [
      member(1, 'blue'),
      member(1, 'blue'),
    ], 1, 1)).toThrow('INVALID_ALIAS_ROUND_PLAN');
    for (const playerId of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => buildRoundPlan('team', ['blue'], [
        member(1, 'blue'),
        member(playerId, 'blue'),
      ], 1, 1)).toThrow('INVALID_ALIAS_ROUND_PLAN');
    }
    expect(() => buildRoundPlan('team', ['blue'], [
      member(2, 'blue'),
    ], 1, 1)).toThrow('INVALID_ALIAS_ROUND_PLAN');
  });

  it('rejects malformed member team identifiers and ignores unassigned or removed teams', () => {
    expect(() => buildRoundPlan('team', ['blue'], [
      member(1, 'blue'),
      member(2, 'blue team'),
    ], 1, 1)).toThrow('INVALID_ALIAS_ROUND_PLAN');
    expect(() => buildRoundPlan('team', ['blue'], [
      member(1, 'blue'),
      { ...member(2, 'blue'), team_id: 42 as unknown as string },
    ], 1, 1)).toThrow('INVALID_ALIAS_ROUND_PLAN');

    const plan = buildRoundPlan('team', ['blue'], [
      member(1, 'blue'),
      member(2, null, '2025-01-01T10:00:00Z'),
      member(3, 'removed', '2025-01-01T10:00:00Z'),
    ], 1, 2);
    expect(plan.map((round) => round.explainer_id)).toEqual([1, 1]);
  });

  it('validates strict timestamps, offsets, and real calendar dates', () => {
    expect(() => buildRoundPlan('team', ['blue'], [
      member(1, 'blue', '2026-01-01T10:00:00.123Z'),
    ], 1, 1)).not.toThrow();
    expect(() => buildRoundPlan('team', ['blue'], [
      member(1, 'blue', '2026-01-01T13:00:00+03:00'),
    ], 1, 1)).not.toThrow();
    expect(() => buildRoundPlan('team', ['blue'], [
      member(1, 'blue', '0001-01-01T10:00:00Z'),
    ], 1, 1)).not.toThrow();

    const invalidTimestamps = [
      null,
      '2026-01-01',
      'prefix-2026-01-01T10:00:00Z',
      '2026-01-01T10:00:00Z-suffix',
      '2026-01-01T24:00:00Z',
      '2026-01-01T10:60:00Z',
      '2026-01-01T10:00:60Z',
      '2026-01-01T10:00:00',
      '2026-01-01T10:00:00+24:00',
      '2026-01-01T10:00:00.xZ',
      '2026-13-01T10:00:00Z',
      '2026-04-31T10:00:00Z',
      '2025-02-29T10:00:00Z',
    ];
    for (const timestamp of invalidTimestamps) {
      expect(() => buildRoundPlan('team', ['blue'], [
        member(1, 'blue', timestamp as string),
      ], 1, 1)).toThrow('INVALID_ALIAS_ROUND_PLAN');
    }
  });

  it('sorts by join time before player id and rotates team explainers', () => {
    const plan = buildRoundPlan('team', ['blue'], [
      member(2, 'blue', '2026-01-02T10:00:00Z'),
      member(9, 'blue', '2026-01-01T10:00:00Z'),
      member(1, 'blue', '2026-01-03T10:00:00Z'),
    ], 1, 3);
    expect(plan.map((round) => round.explainer_id)).toEqual([9, 2, 1]);
  });

  it('uses player id as a deterministic join-time tie breaker', () => {
    const plan = buildRoundPlan('team', ['blue'], [
      member(9, 'blue'),
      member(2, 'blue'),
    ], 2, 2);
    expect(plan.map((round) => round.explainer_id)).toEqual([2, 9]);
  });

  it('places the 1v1 host team first and preserves team-mode order', () => {
    const oneVsOne = buildRoundPlan('1v1', ['home', 'away'], [
      member(10, 'home'),
      member(20, 'away', '2026-01-02T10:00:00Z'),
    ], 20, 1);
    expect(oneVsOne.map((round) => round.team_id)).toEqual(['away', 'home']);

    const teamMode = buildRoundPlan('team', ['home', 'away'], [
      member(2, 'home'),
      member(3, 'away'),
      member(1, 'away', '2026-01-02T10:00:00Z'),
    ], 1, 1);
    expect(teamMode.map((round) => round.team_id)).toEqual(['home', 'away']);
  });

  it('requires exactly two 1v1 players assigned to distinct known teams', () => {
    const valid = [member(1, 'home'), member(2, 'away')];
    expect(buildRoundPlan('1v1', ['home', 'away'], valid, 1, 1)).toHaveLength(2);
    const invalidRosters = [
      { teams: ['home'], members: valid },
      { teams: ['home', 'away', 'extra'], members: valid },
      { teams: ['home', 'away'], members: valid.slice(0, 1) },
      { teams: ['home', 'away'], members: [...valid, member(3, 'home')] },
      { teams: ['home', 'away'], members: [valid[0], member(2, null)] },
      { teams: ['home', 'away'], members: [valid[0], member(2, 'unknown')] },
      { teams: ['home', 'away'], members: [valid[0], member(2, 'home')] },
    ];
    for (const roster of invalidRosters) {
      expect(() => buildRoundPlan('1v1', roster.teams, roster.members, 1, 1))
        .toThrow('INVALID_ALIAS_ROUND_PLAN');
    }
  });
});

describe('requestAliasRoundPlan', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const request = {
    roomId: '00000000-0000-4000-8000-000000000001',
    mode: 'team' as const,
    teams: ['blue', 'red'],
    members: [
      member(1, 'blue'),
      member(2, 'red'),
    ],
    hostId: 1,
    totalRounds: 1,
  };

  const validPlan = [
    { round_number: 1, team_id: 'blue', explainer_id: 1 },
    { round_number: 2, team_id: 'red', explainer_id: 2 },
  ];

  it('uses the TypeScript contract in local development without calling the Rust API', async () => {
    vi.stubEnv('DEV', true);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const plan = await requestAliasRoundPlan({ ...request, initData: 'local-telegram-init-data' });

    expect(plan).toEqual(validPlan);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the authenticated Rust endpoint when Telegram initData is present', async () => {
    vi.stubEnv('DEV', false);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => validPlan,
    });
    vi.stubGlobal('fetch', fetchMock);

    const plan = await requestAliasRoundPlan({ ...request, initData: 'signed-init-data' });

    expect(plan).toEqual(validPlan);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/alias/round-plan', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tg-init-data': 'signed-init-data',
      },
      body: JSON.stringify({ room_id: request.roomId }),
    });
  });

  it('does not silently fall back to TypeScript in production when auth is absent', async () => {
    vi.stubEnv('DEV', false);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestAliasRoundPlan({ ...request, initData: '' }))
      .rejects.toThrow('TELEGRAM_AUTH_REQUIRED');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed payloads and validates every field of the Rust response', async () => {
    vi.stubEnv('DEV', false);
    const malformedPayloads = [
      null,
      { length: 2 },
      ['not-an-object', validPlan[1]],
      [{ ...validPlan[0], round_number: 1.5 }, validPlan[1]],
      [{ ...validPlan[0], team_id: { length: 4 } }, validPlan[1]],
      [{ ...validPlan[0], explainer_id: 1.5 }, validPlan[1]],
      [{ ...validPlan[0], explainer_id: 0 }, validPlan[1]],
      [{ ...validPlan[0], round_number: 2 }, { ...validPlan[1], round_number: 1 }],
      [validPlan[0]],
      [],
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => null })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 42 }) })
      .mockImplementation(async () => ({
        ok: true,
        json: async () => malformedPayloads.shift(),
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestAliasRoundPlan({ ...request, initData: 'signed' }))
      .rejects.toThrow('ALIAS_ROUND_PLAN_FAILED');
    await expect(requestAliasRoundPlan({ ...request, initData: 'signed' }))
      .rejects.toThrow('ALIAS_ROUND_PLAN_FAILED');
    for (let index = 0; index < 10; index += 1) {
      await expect(requestAliasRoundPlan({ ...request, initData: 'signed' }))
        .rejects.toThrow('INVALID_ALIAS_ROUND_PLAN_RESPONSE');
    }
  });

  it('accepts a nullable explainer and exactly 256 rounds but rejects oversized and unsafe plans', async () => {
    vi.stubEnv('DEV', false);
    const maximumTeams = Array.from({ length: 16 }, (_, index) => `team-${index}`);
    const maximumPlan = Array.from({ length: 256 }, (_, index) => ({
      round_number: index + 1,
      team_id: maximumTeams[index % maximumTeams.length],
      explainer_id: index === 0 ? null : 1,
    }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { round_number: 1, team_id: 'blue', explainer_id: null },
          validPlan[1],
        ],
      })
      .mockResolvedValueOnce({ ok: true, json: async () => maximumPlan })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => Array.from({ length: 272 }, (_, index) => ({
          round_number: index + 1,
          team_id: 'blue',
          explainer_id: 1,
        })),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => validPlan })
      .mockResolvedValueOnce({ ok: true, json: async () => validPlan });
    vi.stubGlobal('fetch', fetchMock);

    expect(await requestAliasRoundPlan({ ...request, initData: 'signed' })).toEqual([
      { round_number: 1, team_id: 'blue', explainer_id: null },
      validPlan[1],
    ]);
    expect(await requestAliasRoundPlan({
      ...request,
      teams: maximumTeams,
      totalRounds: 16,
      initData: 'signed',
    })).toEqual(maximumPlan);
    await expect(requestAliasRoundPlan({
      ...request,
      teams: Array.from({ length: 16 }, (_, index) => `team-${index}`),
      totalRounds: 17,
      initData: 'signed',
    })).rejects.toThrow('INVALID_ALIAS_ROUND_PLAN_RESPONSE');
    await expect(requestAliasRoundPlan({
      ...request,
      totalRounds: Number.NaN,
      initData: 'signed',
    })).rejects.toThrow('INVALID_ALIAS_ROUND_PLAN_RESPONSE');
    await expect(requestAliasRoundPlan({
      ...request,
      teams: [],
      initData: 'signed',
    })).rejects.toThrow('INVALID_ALIAS_ROUND_PLAN_RESPONSE');
  });

  it('surfaces backend errors and rejects non-sequential plans', async () => {
    vi.stubEnv('DEV', false);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'invalid_alias_round_plan' }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { ...validPlan[0], round_number: 2 },
          { ...validPlan[1], round_number: 1 },
        ],
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestAliasRoundPlan({ ...request, initData: 'signed' }))
      .rejects.toThrow('invalid_alias_round_plan');
    await expect(requestAliasRoundPlan({ ...request, initData: 'signed' }))
      .rejects.toThrow('INVALID_ALIAS_ROUND_PLAN_RESPONSE');
  });
});

describe('startAliasGame', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends only the room id with Telegram authentication and validates the response', async () => {
    const response = {
      first_round_id: '11111111-1111-4111-8111-111111111111',
      total_rounds: 6,
    };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => response });
    vi.stubGlobal('fetch', fetchMock);

    await expect(startAliasGame(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'signed-init-data',
    )).resolves.toBe(response.first_round_id);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/alias/start', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-tg-init-data': 'signed-init-data',
      },
      body: JSON.stringify({ room_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
    });
  });

  it('rejects missing authentication, invalid room ids, backend errors and malformed responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'room_not_found' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ first_round_id: 'not-a-uuid', total_rounds: 2 }) });
    vi.stubGlobal('fetch', fetchMock);

    await expect(startAliasGame('bad-id', 'signed')).rejects.toThrow('INVALID_ROOM_ID');
    await expect(startAliasGame('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ''))
      .rejects.toThrow('TELEGRAM_AUTH_REQUIRED');
    await expect(startAliasGame('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'signed'))
      .rejects.toThrow('room_not_found');
    await expect(startAliasGame('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'signed'))
      .rejects.toThrow('INVALID_ALIAS_START_RESPONSE');
  });
});
