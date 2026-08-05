import { VOICE_PROVIDER_IDS, type VoiceProviderId } from './providers';
import type { VoiceStatus } from './useVoiceChat';
import type { VoiceUnavailableReason } from './voiceApi';
import type { LinkStats, VoiceLevel } from './voiceQuality';

/**
 * What the diagnostics panel says about one service.
 *
 * `absent` is not a failure and must not read like one: a build ships exactly
 * one adapter on purpose (providers/index.ts drops the other two SDKs), so
 * "not in this build" is the correct and expected state for two of the three.
 * Painting them red would send someone looking for a bug that is a design
 * decision.
 */
export type ServiceState =
  | 'absent'        // not the provider this build was compiled with
  | 'misconfigured' // VITE_VOICE_PROVIDER names something nobody implements
  | 'off'           // this build's service, nobody has connected yet
  | 'connecting'
  | 'live'
  | 'blocked'       // connected, but the browser will not play the audio
  | 'denied'        // the player refused the microphone
  | 'failed';       // asked and refused, or never reached — `reason` says which

export interface ServiceRow {
  id: VoiceProviderId;
  state: ServiceState;
  /** Present only when the state is `failed`. */
  reason: VoiceUnavailableReason | null;
  /** Link quality for a live service. */
  level: VoiceLevel | null;
  /** The last raw measurement, for a live service that has been measured. */
  stats: LinkStats | null;
}

export interface ServiceStatusInput {
  active: VoiceProviderId;
  misconfigured: boolean;
  status: VoiceStatus;
  reason: VoiceUnavailableReason | null;
  level: VoiceLevel;
  stats: LinkStats | null;
  audioBlocked: boolean;
}

/** The active service's state, given everything the session knows. */
function activeState(input: ServiceStatusInput): ServiceState {
  if (input.misconfigured) return 'misconfigured';
  switch (input.status) {
    case 'off':         return 'off';
    case 'connecting':  return 'connecting';
    // Audible is the point. A link that is up while the browser refuses to
    // play it is its own state, because the fix is a tap and not a reconnect.
    case 'on':          return input.audioBlocked ? 'blocked' : 'live';
    case 'denied':      return 'denied';
    case 'unavailable': return 'failed';
  }
}

/**
 * One row per service the app knows how to talk to, in a stable order.
 *
 * Deliberately reports all three rather than only the active one: "voice does
 * not work" and "voice is not built into this deployment" produced the same
 * screen for two sessions (docs/LOBBY_AND_VOICE_FIXES.md §3), and the cheapest
 * cure is a panel that names which service this build even has.
 */
export function serviceRows(input: ServiceStatusInput): ServiceRow[] {
  return VOICE_PROVIDER_IDS.map((id) => {
    if (id !== input.active) {
      return { id, state: 'absent' as const, reason: null, level: null, stats: null };
    }
    const state = activeState(input);
    const live = state === 'live' || state === 'blocked';
    return {
      id,
      state,
      reason: state === 'failed' ? input.reason : null,
      level: live ? input.level : null,
      stats: live ? input.stats : null,
    };
  });
}

/** Round-trip in whole milliseconds and loss as a whole percent, for display. */
export function formatStats(stats: LinkStats): { rtt: number; lossPercent: number } {
  return {
    rtt: Math.round(stats.rttMs),
    lossPercent: Math.round(stats.loss * 100),
  };
}
