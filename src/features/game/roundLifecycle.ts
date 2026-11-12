export type AliasRoundOutcome = 'next_round' | 'game_end' | 'already_ended';

export interface AliasRoundEndResult {
  outcome: AliasRoundOutcome;
  next_round_id: string | null;
}

export interface AliasRoundPauseState {
  paused_at: string | null;
  paused_ms: number;
}

type RoundAction = 'activate' | 'end' | 'pause' | 'resume';

async function postRoundAction<T>(
  roundId: string,
  action: RoundAction,
  initData: string | null,
): Promise<T> {
  if (!roundId || roundId.length > 64) throw new Error('INVALID_ROUND_ID');
  if (!initData) throw new Error('TELEGRAM_AUTH_REQUIRED');

  const response = await fetch(
    `/api/v1/alias/rounds/${encodeURIComponent(roundId)}/${action}`,
    {
      method: 'POST',
      headers: action === 'activate'
        ? { 'x-tg-init-data': initData, 'content-type': 'application/json' }
        : { 'x-tg-init-data': initData },
      ...(action === 'activate' ? { body: '{}' } : {}),
    },
  );

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(
      typeof payload?.error === 'string' ? payload.error : 'ALIAS_ROUND_ACTION_FAILED',
    );
  }
  return response.json() as Promise<T>;
}

export async function endAliasRound(
  roundId: string,
  initData: string | null,
): Promise<AliasRoundEndResult> {
  const payload = await postRoundAction<unknown>(roundId, 'end', initData);
  if (!payload || typeof payload !== 'object') throw new Error('INVALID_ALIAS_ROUND_END_RESPONSE');
  const result = payload as Record<string, unknown>;
  if (
    !['next_round', 'game_end', 'already_ended'].includes(String(result.outcome))
    || (
      result.outcome === 'next_round'
        ? typeof result.next_round_id !== 'string' || result.next_round_id.length === 0
        : result.next_round_id !== null
    )
  ) {
    throw new Error('INVALID_ALIAS_ROUND_END_RESPONSE');
  }
  return result as unknown as AliasRoundEndResult;
}

export async function setAliasRoundVoiceState(
  roundId: string,
  action: 'pause' | 'resume',
  initData: string | null,
): Promise<AliasRoundPauseState> {
  const payload = await postRoundAction<unknown>(roundId, action, initData);
  if (!payload || typeof payload !== 'object') throw new Error('INVALID_ALIAS_ROUND_PAUSE_RESPONSE');
  const state = payload as Record<string, unknown>;
  if (
    !(state.paused_at === null || typeof state.paused_at === 'string')
    || !Number.isSafeInteger(state.paused_ms)
    || (state.paused_ms as number) < 0
    || (state.paused_ms as number) > 120_000
  ) {
    throw new Error('INVALID_ALIAS_ROUND_PAUSE_RESPONSE');
  }
  return state as unknown as AliasRoundPauseState;
}
export interface AliasRoundActivationResult {
  outcome: 'activated' | 'already_active';
  card_count: number;
}

export async function activateAliasRound(
  roundId: string,
  initData: string | null,
): Promise<AliasRoundActivationResult> {
  const payload = await postRoundAction<unknown>(roundId, 'activate', initData);
  if (!payload || typeof payload !== 'object') {
    throw new Error('INVALID_ALIAS_ROUND_ACTIVATION_RESPONSE');
  }
  const result = payload as Record<string, unknown>;
  if (
    !['activated', 'already_active'].includes(String(result.outcome))
    || !Number.isSafeInteger(result.card_count)
    || (result.card_count as number) < 0
    || (result.card_count as number) > 100
  ) {
    throw new Error('INVALID_ALIAS_ROUND_ACTIVATION_RESPONSE');
  }
  return result as unknown as AliasRoundActivationResult;
}
