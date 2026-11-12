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

function validTeamId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 64 && !/\s/.test(value);
}

function validJoinedAt(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 64) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  return calendarDate.getUTCFullYear() === year
    && calendarDate.getUTCMonth() === month - 1
    && calendarDate.getUTCDate() === day;
}

export function buildRoundPlan(
  mode: GameMode,
  teams: readonly string[],
  members: readonly RoundPlanMember[],
  hostId: number,
  totalRounds: number,
): PlannedRound[] {
  const uniqueTeams = new Set(teams);
  const uniquePlayers = new Set(members.map((member) => member.player_id));
  const totalTurns = teams.length * totalRounds;
  const oneVsOneHasTwoAssignedPlayers = mode !== '1v1'
    || (teams.length === 2
      && members.length === 2
      && members.every((member) => member.team_id !== null && teams.includes(member.team_id))
      && new Set(members.map((member) => member.team_id)).size === 2);

  if (
    !oneVsOneHasTwoAssignedPlayers
    || 
    (mode !== 'team' && mode !== '1v1')
    || !Number.isSafeInteger(hostId)
    || hostId <= 0
    || teams.length === 0
    || teams.length > 16
    || uniqueTeams.size !== teams.length
    || teams.some((team) => !validTeamId(team))
    || !Number.isInteger(totalRounds)
    || totalRounds <= 0
    || totalRounds > 64
    || !Number.isSafeInteger(totalTurns)
    || totalTurns > 256
    || members.length > 128
    || uniquePlayers.size !== members.length
    || !members.some((member) => member.player_id === hostId)
    || members.some((member) => (
      !Number.isSafeInteger(member.player_id)
      || member.player_id <= 0
      || !validJoinedAt(member.joined_at)
      || (member.team_id !== null && !validTeamId(member.team_id))
    ))
  ) {
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
      || (
        typeof round.explainer_id === 'number'
        && Number.isSafeInteger(round.explainer_id)
        && round.explainer_id > 0
      )
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
  const expectedLength = request.teams.length * request.totalRounds;
  if (
    !Number.isSafeInteger(expectedLength)
    || expectedLength <= 0
    || expectedLength > 256
    || !Array.isArray(payload)
    || payload.length !== expectedLength
    || !payload.every((round, index) => (
      isPlannedRound(round)
      && round.round_number === index + 1
      && request.teams.includes(round.team_id)
    ))
  ) {
    throw new Error('INVALID_ALIAS_ROUND_PLAN_RESPONSE');
  }
  return payload;
}
