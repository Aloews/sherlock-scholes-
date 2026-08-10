// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The Agora adapter shipped with the same admission daily.ts carried — "not
// yet exercised against a live account" — and daily.ts is what that cost a
// week. Turning VITE_VOICE_FALLBACK on makes this file reachable in
// production, so it gets its tests BEFORE a player gets there, not after.
//
// Agora is the odd one of the three: the token is minted for an exact uid, the
// app id is separate from the token, and the SDK owns the audio elements — so
// the sink stays empty and a refused autoplay arrives on a global callback
// rather than on the session.

const agora = vi.hoisted(() => {
  const config = {
    joinError: null as Error | null,
    micError: null as Error | null,
    publishError: null as Error | null,
  };

  class FakeMic {
    enabled: boolean[] = [];
    closed = 0;
    async setEnabled(on: boolean) { this.enabled.push(on); }
    close() { this.closed += 1; }
  }

  class FakeClient {
    handlers = new Map<string, (...args: unknown[]) => void>();
    joined: { appId: string; channel: string; token: string | null; uid: unknown } | null = null;
    published: unknown[][] = [];
    subscribed: unknown[] = [];
    leaveCalls = 0;
    volumeIndicator = 0;
    stats: { RTT?: number } = {};

    on(event: string, cb: (...args: unknown[]) => void) { this.handlers.set(event, cb); }
    emit(event: string, ...args: unknown[]) { this.handlers.get(event)?.(...args); }

    async join(appId: string, channel: string, token: string | null, uid?: unknown) {
      if (config.joinError) throw config.joinError;
      this.joined = { appId, channel, token, uid };
      return uid as string;
    }
    async publish(tracks: unknown[]) {
      if (config.publishError) throw config.publishError;
      this.published.push(tracks);
    }
    async subscribe(user: unknown) { this.subscribed.push(user); }
    enableAudioVolumeIndicator() { this.volumeIndicator += 1; }
    getRTCStats() { return this.stats; }
    async leave() { this.leaveCalls += 1; }
  }

  const clients: FakeClient[] = [];
  const mics: FakeMic[] = [];

  const sdk = {
    onAudioAutoplayFailed: null as (() => void) | null,
    // Typed with the config the adapter really passes, so a test can assert
    // on it — the codec bug hid behind a mock that accepted anything.
    createClient: vi.fn((_config: { mode: string; codec: string }) => {
      const c = new FakeClient(); clients.push(c); return c;
    }),
    createMicrophoneAudioTrack: vi.fn(async () => {
      if (config.micError) throw config.micError;
      const m = new FakeMic();
      mics.push(m);
      return m;
    }),
  };

  return {
    config, clients, mics, sdk,
    reset() {
      config.joinError = null;
      config.micError = null;
      config.publishError = null;
      clients.length = 0;
      mics.length = 0;
      sdk.onAudioAutoplayFailed = null;
    },
  };
});

vi.mock('agora-rtc-sdk-ng', () => ({ default: agora.sdk }));

const { agoraTransport, AGORA_CODEC, AGORA_VIDEO_CODECS } = await import('./agora');

const client = () => agora.clients[agora.clients.length - 1];
const mic = () => agora.mics[agora.mics.length - 1];

let sink: HTMLElement;

function connectOptions(node: HTMLElement) {
  return {
    credentials: {
      provider: 'agora' as const,
      token: 'agora-token',
      channel: 'ss_room-1',
      appId: 'app-id-123',
      identity: '42',
    },
    sink: node,
    onSpeakers: vi.fn(),
    onPlaybackChanged: vi.fn(),
    onDisconnected: vi.fn(),
  };
}

beforeEach(() => {
  agora.reset();
  sink = document.createElement('div');
  document.body.appendChild(sink);
});

afterEach(() => {
  sink.remove();
  vi.restoreAllMocks();
});

describe('joining', () => {
  // The uid is part of what the token signs. Joining as anything else is
  // rejected by Agora, so this is a credential, not a hint.
  it('joins with the exact uid the token was minted for', async () => {
    await agoraTransport.connect(connectOptions(sink));
    expect(client().joined).toEqual({
      appId: 'app-id-123',
      channel: 'ss_room-1',
      token: 'agora-token',
      uid: '42',
    });
  });

  // The bug that made every one of the tests below meaningless in production.
  // `codec` is Agora's VIDEO codec; the adapter asked for 'opus', which is an
  // audio codec, and createClient threw INVALID_PARAMS before a single line of
  // this adapter ran. Every test here mocked createClient, so the suite was
  // green while Agora had never connected once on a real device.
  //
  // The rule that catches this class: where the value has to come from the
  // vendor's vocabulary rather than ours, pin the VALUE, not just the call.
  it('asks for a codec the SDK actually accepts', async () => {
    await agoraTransport.connect(connectOptions(sink));
    const config = vi.mocked(agora.sdk.createClient).mock.calls[0]?.[0];
    expect(AGORA_VIDEO_CODECS).toContain(config?.codec);
    expect(config?.mode).toBe('rtc');
  });

  // Belt and braces: the constant is the SDK's list, not a copy that drifted.
  // If Agora ever removes one, this is what has to be re-read from their docs.
  it('never offers an audio codec as the video codec', () => {
    expect(AGORA_VIDEO_CODECS).not.toContain('opus' as never);
    expect(AGORA_VIDEO_CODECS).toContain(AGORA_CODEC);
  });

  it('refuses to start without an app id, rather than joining nothing', async () => {
    const options = connectOptions(sink);
    options.credentials.appId = '';
    await expect(agoraTransport.connect(options)).rejects.toThrow(/app id/i);
    expect(agora.sdk.createClient).not.toHaveBeenCalled();
  });

  it('publishes the microphone once the channel is up', async () => {
    await agoraTransport.connect(connectOptions(sink));
    expect(client().published).toHaveLength(1);
    expect(client().published[0]).toEqual([mic()]);
  });

  it('propagates the service refusal instead of swallowing it', async () => {
    agora.config.joinError = new Error('CAN_NOT_GET_GATEWAY_SERVER: invalid token');
    await expect(agoraTransport.connect(connectOptions(sink)))
      .rejects.toThrow(/invalid token/);
  });
});

// The bug §3 already recorded once for LiveKit, in a second adapter: the
// microphone is asked for AFTER the channel is up, so a refusal arrives with a
// live connection behind it. useVoiceChat cannot clean that up — it only ever
// sees the session connect() returns, and connect() never returned.
describe('a failure after the channel is already up', () => {
  it('leaves the channel when the player refuses the microphone', async () => {
    agora.config.micError = new DOMException('denied', 'NotAllowedError');
    await expect(agoraTransport.connect(connectOptions(sink))).rejects.toThrow();
    expect(client().leaveCalls).toBe(1);
  });

  it('leaves the channel and closes the track when publishing fails', async () => {
    agora.config.publishError = new Error('publish rejected');
    await expect(agoraTransport.connect(connectOptions(sink))).rejects.toThrow(/publish/);
    expect(client().leaveCalls).toBe(1);
    expect(mic().closed).toBe(1);
  });

  // onAudioAutoplayFailed is a global on the SDK module, not a per-session
  // handler. Leaving a dead session's callback there means the next attempt's
  // blocked audio is reported to nobody.
  it('takes its global autoplay handler back down', async () => {
    agora.config.micError = new Error('no microphone');
    await expect(agoraTransport.connect(connectOptions(sink))).rejects.toThrow();
    expect(agora.sdk.onAudioAutoplayFailed).toBeNull();
  });

  it('does not report the teardown as a link that dropped', async () => {
    const options = connectOptions(sink);
    agora.config.micError = new Error('no microphone');
    await expect(agoraTransport.connect(options)).rejects.toThrow();
    client().emit('connection-state-change', 'DISCONNECTED');
    expect(options.onDisconnected).not.toHaveBeenCalled();
  });
});

describe('remote audio', () => {
  it('subscribes and plays what another player publishes', async () => {
    await agoraTransport.connect(connectOptions(sink));
    const track = { play: vi.fn(), stop: vi.fn() };
    await client().emit('user-published', { uid: 7, audioTrack: track }, 'audio');
    await Promise.resolve();
    expect(client().subscribed).toHaveLength(1);
    expect(track.play).toHaveBeenCalled();
  });

  it('ignores video, which this phase does not carry', async () => {
    await agoraTransport.connect(connectOptions(sink));
    const track = { play: vi.fn(), stop: vi.fn() };
    await client().emit('user-published', { uid: 7, audioTrack: track }, 'video');
    await Promise.resolve();
    expect(client().subscribed).toHaveLength(0);
    expect(track.play).not.toHaveBeenCalled();
  });

  it('stops the track when the player unpublishes', async () => {
    await agoraTransport.connect(connectOptions(sink));
    const track = { play: vi.fn(), stop: vi.fn() };
    client().emit('user-unpublished', { uid: 7, audioTrack: track }, 'audio');
    expect(track.stop).toHaveBeenCalled();
  });

  // Agora owns its elements, so unlike the other two there is nothing for the
  // adapter to put in the sink. An element appearing here would mean two
  // things were playing the same audio.
  it('leaves the sink empty, because the SDK owns the elements', async () => {
    await agoraTransport.connect(connectOptions(sink));
    const track = { play: vi.fn(), stop: vi.fn() };
    await client().emit('user-published', { uid: 7, audioTrack: track }, 'audio');
    await Promise.resolve();
    expect(sink.children).toHaveLength(0);
  });
});

describe('speakers', () => {
  it('reports only who is actually loud, not everyone with a level', async () => {
    const options = connectOptions(sink);
    await agoraTransport.connect(options);
    client().emit('volume-indicator', [
      { uid: 7, level: 60 },
      { uid: 8, level: 0 },
      { uid: 9, level: 3 },
    ]);
    expect(options.onSpeakers).toHaveBeenLastCalledWith(['7']);
  });

  it('reports silence as an empty set', async () => {
    const options = connectOptions(sink);
    await agoraTransport.connect(options);
    client().emit('volume-indicator', [{ uid: 7, level: 1 }]);
    expect(options.onSpeakers).toHaveBeenLastCalledWith([]);
  });

  it('turns the volume indicator on, or nobody is ever reported', async () => {
    await agoraTransport.connect(connectOptions(sink));
    expect(client().volumeIndicator).toBe(1);
  });
});

describe('the session', () => {
  it('opens and closes the microphone', async () => {
    const session = await agoraTransport.connect(connectOptions(sink));
    await session.setMicrophoneEnabled(false);
    await session.setMicrophoneEnabled(true);
    expect(mic().enabled).toEqual([false, true]);
  });

  it('leaves and closes the track on disconnect', async () => {
    const session = await agoraTransport.connect(connectOptions(sink));
    await session.disconnect();
    expect(client().leaveCalls).toBe(1);
    expect(mic().closed).toBe(1);
    expect(agora.sdk.onAudioAutoplayFailed).toBeNull();
  });

  it('does not report a local disconnect as the link dropping', async () => {
    const options = connectOptions(sink);
    const session = await agoraTransport.connect(options);
    await session.disconnect();
    client().emit('connection-state-change', 'DISCONNECTED');
    expect(options.onDisconnected).not.toHaveBeenCalled();
  });

  it('does report a drop that nobody asked for', async () => {
    const options = connectOptions(sink);
    await agoraTransport.connect(options);
    client().emit('connection-state-change', 'DISCONNECTED');
    expect(options.onDisconnected).toHaveBeenCalled();
  });

  it('ignores the states that are not a drop', async () => {
    const options = connectOptions(sink);
    await agoraTransport.connect(options);
    client().emit('connection-state-change', 'RECONNECTING');
    client().emit('connection-state-change', 'CONNECTED');
    expect(options.onDisconnected).not.toHaveBeenCalled();
  });
});

describe('blocked playback', () => {
  it('reports a refused autoplay, which is the only way it is visible here', async () => {
    const options = connectOptions(sink);
    const session = await agoraTransport.connect(options);
    agora.sdk.onAudioAutoplayFailed?.();
    expect(options.onPlaybackChanged).toHaveBeenLastCalledWith(false);
    expect(session.canPlaybackAudio()).toBe(false);
  });

  it('clears the warning once the player has answered it', async () => {
    const options = connectOptions(sink);
    const session = await agoraTransport.connect(options);
    agora.sdk.onAudioAutoplayFailed?.();
    await session.startAudio();
    expect(session.canPlaybackAudio()).toBe(true);
    expect(options.onPlaybackChanged).toHaveBeenLastCalledWith(true);
  });
});

describe('link quality', () => {
  it('reads round-trip time from the shape Agora returns', async () => {
    const session = await agoraTransport.connect(connectOptions(sink));
    client().stats = { RTT: 130 };
    await expect(session.linkStats()).resolves.toEqual({ rttMs: 130, loss: 0 });
  });

  // Agora's client stats carry latency but no publisher loss ratio. Zero is
  // honest; a guessed figure would move the quality ladder on nothing.
  it('reports no loss rather than inventing one', async () => {
    const session = await agoraTransport.connect(connectOptions(sink));
    client().stats = { RTT: 0 };
    await expect(session.linkStats()).resolves.toEqual({ rttMs: 0, loss: 0 });
  });

  it('says nothing when the measurement is missing or unusable', async () => {
    const session = await agoraTransport.connect(connectOptions(sink));
    for (const stats of [{}, { RTT: NaN }]) {
      client().stats = stats;
      await expect(session.linkStats()).resolves.toBeNull();
    }
  });

  it('survives an SDK that throws instead of answering', async () => {
    const session = await agoraTransport.connect(connectOptions(sink));
    client().getRTCStats = () => { throw new Error('gone'); };
    await expect(session.linkStats()).resolves.toBeNull();
  });
});
