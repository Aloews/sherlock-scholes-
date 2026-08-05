import { describe, it, expect } from 'vitest';
import { serviceRows, formatStats, type ServiceStatusInput } from './serviceStatus';

// The panel exists because "voice is broken" and "voice is not in this build"
// looked identical for two sessions. These tests hold the distinction.

const base: ServiceStatusInput = {
  active: 'livekit',
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
    const rows = serviceRows({ ...base, active: 'agora' });
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
