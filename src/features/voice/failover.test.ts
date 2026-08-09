import { describe, it, expect } from 'vitest';
import { isProviderFault, providerOrder, nextProvider } from './failover';

// Failover is a different question from retry, and answering them together is
// how a player ends up refusing the microphone three times to be told the same
// thing about a room they are not in.

describe('isProviderFault', () => {
  it.each([
    'sdk_failed', 'join_failed', 'join_timeout',
    'issue_failed', 'voice_not_configured', 'provider_mismatch',
    'malformed', 'bad_request',
  ] as const)('%s belongs to one service, so another may do better', (reason) => {
    expect(isProviderFault(reason)).toBe(true);
  });

  // These describe the room or the player. Every service would answer the same,
  // so walking the ladder only costs time.
  it.each([
    'not_in_room', 'no_such_room', 'room_finished', 'no_team_yet',
    'unauthorized', 'no_init_data', 'not_configured', 'lookup_failed',
  ] as const)('%s is nobody’s fault but ours, so the ladder stops', (reason) => {
    expect(isProviderFault(reason)).toBe(false);
  });

  // The one that reads like a vendor problem and is not: `network` means our
  // own Edge Function could not be reached, and it mints for all three.
  it('treats an unreachable token function as no reason to change service', () => {
    expect(isProviderFault('network')).toBe(false);
  });

  it('has nothing to blame when there is no reason at all', () => {
    expect(isProviderFault(null)).toBe(false);
  });
});

describe('providerOrder', () => {
  it('starts with the service the deployment chose', () => {
    expect(providerOrder('daily', ['livekit', 'daily', 'agora']))
      .toEqual(['daily', 'livekit', 'agora']);
  });

  it('keeps the rest in one canonical order, so the sequence is the same everywhere', () => {
    expect(providerOrder('agora', ['livekit', 'daily', 'agora']))
      .toEqual(['agora', 'livekit', 'daily']);
  });

  // A build without fallback carries one adapter. The ladder still exists; it
  // is one rung long, which is the behaviour that shipped before failover.
  it('is a single rung when only one adapter is compiled in', () => {
    expect(providerOrder('livekit', ['livekit'])).toEqual(['livekit']);
  });

  it('never offers a service whose SDK is not in the build', () => {
    expect(providerOrder('daily', ['livekit', 'agora'])).toEqual(['livekit', 'agora']);
  });

  it('is empty when the build carries nothing', () => {
    expect(providerOrder('livekit', [])).toEqual([]);
  });
});

describe('nextProvider', () => {
  const order = ['daily', 'livekit', 'agora'] as const;

  it('moves to the next service when the vendor is the one at fault', () => {
    expect(nextProvider(order, 'daily', 'join_failed')).toBe('livekit');
    expect(nextProvider(order, 'livekit', 'join_timeout')).toBe('agora');
  });

  it('stops at the end of the ladder rather than starting over', () => {
    expect(nextProvider(order, 'agora', 'join_failed')).toBeNull();
  });

  it('stops immediately on a verdict every service would repeat', () => {
    expect(nextProvider(order, 'daily', 'no_team_yet')).toBeNull();
    expect(nextProvider(order, 'daily', 'not_in_room')).toBeNull();
  });

  // A refused microphone arrives with no reason at all — the hook reports it
  // as `denied`, not as a failure. Nothing about it is the vendor's, and the
  // next service would prompt again.
  it('stops when there is no failure to blame on anyone', () => {
    expect(nextProvider(order, 'daily', null)).toBeNull();
  });

  it('stops when the service that failed is not on the ladder', () => {
    expect(nextProvider(['livekit', 'agora'], 'daily', 'join_failed')).toBeNull();
    expect(nextProvider(['livekit'], 'daily', 'join_failed')).toBeNull();
  });
});
