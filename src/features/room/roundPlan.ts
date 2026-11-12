import type { GameMode } from '@/shared/types/database';

export interface RoundPlanMember {
  player_id: number;
  team_id: string | null;
  joined_at: string;
}

export interface PlannedRound {
  round_number: number;
  team_id: string;
  explainer_id: number | null;
}

interface RoundPlanRequest {
  mode: GameMode;
  teams: readonly string[];
  members: readonly RoundPlanMember[];
  hostId: number;
  totalRounds: number;
  initData: string;
}

export function buildRoundPlan(
  mode: GameMode,
  teams: readonly string[],
  members: readonly RoundPlanMember[],
  hostId: number,
  totalRounds: number,
): PlannedRound[] {
  if (
    (mode !== 'team' && mode !== '1v1')
    || teams.length === 0
    || !Number.isInteger(totalRounds)
    || totalRounds <= 0
  ) {
    throw new Error('INVALID_ALIAS_ROUND_PLAN');
  }

  const totalTurns = teams.length * totalRounds;
  if (!Number.isSafeInteger(totalTurns) || totalTurns > 0xffff_ffff) {
    throw new Error('INVALID_ALIAS_ROUND_PLAN');
  }

  const playerByTeam = new Map<string, number>();
  for (const member of members) {
    if (member.team_id) playerByTeam.set(member.team_id, member.player_id);
  }

  const orderedTeams = [...teams];
  if (mode === '1v1') {
    const hostTeamIndex = orderedTeams.findIndex((teamId) => playerByTeam.get(teamId) === hostId);
    if (hostTeamIndex > 0) {
      const [hostTeam] = orderedTeams.splice(hostTeamIndex, 1);
      orderedTeams.unshift(hostTeam);
    }
  }

  const knownTeams = new Set(teams);
  const sortedMembers = members
    .filter((member) => member.team_id !== null && knownTeams.has(member.team_id))
    .slice()
    .sort((left, right) => (
      left.joined_at !== right.joined_at
        ? (left.joined_at < right.joined_at ? -1 : 1)
        : left.player_id - right.player_id
    ));

  const rosterByTeam = new Map<string, number[]>();
  for (const member of sortedMembers) {
    const teamId = member.team_id as string;
    const roster = rosterByTeam.get(teamId) ?? [];
    roster.push(member.player_id);
    rosterByTeam.set(teamId, roster);
  }

  return Array.from({ length: totalTurns }, (_, index) => {
    const teamId = orderedTeams[index % orderedTeams.length];
    let explainerId: number | null = null;

    if (mode === '1v1') {
      explainerId = playerByTeam.get(teamId) ?? null;
    } else {
      const roster = rosterByTeam.get(teamId) ?? [];
      if (roster.length > 0) {
        const turn = Math.floor(index / orderedTeams.length) % roster.length;
        explainerId = roster[turn];
      }
    }

    return {
      round_number: index + 1,
      team_id: teamId,
      explainer_id: explainerId,
    };
  });
}

function isPlannedRound(value: unknown): value is PlannedRound {
  if (!value || typeof value !== 'object') return false;
  const round = value as Record<string, unknown>;
  return Number.isSafeInteger(round.round_number)
    && typeof round.round_number === 'number'
    && round.round_number > 0
    && typeof round.team_id === 'string'
    && round.team_id.length > 0
    && (
      round.explainer_id === null
      || (typeof round.explainer_id === 'number' && Number.isSafeInteger(round.explainer_id))
    );
}

export async function requestAliasRoundPlan(request: RoundPlanRequest): Promise<PlannedRound[]> {
  if (import.meta.env.DEV) {
    return buildRoundPlan(
      request.mode,
      request.teams,
      request.members,
      request.hostId,
      request.totalRounds,
    );
  }
  if (!request.initData) throw new Error('TELEGRAM_AUTH_REQUIRED');

  const response = await fetch('/api/v1/alias/round-plan', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tg-init-data': request.initData,
    },
    body: JSON.stringify({
      mode: request.mode,
      teams: request.teams,
      members: request.members,
      total_rounds: request.totalRounds,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof payload?.error === 'string' ? payload.error : 'ALIAS_ROUND_PLAN_FAILED');
  }

  const payload: unknown = await response.json();
  if (
    !Array.isArray(payload)
    || payload.length === 0
    || payload.length > 256
    || !payload.every(isPlannedRound)
  ) {
    throw new Error('INVALID_ALIAS_ROUND_PLAN_RESPONSE');
  }
  return payload;
}
