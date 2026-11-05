import { getRawInitData } from '@/shared/lib/telegram';

const API_BASE = (import.meta.env.VITE_FD_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export interface CampaignSummary {
  id: string; name: string; mode: 'sandbox' | 'scenario'; status: string;
  current_year: number; created_at: string;
}
export interface Character {
  id: string; full_name: string; age: number; life_status: 'alive' | 'deceased'; is_heir: boolean;
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
  if (mutation) headers.set('idempotency-key', crypto.randomUUID());

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof payload?.error === 'string' ? payload.error : 'request_failed');
  }
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
export const advanceCampaign = (campaignId: string, years: number) =>
  request<{ current_year: number; founder_age: number; status: string; succession_available: boolean }>(
    `/api/v1/campaigns/${encodeURIComponent(campaignId)}/advance`, { method: 'POST', body: JSON.stringify({ years }) }, true,
  );
export const previewSuccession = (campaignId: string) =>
  request<Character[]>(`/api/v1/campaigns/${encodeURIComponent(campaignId)}/succession/preview`);
export const executeSuccession = (campaignId: string, heirId: string) =>
  request<{ campaign_id: string; deceased_character_id: string; heir_id: string; dynasty_head_id: string; status: string }>(
    `/api/v1/campaigns/${encodeURIComponent(campaignId)}/succession`, { method: 'POST', body: JSON.stringify({ heir_id: heirId }) }, true,
  );
