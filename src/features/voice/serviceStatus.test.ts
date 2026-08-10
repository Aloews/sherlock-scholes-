import { describe, it, expect } from 'vitest';
import { serviceRows, formatStats, explainDetail, type ServiceStatusInput } from './serviceStatus';

// The panel exists because "voice is broken" and "voice is not in this build"
// looked identical for two sessions. These tests hold the distinction.

const base: ServiceStatusInput = {
  active: 'livekit',
  // A build without VITE_VOICE_FALLBACK: one adapter, no ladder to walk.
  available: ['livekit'],
  misconfigured: false,
  status: 'off',
  reason: null,
  level: 'voice',
  stats: null,
  audioBlocked: false,
};

const rowFor = (input: Partial<ServiceStatusInput>, id = 'livekit') =>
  serviceRows({ ...base, ...input }).find((r) => r.id === id)!;

describe('serviceRows', () => {
  it('reports all three services in a stable order', () => {
    expect(serviceRows(base).map((r) => r.id)).toEqual(['livekit', 'daily', 'agora']);
  });

  it('marks the services this build does not carry as absent, not failed', () => {
    const rows = serviceRows(base);
    expect(rows.filter((r) => r.state === 'absent').map((r) => r.id)).toEqual(['daily', 'agora']);
  });

  it('follows the active provider', () => {
    const rows = serviceRows({ ...base, active: 'agora', available: ['agora'] });
    expect(rows.find((r) => r.id === 'agora')!.state).toBe('off');
    expect(rows.find((r) => r.id === 'livekit')!.state).toBe('absent');
  });

  it.each([
    ['off', 'off'],
    ['connecting', 'connecting'],
    ['on', 'live'],
    ['denied', 'denied'],
    ['unavailable', 'failed'],
  ] as const)('maps session status %s to %s', (status, expected) => {
    expect(rowFor({ status }).state).toBe(expected);
  });

  // Connected but silent is its own state: the cure is a tap, not a reconnect.
  it('separates a link that is up but inaudible from a link that is live', () => {
    expect(rowFor({ status: 'on', audioBlocked: true }).state).toBe('blocked');
    expect(rowFor({ status: 'on', audioBlocked: false }).state).toBe('live');
  });

  it('carries the refusal reason only when the attempt actually failed', () => {
    expect(rowFor({ status: 'unavailable', reason: 'no_team_yet' }).reason).toBe('no_team_yet');
    expect(rowFor({ status: 'on', reason: 'no_team_yet' }).reason).toBeNull();
  });

  it('shows a misconfigured build as such, whatever the session says', () => {
    expect(rowFor({ misconfigured: true, status: 'on' }).state).toBe('misconfigured');
  });

  it('reports quality only for a service that is actually carrying audio', () => {
    const stats = { rttMs: 120, loss: 0.01 };
    expect(rowFor({ status: 'on', level: 'full', stats })).toMatchObject({ level: 'full', stats });
    expect(rowFor({ status: 'connecting', level: 'full', stats })).toMatchObject({
      level: null, stats: null,
    });
  });

  it('never attaches quality to a service that is not in the build', () => {
    const rows = serviceRows({ ...base, status: 'on', stats: { rttMs: 90, loss: 0 } });
    for (const row of rows.filter((r) => r.id !== 'livekit')) {
      expect(row).toMatchObject({ state: 'absent', level: null, stats: null, reason: null });
    }
  });
});

describe('formatStats', () => {
  it('rounds to whole milliseconds and whole percent', () => {
    expect(formatStats({ rttMs: 123.7, loss: 0.0349 })).toEqual({ rtt: 124, lossPercent: 3 });
  });

  it('keeps a perfect link at zero rather than hiding it', () => {
    expect(formatStats({ rttMs: 0, loss: 0 })).toEqual({ rtt: 0, lossPercent: 0 });
  });
});

// ─── explainDetail ───────────────────────────────────────────────────
//
// Every string here is one a service actually sent. The Daily one arrived on a
// screenshot from a real phone, next to a working LiveKit — which is exactly
// the situation the hint exists for: two of three services down looks like a
// broken app, and one of the two was a missing card on an account.

describe('explainDetail', () => {
  it('reads Daily refusing an account with no card on file', () => {
    expect(explainDetail('account-missing-payment-method'))
      .toBe('voice.detail_no_payment_method');
  });

  it('reads a rejected token, however the vendor words it', () => {
    expect(explainDetail('CAN_NOT_GET_GATEWAY_SERVER: invalid token'))
      .toBe('voice.detail_bad_token');
    expect(explainDetail('the token has expired')).toBe('voice.detail_bad_token');
  });

  it('reads an exhausted allowance', () => {
    expect(explainDetail('quota exceeded for this project'))
      .toBe('voice.detail_quota');
  });

  // The bug that prompted all of this: it looked like a service outage and was
  // a value of ours the SDK would not accept.
  it('reads a config the SDK rejects as ours, not theirs', () => {
    expect(explainDetail(
      'AgoraRTCError INVALID_PARAMS: config.codec can only be set as ["vp8","vp9"]',
    )).toBe('voice.detail_bad_config');
  });

  // Silence beats a guess: an unrecognised message is shown verbatim by the
  // panels, and inventing a meaning for it would be worse than saying nothing.
  it('says nothing about a message it does not recognise', () => {
    expect(explainDetail('something new and unhelpful')).toBeNull();
    expect(explainDetail('')).toBeNull();
    expect(explainDetail(null)).toBeNull();
    expect(explainDetail(undefined)).toBeNull();
  });
});
