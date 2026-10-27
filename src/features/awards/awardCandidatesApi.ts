import { supabase } from '@/shared/lib/supabase';
import { fromPostgrest, type LoadState } from '@/shared/lib/loadState';

export type AwardKey =
  | 'ballon_dor'
  | 'ballon_dor_feminin'
  | 'the_best'
  | 'the_best_female'
  | 'golden_boy'
  | 'golden_boot';

export interface AwardCandidate {
  award_key: AwardKey;
  season_id: number;
  snapshot_date: string;
  candidate_score: number;
  candidate_rank: number;
  confidence: 'low' | 'medium' | 'high';
  data_coverage: number;
}

export async function fetchAwardCandidates(cardId: string): Promise<LoadState<AwardCandidate[]>> {
  const response = await supabase
    .from('award_candidate_snapshot')
    .select('award_key,season_id,snapshot_date,candidate_score,candidate_rank,confidence,data_coverage')
    .eq('card_id', cardId)
    .order('snapshot_date', { ascending: false })
    .limit(50);
  const state = fromPostgrest<AwardCandidate[]>(response, 'award_candidate_snapshot');
  if (state.status !== 'ok') return state;
  const latest = new Map<AwardKey, AwardCandidate>();
  for (const row of state.data) {
    if (!latest.has(row.award_key)) latest.set(row.award_key, row);
  }
  return {
    status: 'ok',
    data: [...latest.values()].sort((a, b) => a.candidate_rank - b.candidate_rank || a.award_key.localeCompare(b.award_key)),
  };
}
