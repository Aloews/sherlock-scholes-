import { VOICE_PROVIDER_IDS, type VoiceProviderId } from './providers';
import type { ProviderAttempts, VoiceStatus } from './useVoiceChat';
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
  | 'absent'        // not compiled into this build at all
  | 'standby'       // compiled in and available as a fallback; not in use
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
  /** What the service itself said when it refused. Vendor English, on purpose. */
  detail: string | null;
}

export interface ServiceStatusInput {
  /** The service in use, or last tried — not necessarily the build's default. */
  active: VoiceProviderId;
  /** Services whose adapters this build actually carries. */
  available: readonly VoiceProviderId[];
  misconfigured: boolean;
  status: VoiceStatus;
  reason: VoiceUnavailableReason | null;
  level: VoiceLevel;
  stats: LinkStats | null;
  audioBlocked: boolean;
  /** The provider's own words for the last failure, if it gave any. */
  detail?: string | null;
  /** How each service that got a turn answered, from the failover ladder. */
  tried?: ProviderAttempts;
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
  const tried = input.tried ?? {};

  return VOICE_PROVIDER_IDS.map((id) => {
    // No adapter for it in this build, so it is not a fallback and not a
    // fault: it is simply not here.
    if (!input.available.includes(id)) {
      return { id, state: 'absent' as const, reason: null, level: null, stats: null, detail: null };
    }

    if (id !== input.active) {
      // Compiled in, so the ladder could reach it. Whether it already did is
      // the difference between a spare and a service that has been ruled out.
      const attempt = tried[id];
      return attempt
        ? { id, state: 'failed' as const, reason: attempt.reason, level: null, stats: null, detail: attempt.detail }
        : { id, state: 'standby' as const, reason: null, level: null, stats: null, detail: null };
    }

    const state = activeState(input);
    const live = state === 'live' || state === 'blocked';
    return {
      id,
      state,
      reason: state === 'failed' ? input.reason : null,
      level: live ? input.level : null,
      stats: live ? input.stats : null,
      // Only ever alongside a failure: a quoted vendor string next to a
      // working connection reads as a warning about nothing.
      detail: state === 'failed' ? input.detail ?? null : null,
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

// ─── Reading the vendor's refusal ────────────────────────────────────
//
// The panels quote the service verbatim, deliberately: a paraphrase loses the
// one string that can be searched for. But `account-missing-payment-method`
// tells a player nothing, and it is the difference between "this app is
// broken" and "somebody has to add a card to the Daily account" — one of those
// is worth reporting as a bug and the other is not.
//
// So this adds a sentence ABOVE the quote rather than replacing it. Matching is
// on a substring because vendors wrap their own codes in prose, and each entry
// earns its place by having actually appeared: the payment one came off a
// screenshot from a real phone.
const DETAIL_HINTS: { match: RegExp; key: string }[] = [
  { match: /missing-payment-method|payment.method/i, key: 'voice.detail_no_payment_method' },
  { match: /invalid[-_ ]?token|token.*(expired|invalid)|CAN_NOT_GET_GATEWAY_SERVER/i,
    key: 'voice.detail_bad_token' },
  { match: /quota|exceeded|limit.reached|out of minutes/i, key: 'voice.detail_quota' },
  // Ours, not theirs: a config value the SDK rejects outright. Kept because
  // the Agora codec bug looked exactly like a service outage from the outside.
  { match: /INVALID_PARAMS|invalid.argument/i, key: 'voice.detail_bad_config' },
];

/**
 * A translation key explaining a vendor's refusal, or null when we have
 * nothing honest to add and the quote should stand alone.
 */
export function explainDetail(detail: string | null | undefined): string | null {
  if (!detail) return null;
  return DETAIL_HINTS.find((hint) => hint.match.test(detail))?.key ?? null;
}
