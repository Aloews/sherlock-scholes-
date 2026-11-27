import { getRawInitData } from '@/shared/lib/telegram';

const API_BASE = (import.meta.env.VITE_FD_API_URL as string | undefined)?.replace(/\/$/, '') || window.location.origin;
const pendingMutationKeys = new Map<string, string>();

export interface CampaignSummary {
  id: string; name: string; mode: 'sandbox' | 'scenario'; status: string;
  current_year: number; game_date: string; created_at: string;
}
export interface Character {
  id: string; full_name: string; age: number; life_status: 'alive' | 'deceased'; is_heir: boolean;
}

export interface GameEvent {
  id: string; event_type: string; title: string; body: string; game_date: string; expires_on: string;
  priority: number; choices: { id: string; label: string; effect: string }[];
  status: 'pending' | 'resolved' | 'expired'; resolution: Record<string, unknown> | null;
}

export interface SeasonFixture {
  id: string; season_year: number; matchday: number; match_date: string;
  home_team: string; away_team: string; status: 'scheduled' | 'played';
  home_goals: number | null; away_goals: number | null;
}
export interface LeagueStanding {
  team: string; played: number; wins: number; draws: number; losses: number;
  goals_for: number; goals_against: number; points: number;
}
export interface SeasonView {
  season_year: number; fixtures: SeasonFixture[]; standings: LeagueStanding[];
}
export interface CampaignSquadPlayer {
  id: string; full_name: string; position: 'goalkeeper' | 'defender' | 'midfielder' | 'forward';
  shirt_number: number; age: number; pace: number; shooting: number; passing: number;
  defending: number; physical: number; goalkeeping: number; stamina: number; morale: number;
  fatigue: number; potential: number; market_value_minor: number; wage_minor: number;
  contract_until: string | null; injured_until: string | null; suspended_until: string | null;
  training_focus: string | null; training_intensity: number | null;
}
export interface CampaignSquadView {
  team_id: string; team_name: string; formation: string; next_fixture_id: string | null;
  starter_ids: string[]; substitute_ids: string[]; players: CampaignSquadPlayer[];
}

export interface CampaignCreated {
  id: string; name: string; mode: string; status: string; current_year: number;
  dynasty_id: string; founder_id: string; club_id: string;
}
export interface CampaignView {
  campaign: CampaignSummary;
  player_character_id: string;
  founder: Character;
  dynasty: { id: string; name: string; head_character_id: string; prestige: number };
  characters: Character[];
  clubs: { id: string; name: string; city: string; reputation: number }[];
  cash_accounts: { id: string; name: string; account_type: string; currency: string; balance_minor: number }[];
  chronicle: { id: string; event_type: string; title: string; game_year: number; payload: Record<string, unknown> }[];
}

async function request<T>(path: string, init: RequestInit = {}, mutation = false): Promise<T> {
  if (!API_BASE) throw new Error('football_dynasty_api_unconfigured');
  const initData = getRawInitData();
  if (!initData) throw new Error('telegram_auth_required');

  const headers = new Headers(init.headers);
  headers.set('x-tg-init-data', initData);
  if (init.body) headers.set('content-type', 'application/json');

  // Reuse the same key after an ambiguous network/5xx failure so a retry
  // replays the committed result instead of executing the mutation twice.
  const mutationFingerprint = mutation ? path + '\n' + String(init.body ?? '') : '';
  if (mutation) {
    const key = pendingMutationKeys.get(mutationFingerprint) ?? crypto.randomUUID();
    pendingMutationKeys.set(mutationFingerprint, key);
    headers.set('idempotency-key', key);
  }

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (mutation && response.status < 500) pendingMutationKeys.delete(mutationFingerprint);
    throw new Error(typeof payload?.error === 'string' ? payload.error : 'request_failed');
  }
  if (mutation) pendingMutationKeys.delete(mutationFingerprint);
  return payload as T;
}

export const listCampaigns = () => request<CampaignSummary[]>('/api/v1/campaigns');
export const getCampaign = (id: string) => request<CampaignView>(`/api/v1/campaigns/${encodeURIComponent(id)}`);
export const createCampaign = (payload: {
  name: string; mode: 'sandbox' | 'scenario'; origin: string;
  founder_name: string; dynasty_name: string; club_name: string;
}) => request<CampaignCreated>('/api/v1/campaigns', { method: 'POST', body: JSON.stringify(payload) }, true);
export const createHeir = (campaignId: string, payload: { name: string; age: number }) =>
  request<Character>(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/heirs`, { method: 'POST', body: JSON.stringify(payload) }, true);
export const previewSuccession = (campaignId: string) =>
  request<Character[]>(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/succession/preview`);
export const executeSuccession = (campaignId: string, heirId: string) =>
  request<{ campaign_id: string; deceased_character_id: string; heir_id: string; dynasty_head_id: string; status: string }>(
    `/api/v1/campaigns/${encodeURIComponent(campaignId)}/succession`, { method: 'POST', body: JSON.stringify({ heir_id: heirId }) }, true,
  );

export const advanceGameTime = (campaignId: string, days: number) =>
  request<{ from_date: string; current_date: string; current_year: number; player_age: number; status: string; generated_events: number; expired_events: number }>(
    `/api/v1/campaigns/${encodeURIComponent(campaignId)}/time/advance`,
    { method: 'POST', body: JSON.stringify({ days }) }, true,
  );
export const listGameEvents = async (campaignId: string): Promise<GameEvent[]> => {
  const events = await request<unknown>(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/events`);
  if (!Array.isArray(events)) throw new Error('invalid_events_response');
  return events as GameEvent[];
};
export const getSeason = (campaignId: string) =>
  request<SeasonView>('/api/v1/campaigns/' + encodeURIComponent(campaignId) + '/season');
export const getSquad = async (campaignId: string): Promise<CampaignSquadView> => {
  const squad = await request<unknown>('/api/v1/campaigns/' + encodeURIComponent(campaignId) + '/squad');
  if (!squad || typeof squad !== 'object'
    || !Array.isArray((squad as { players?: unknown }).players)
    || !Array.isArray((squad as { starter_ids?: unknown }).starter_ids)
    || !Array.isArray((squad as { substitute_ids?: unknown }).substitute_ids)
    || !('next_fixture_id' in squad)
    || !((squad as { next_fixture_id?: unknown }).next_fixture_id === null
      || typeof (squad as { next_fixture_id?: unknown }).next_fixture_id === 'string')) {
    throw new Error('invalid_squad_response');
  }
  return squad as CampaignSquadView;
};
export interface LineupSelection { formation: string; starterIds: string[]; substituteIds: string[] }

const FORMATION_COUNTS: Record<string, [number, number, number]> = {
  '4-3-3': [4, 3, 3], '4-4-2': [4, 4, 2], '3-5-2': [3, 5, 2],
  '4-2-3-1': [4, 5, 1], '3-4-3': [3, 4, 3],
};

/** Restore a saved lineup only when every selected player is still eligible. */
export const resolveLineupSelection = (
  squad: CampaignSquadView,
  gameDate?: string,
): LineupSelection => {
  const available = squad.players.filter((player) =>
    !(gameDate && player.injured_until && player.injured_until >= gameDate)
    && !(gameDate && player.suspended_until && player.suspended_until >= gameDate),
  );
  const byId = new Map(available.map((player) => [player.id, player]));
  const savedIds = [...squad.starter_ids, ...squad.substitute_ids];
  const counts = FORMATION_COUNTS[squad.formation];
  const savedStarters = squad.starter_ids.map((id) => byId.get(id));
  const savedIsEligible = Boolean(counts)
    && squad.starter_ids.length === 11
    && squad.substitute_ids.length <= 7
    && new Set(savedIds).size === savedIds.length
    && savedStarters.every(Boolean)
    && squad.substitute_ids.every((id) => byId.has(id))
    && savedStarters.filter((player) => player?.position === 'goalkeeper').length === 1
    && savedStarters.filter((player) => player?.position === 'defender').length === counts?.[0]
    && savedStarters.filter((player) => player?.position === 'midfielder').length === counts?.[1]
    && savedStarters.filter((player) => player?.position === 'forward').length === counts?.[2];

  if (savedIsEligible) {
    return { formation: squad.formation, starterIds: [...squad.starter_ids], substituteIds: [...squad.substitute_ids] };
  }

  const formation = counts ? squad.formation : '4-3-3';
  const [defenders, midfielders, forwards] = FORMATION_COUNTS[formation];
  const take = (position: CampaignSquadPlayer['position'], count: number) =>
    available.filter((player) => player.position === position).slice(0, count).map((player) => player.id);
  const starterIds = [
    ...take('goalkeeper', 1), ...take('defender', defenders),
    ...take('midfielder', midfielders), ...take('forward', forwards),
  ];
  return {
    formation,
    starterIds,
    substituteIds: available.filter((player) => !starterIds.includes(player.id)).slice(0, 7).map((player) => player.id),
  };
};

export interface SaveLineupPayload { formation: string; starter_ids: string[]; substitute_ids: string[] }
export interface SaveLineupResult { fixture_id: string; team_id: string; formation: string; starters_saved: number; substitutes_saved: number }
export interface SetTrainingPayload { player_ids: string[]; focus: 'finishing' | 'passing' | 'defending' | 'physical' | 'goalkeeping' | 'balanced' | 'recovery'; intensity: number }
export interface SetTrainingResult { campaign_id: string; team_id: string; assigned_players: number; focus: string; intensity: number }
export const setPlayerTraining = (campaignId: string, payload: SetTrainingPayload) =>
  request<SetTrainingResult>(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/training`,
    { method: 'POST', body: JSON.stringify(payload) }, true);

export const saveLineup = (campaignId: string, fixtureId: string, payload: SaveLineupPayload) =>
  request<SaveLineupResult>(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/fixtures/${encodeURIComponent(fixtureId)}/lineup`,
    { method: 'POST', body: JSON.stringify(payload) }, true);

export const resolveGameEvent = (campaignId: string, eventId: string, choiceId: string) =>
  request<{ event_id: string; status: string; resolution: Record<string, unknown> }>(
    `/api/v1/campaigns/${encodeURIComponent(campaignId)}/events/${encodeURIComponent(eventId)}/resolve`,
    { method: 'POST', body: JSON.stringify({ choice_id: choiceId }) }, true,
  );

export interface WorldEvent {
  id: string;
  event_type: string;
  game_day: number;
  location_key: string;
  state: 'generated' | 'known' | 'active' | 'resolved' | 'expired';
  payload: Record<string, unknown>;
  parent_event_id: string | null;
}
export interface WorldEventResponse {
  event_id: string;
  response: 'help' | 'report' | 'ignore';
  status: string;
  witness_count: number;
  immediate_reactions: string[];
  scheduled_reaction: string | null;
  scheduled_reactions: string[];
}
export const listWorldEvents = async (campaignId: string): Promise<WorldEvent[]> => {
  const events = await request<unknown>(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/world/events`);
  if (!Array.isArray(events)) throw new Error('invalid_world_events_response');
  return events as WorldEvent[];
};
export const respondToWorldEvent = (campaignId: string, eventId: string, response: 'help' | 'report' | 'ignore') =>
  request<WorldEventResponse>(
    `/api/v1/campaigns/${encodeURIComponent(campaignId)}/world/events/${encodeURIComponent(eventId)}/respond`,
    { method: 'POST', body: JSON.stringify({ response }) }, true,
  );
