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
  it('rejects an empty team list and a zero round count', () => {
    expect(() => buildRoundPlan('team', [], [], 1, 1)).toThrow('INVALID_ALIAS_ROUND_PLAN');
    expect(() => buildRoundPlan('team', ['blue'], [], 1, 0)).toThrow('INVALID_ALIAS_ROUND_PLAN');
  });

  it('rejects unsafe or unrepresentable turn counts', () => {
    expect(() => buildRoundPlan('team', ['blue', 'red'], [], 1, Number.MAX_SAFE_INTEGER))
      .toThrow('INVALID_ALIAS_ROUND_PLAN');
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

  it('uses the TypeScript contract only in local development without Telegram initData', async () => {
    vi.stubEnv('DEV', true);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const plan = await requestAliasRoundPlan({ ...request, initData: '' });

    expect(plan).toEqual([
      { round_number: 1, team_id: 'blue', explainer_id: 1 },
      { round_number: 2, team_id: 'red', explainer_id: 2 },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses the authenticated Rust endpoint when Telegram initData is present', async () => {
    vi.stubEnv('DEV', false);
    const expected = [
      { round_number: 1, team_id: 'blue', explainer_id: 1 },
      { round_number: 2, team_id: 'red', explainer_id: 2 },
    ];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => expected,
    });
    vi.stubGlobal('fetch', fetchMock);

    const plan = await requestAliasRoundPlan({ ...request, initData: 'signed-init-data' });

    expect(plan).toEqual(expected);
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

  it('surfaces backend errors and rejects malformed plans', async () => {
    vi.stubEnv('DEV', false);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'invalid_alias_round_plan' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ round_number: 0, team_id: '', explainer_id: 'bad' }] });
    vi.stubGlobal('fetch', fetchMock);

    await expect(requestAliasRoundPlan({ ...request, initData: 'signed' }))
      .rejects.toThrow('invalid_alias_round_plan');
    await expect(requestAliasRoundPlan({ ...request, initData: 'signed' }))
      .rejects.toThrow('INVALID_ALIAS_ROUND_PLAN_RESPONSE');
  });
});
