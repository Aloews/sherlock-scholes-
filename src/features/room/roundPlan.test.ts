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
