import { afterEach, describe, expect, it, vi } from 'vitest';
import cases from '../../../contracts/alias_round_plan_cases.json';
import type { GameMode } from '@/shared/types/database';
import { buildRoundPlan, requestAliasRoundPlan } from './roundPlan';

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
  it('rejects missing teams, invalid modes, and invalid host identities', () => {
    expect(() => buildRoundPlan('team', [], [], 1, 1)).toThrow('INVALID_ALIAS_ROUND_PLAN');
    expect(() => buildRoundPlan('team', ['blue'], [], 1, 1.5)).toThrow('INVALID_ALIAS_ROUND_PLAN');
    expect(() => buildRoundPlan('unknown' as GameMode, ['blue'], [], 1, 1)).toThrow('INVALID_ALIAS_ROUND_PLAN');
    expect(() => buildRoundPlan('team', ['blue'], [], 0, 1)).toThrow('INVALID_ALIAS_ROUND_PLAN');
  });

  it('rejects duplicate, malformed, and oversized teams', () => {
    expect(() => buildRoundPlan('team', ['blue', 'blue'], [], 1, 1)).toThrow('INVALID_ALIAS_ROUND_PLAN');
    expect(() => buildRoundPlan('team', ['blue team'], [], 1, 1)).toThrow('INVALID_ALIAS_ROUND_PLAN');
    expect(() => buildRoundPlan('team', Array.from({ length: 17 }, (_, i) => `team-${i}`), [], 1, 1))
      .toThrow('INVALID_ALIAS_ROUND_PLAN');
  });

  it('rejects invalid round counts and plans exceeding the turn cap', () => {
    expect(() => buildRoundPlan('team', ['blue'], [], 1, 0)).toThrow('INVALID_ALIAS_ROUND_PLAN');
    expect(() => buildRoundPlan('team', ['blue'], [], 1, 65)).toThrow('INVALID_ALIAS_ROUND_PLAN');
    expect(() => buildRoundPlan('team', Array.from({ length: 16 }, (_, i) => `team-${i}`), [], 1, 17))
      .toThrow('INVALID_ALIAS_ROUND_PLAN');
  });

  it('enforces inclusive maximums and validates timestamp calendar values', () => {
    const teams = Array.from({ length: 16 }, (_, index) => `team-${index}`);
    const members = Array.from({ length: 128 }, (_, index) => ({
      player_id: index + 1,
      team_id: teams[index % teams.length],
      joined_at: '2026-01-01T10:00:00Z',
    }));
    const maximumPlan = buildRoundPlan('team', teams, members, 1, 16);

    expect(maximumPlan).toHaveLength(256);
    expect(() => buildRoundPlan('team', ['t'.repeat(64)], [{
      player_id: 1,
      team_id: 't'.repeat(64),
      joined_at: '2026-01-01T10:00:00Z',
    }], 1, 1)).not.toThrow();
    expect(() => buildRoundPlan('team', [' '], [], 1, 1)).toThrow('INVALID_ALIAS_ROUND_PLAN');
    expect(() => buildRoundPlan('team', ['t'.repeat(65)], [], 1, 1)).toThrow('INVALID_ALIAS_ROUND_PLAN');
    expect(() => buildRoundPlan('team', ['valid', 'invalid team'], [], 1, 1))
      .toThrow('INVALID_ALIAS_ROUND_PLAN');
    expect(() => buildRoundPlan('team', ['blue'], [{
      player_id: 1,
      team_id: 'blue',
      joined_at: '2026-02-30T10:00:00Z',
    }], 1, 1)).toThrow('INVALID_ALIAS_ROUND_PLAN');
    expect(() => buildRoundPlan('team', ['blue'], [{
      player_id: 1,
      team_id: 'blue',
      joined_at: '2026-01-01',
    }], 1, 1)).toThrow('INVALID_ALIAS_ROUND_PLAN');
    expect(() => buildRoundPlan('team', ['blue'], [{
      player_id: 1,
      team_id: 'blue',
      joined_at: null as unknown as string,
    }], 1, 1)).toThrow('INVALID_ALIAS_ROUND_PLAN');
  });

  it('uses player id as a deterministic join-time tie breaker and ignores unassigned members', () => {
    const plan = buildRoundPlan('team', ['blue'], [
      { player_id: 9, team_id: 'blue', joined_at: '2026-01-01T10:00:00Z' },
      { player_id: 2, team_id: 'blue', joined_at: '2026-01-01T10:00:00Z' },
      { player_id: 1, team_id: null, joined_at: '2026-01-01T10:00:00Z' },
    ], 2, 2);

    expect(plan.map((round) => round.explainer_id)).toEqual([2, 9]);
  });

  it('keeps the first 1v1 team in place when it already belongs to the host', () => {
    const plan = buildRoundPlan('1v1', ['home', 'away'], [
      { player_id: 1, team_id: 'home', joined_at: '2026-01-01T10:00:00Z' },
      { player_id: 2, team_id: 'away', joined_at: '2026-01-01T10:00:00Z' },
    ], 1, 1);

    expect(plan.map((round) => round.team_id)).toEqual(['home', 'away']);
  });

  it('requires exactly two 1v1 players assigned to distinct known teams', () => {
    const members = [
      { player_id: 1, team_id: 'home', joined_at: '2026-01-01T10:00:00Z' },
      { player_id: 2, team_id: 'away', joined_at: '2026-01-01T10:00:00Z' },
    ];
    expect(() => buildRoundPlan('1v1', ['home', 'away'], members, 1, 1)).not.toThrow();
    expect(() => buildRoundPlan('1v1', ['home', 'away'], members.slice(0, 1), 1, 1))
      .toThrow('INVALID_ALIAS_ROUND_PLAN');
    expect(() => buildRoundPlan('1v1', ['home', 'away'], [
      ...members,
      { player_id: 3, team_id: 'home', joined_at: '2026-01-01T10:00:00Z' },
    ], 1, 1)).toThrow('INVALID_ALIAS_ROUND_PLAN');
    expect(() => buildRoundPlan('1v1', ['home', 'away'], [
      members[0],
      { ...members[1], team_id: null },
    ], 1, 1)).toThrow('INVALID_ALIAS_ROUND_PLAN');
    expect(() => buildRoundPlan('1v1', ['home', 'away'], [
      members[0],
      { ...members[1], team_id: 'home' },
    ], 1, 1)).toThrow('INVALID_ALIAS_ROUND_PLAN');
  });

  it('requires the authenticated host to be a room member', () => {
    expect(() => buildRoundPlan('team', ['blue'], [
      { player_id: 2, team_id: 'blue', joined_at: '2026-01-01T10:00:00Z' },
    ], 1, 1)).toThrow('INVALID_ALIAS_ROUND_PLAN');
  });

  it('rejects duplicate or malformed room members', () => {
    const member = { player_id: 1, team_id: 'blue', joined_at: '2026-01-01T10:00:00Z' };
    expect(() => buildRoundPlan('team', ['blue'], [member, member], 1, 1))
      .toThrow('INVALID_ALIAS_ROUND_PLAN');
    expect(() => buildRoundPlan('team', ['blue'], [{ ...member, player_id: 0 }], 1, 1))
      .toThrow('INVALID_ALIAS_ROUND_PLAN');
    expect(() => buildRoundPlan('team', ['blue'], [{ ...member, team_id: 'blue team' }], 1, 1))
      .toThrow('INVALID_ALIAS_ROUND_PLAN');
    expect(() => buildRoundPlan('team', ['blue'], [{ ...member, joined_at: 'x'.repeat(65) }], 1, 1))
      .toThrow('INVALID_ALIAS_ROUND_PLAN');
    expect(() => buildRoundPlan('team', ['blue'], Array.from({ length: 129 }, (_, i) => ({
      player_id: i + 1,
      team_id: 'blue',
      joined_at: '2026-01-01T10:00:00Z',
    })), 1, 1)).toThrow('INVALID_ALIAS_ROUND_PLAN');
  });
});

describe('requestAliasRoundPlan', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const request = {
    mode: 'team' as const,
    teams: ['blue', 'red'],
    members: [
      { player_id: 1, team_id: 'blue', joined_at: '2026-01-01T10:00:00Z' },
      { player_id: 2, team_id: 'red', joined_at: '2026-01-01T10:00:00Z' },
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
      body: JSON.stringify({
        mode: 'team',
        teams: ['blue', 'red'],
        members: request.members,
        total_rounds: 1,
      }),
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

  it('rejects malformed response shapes and falls back for non-string backend errors', async () => {
    vi.stubEnv('DEV', false);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => null })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 42 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ length: 2 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [null, validPlan[1]] })
      .mockResolvedValueOnce({ ok: true, json: async () => [
        { ...validPlan[0], explainer_id: -1 },
        validPlan[1],
      ] })
      .mockResolvedValueOnce({ ok: true, json: async () => [
        validPlan[0],
        { ...validPlan[1], team_id: 'not-a-requested-team' },
      ] });
    vi.stubGlobal('fetch', fetchMock);

    for (let i = 0; i < 2; i += 1) {
      await expect(requestAliasRoundPlan({ ...request, initData: 'signed' }))
        .rejects.toThrow('ALIAS_ROUND_PLAN_FAILED');
    }
    for (let i = 0; i < 4; i += 1) {
      await expect(requestAliasRoundPlan({ ...request, initData: 'signed' }))
        .rejects.toThrow('INVALID_ALIAS_ROUND_PLAN_RESPONSE');
    }
  });

  it('requires the exact number of rounds and enforces the response-size cap', async () => {
    vi.stubEnv('DEV', false);
    const fourRounds = [
      { round_number: 1, team_id: 'blue', explainer_id: 1 },
      { round_number: 2, team_id: 'red', explainer_id: 2 },
      { round_number: 3, team_id: 'blue', explainer_id: 1 },
      { round_number: 4, team_id: 'red', explainer_id: 2 },
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => fourRounds })
      .mockResolvedValueOnce({ ok: true, json: async () => fourRounds.slice(0, 2) })
      .mockResolvedValueOnce({ ok: true, json: async () => Array.from({ length: 272 }, (_, index) => ({
        round_number: index + 1,
        team_id: 'blue',
        explainer_id: 1,
      })) })
      .mockResolvedValueOnce({ ok: true, json: async () => [] });
    vi.stubGlobal('fetch', fetchMock);

    expect(await requestAliasRoundPlan({
      ...request,
      totalRounds: 2,
      initData: 'signed',
    })).toEqual(fourRounds);
    await expect(requestAliasRoundPlan({
      ...request,
      totalRounds: 2,
      initData: 'signed',
    })).rejects.toThrow('INVALID_ALIAS_ROUND_PLAN_RESPONSE');
    await expect(requestAliasRoundPlan({
      ...request,
      teams: Array.from({ length: 16 }, (_, index) => `team-${index}`),
      totalRounds: 17,
      initData: 'signed',
    })).rejects.toThrow('INVALID_ALIAS_ROUND_PLAN_RESPONSE');
    await expect(requestAliasRoundPlan({
      ...request,
      teams: [],
      initData: 'signed',
    })).rejects.toThrow('INVALID_ALIAS_ROUND_PLAN_RESPONSE');
  });

  it('surfaces backend errors and rejects malformed response sequences', async () => {
    vi.stubEnv('DEV', false);
    const invalidPlans = [
      [{ round_number: 0, team_id: 'blue', explainer_id: 1 }, validPlan[1]],
      [{ round_number: 1, team_id: '', explainer_id: 1 }, validPlan[1]],
      [{ round_number: 1, team_id: 'blue', explainer_id: 0 }, validPlan[1]],
      [{ round_number: 2, team_id: 'blue', explainer_id: 1 }, { ...validPlan[1], round_number: 1 }],
      [validPlan[0]],
      [],
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'invalid_alias_round_plan' }) })
      .mockImplementation(async () => ({
        ok: true,
        json: async () => invalidPlans.shift(),
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestAliasRoundPlan({ ...request, initData: 'signed' }))
      .rejects.toThrow('invalid_alias_round_plan');
    for (let i = 0; i < 6; i += 1) {
      await expect(requestAliasRoundPlan({ ...request, initData: 'signed' }))
        .rejects.toThrow('INVALID_ALIAS_ROUND_PLAN_RESPONSE');
    }
  });
});
