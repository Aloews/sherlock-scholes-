// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The Daily adapter shipped with a comment admitting it had never been run
// against a live account, and production proved the comment right: the token
// was issued, the join was not, and the screen said "нет связи с сервером" for
// a week while the server answered 200.
//
// These tests are the exercise that comment was waiting for. They are written
// at the adapter level because this is the Daily-shaped half — the room is a
// URL rather than an address plus a channel, tracks arrive as raw
// MediaStreamTracks, and loss is reported in a shape nothing else uses.

const daily = vi.hoisted(() => {
  const config = { joinError: null as Error | null, joinHangs: false };

  class FakeCall {
    handlers = new Map<string, ((ev: unknown) => void)[]>();
    joined: { url: string; token?: string } | null = null;
    localAudio: boolean[] = [];
    leaveCalls = 0;
    destroyCalls = 0;
    stats: unknown = {};

    on(event: string, cb: (ev: unknown) => void) {
      const list = this.handlers.get(event) ?? [];
      list.push(cb);
      this.handlers.set(event, list);
      return this;
    }

    emit(event: string, ev: unknown) {
      for (const cb of this.handlers.get(event) ?? []) cb(ev);
    }

    async join(opts: { url: string; token?: string }) {
      if (config.joinError) throw config.joinError;
      if (config.joinHangs) return new Promise(() => {});
      this.joined = opts;
      return {};
    }

    setLocalAudio(on: boolean) { this.localAudio.push(on); }
    async getNetworkStats() { return this.stats; }
    async leave() { this.leaveCalls += 1; return {}; }
    async destroy() { this.destroyCalls += 1; return {}; }
  }

  const calls: FakeCall[] = [];
  // Daily's real singleton: createCallObject throws while an instance is
  // alive, and only destroy() releases it. Reproducing that here is the whole
  // point — an SDK mock that allows two would have let the production bug pass.
  let live: FakeCall | null = null;

  class SingletonCall extends FakeCall {
    override async destroy() { live = null; return super.destroy(); }
  }

  return {
    config,
    calls,
    getCallInstance: vi.fn(() => live),
    createCallObject: vi.fn(() => {
      if (live) throw new Error('Duplicate DailyIframe instances are not allowed');
      const c = new SingletonCall();
      live = c;
      calls.push(c);
      return c;
    }),
    /** Strands an instance, as a failed attempt used to. */
    strand() { live = new SingletonCall(); return live; },
    reset() {
      config.joinError = null;
      config.joinHangs = false;
      calls.length = 0;
      live = null;
    },
  };
});

vi.mock('@daily-co/daily-js', () => ({
  default: {
    createCallObject: daily.createCallObject,
    getCallInstance: daily.getCallInstance,
  },
}));

const { dailyTransport } = await import('./daily');

const audioTrack = () => ({ kind: 'audio' }) as unknown as MediaStreamTrack;

function connectOptions(sink: HTMLElement) {
  return {
    credentials: {
      provider: 'daily' as const,
      token: 'meeting-token',
      channel: 'ss12345',
      url: 'https://team.daily.co/ss12345',
    },
    sink,
    onSpeakers: vi.fn(),
    onPlaybackChanged: vi.fn(),
    onDisconnected: vi.fn(),
  };
}

let sink: HTMLElement;

beforeEach(() => {
  daily.reset();
  sink = document.createElement('div');
  document.body.appendChild(sink);
  // jsdom has neither MediaStream nor real playback. The sink only needs the
  // constructor to exist — same stub audioSink.test.ts uses.
  vi.stubGlobal('MediaStream', class { constructor(public tracks: unknown[]) {} });
  HTMLMediaElement.prototype.play = vi.fn(async () => {});
});

afterEach(() => {
  sink.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('joining', () => {
  it('joins the room URL the server minted, with the meeting token', async () => {
    await dailyTransport.connect(connectOptions(sink));
    expect(daily.calls[0].joined).toEqual({
      url: 'https://team.daily.co/ss12345',
      token: 'meeting-token',
    });
  });

  // Daily's unit is a room URL. Without it there is nothing to join, and
  // failing here is far better than joining "undefined" and timing out.
  it('refuses to start when the server sent no room URL', async () => {
    const options = connectOptions(sink);
    options.credentials.url = '';
    await expect(dailyTransport.connect(options)).rejects.toThrow(/room URL/i);
    expect(daily.createCallObject).not.toHaveBeenCalled();
  });

  it('asks for audio only — a token that allows video does not make it wanted', async () => {
    await dailyTransport.connect(connectOptions(sink));
    expect(daily.createCallObject).toHaveBeenCalledWith(
      expect.objectContaining({ audioSource: true, videoSource: false }),
    );
  });

  // The production failure: the join is refused and the reason has to survive
  // as far as the caller, which is what turns "нет связи" into a sentence.
  it('propagates the service refusal instead of swallowing it', async () => {
    daily.config.joinError = new Error('rejected: room not found');
    await expect(dailyTransport.connect(connectOptions(sink)))
      .rejects.toThrow(/room not found/);
  });
});

// The production bug, and the reason this file exists at all. Daily refuses a
// second call object at CREATION, so an instance stranded by a failed attempt
// does not break that attempt — it breaks every attempt after it, and the
// duplicate error is the only thing anybody ever gets to see. The first
// failure, the one worth reading, is gone.
describe('the one call object Daily allows', () => {
  it('destroys the call object when the join is refused', async () => {
    daily.config.joinError = new Error('rejected: room not found');
    await expect(dailyTransport.connect(connectOptions(sink))).rejects.toThrow();
    expect(daily.calls[0].destroyCalls).toBe(1);
  });

  // Without the teardown above this is the test that fails, and it fails with
  // "Duplicate DailyIframe instances are not allowed" — the exact string the
  // diagnostics panel showed on the device.
  it('lets the next attempt through after a refused join', async () => {
    daily.config.joinError = new Error('rejected: room not found');
    await expect(dailyTransport.connect(connectOptions(sink)))
      .rejects.toThrow(/room not found/);

    daily.config.joinError = null;
    const session = await dailyTransport.connect(connectOptions(sink));

    expect(daily.calls).toHaveLength(2);
    expect(daily.calls[1].joined).toEqual({
      url: 'https://team.daily.co/ss12345',
      token: 'meeting-token',
    });
    await session.disconnect();
  });

  it('reports the service’s own refusal, not the duplicate that follows it', async () => {
    daily.config.joinError = new Error('rejected: room not found');
    await expect(dailyTransport.connect(connectOptions(sink)))
      .rejects.toThrow(/room not found/);
    await expect(dailyTransport.connect(connectOptions(sink)))
      .rejects.toThrow(/room not found/);
  });

  // Belt and braces: an instance stranded by something this adapter did not do
  // — an older build, a hot reload — must not cost the player their voice
  // channel until they restart the app.
  it('sweeps an instance nothing owns before creating its own', async () => {
    const stranded = daily.strand();
    await dailyTransport.connect(connectOptions(sink));
    expect(stranded.destroyCalls).toBe(1);
    expect(daily.calls[0].joined).toBeTruthy();
  });

  it('connects anyway when the SDK will not say whether an instance exists', async () => {
    daily.getCallInstance.mockImplementationOnce(() => { throw new Error('not supported'); });
    const session = await dailyTransport.connect(connectOptions(sink));
    expect(daily.calls[0].joined).toBeTruthy();
    await session.disconnect();
  });
});

describe('remote audio', () => {
  it('plays a remote track by putting an element in the sink', async () => {
    await dailyTransport.connect(connectOptions(sink));
    daily.calls[0].emit('track-started', {
      track: audioTrack(),
      participant: { local: false, session_id: 'p2' },
    });
    expect(sink.querySelectorAll('audio')).toHaveLength(1);
  });

  // Hearing yourself is the classic echo bug, and Daily reports the local
  // track through the same event.
  it('ignores the local track', async () => {
    await dailyTransport.connect(connectOptions(sink));
    daily.calls[0].emit('track-started', {
      track: audioTrack(),
      participant: { local: true, session_id: 'me' },
    });
    expect(sink.querySelectorAll('audio')).toHaveLength(0);
  });

  it('ignores video, which this phase does not carry', async () => {
    await dailyTransport.connect(connectOptions(sink));
    daily.calls[0].emit('track-started', {
      track: { kind: 'video' } as unknown as MediaStreamTrack,
      participant: { local: false, session_id: 'p2' },
    });
    expect(sink.querySelectorAll('audio')).toHaveLength(0);
  });

  it('takes the element away when the track stops', async () => {
    await dailyTransport.connect(connectOptions(sink));
    const call = daily.calls[0];
    call.emit('track-started', { track: audioTrack(), participant: { session_id: 'p2' } });
    call.emit('track-stopped', { track: audioTrack(), participant: { session_id: 'p2' } });
    expect(sink.querySelectorAll('audio')).toHaveLength(0);
  });

  it('takes it away when the participant leaves without stopping the track', async () => {
    await dailyTransport.connect(connectOptions(sink));
    const call = daily.calls[0];
    call.emit('track-started', { track: audioTrack(), participant: { session_id: 'p2' } });
    call.emit('participant-left', { participant: { session_id: 'p2' } });
    expect(sink.querySelectorAll('audio')).toHaveLength(0);
  });

  it('keeps one element per participant rather than stacking them', async () => {
    await dailyTransport.connect(connectOptions(sink));
    const call = daily.calls[0];
    call.emit('track-started', { track: audioTrack(), participant: { session_id: 'p2' } });
    call.emit('track-started', { track: audioTrack(), participant: { session_id: 'p2' } });
    expect(sink.querySelectorAll('audio')).toHaveLength(1);
  });
});

describe('speakers', () => {
  it('reports the active speaker as a set, which is what the UI wants', async () => {
    const options = connectOptions(sink);
    await dailyTransport.connect(options);
    daily.calls[0].emit('active-speaker-change', { activeSpeaker: { peerId: 'p2' } });
    expect(options.onSpeakers).toHaveBeenLastCalledWith(['p2']);
  });

  it('reports silence as an empty set, not as nobody having spoken', async () => {
    const options = connectOptions(sink);
    await dailyTransport.connect(options);
    daily.calls[0].emit('active-speaker-change', {});
    expect(options.onSpeakers).toHaveBeenLastCalledWith([]);
  });
});

describe('the session', () => {
  it('opens and closes the microphone', async () => {
    const session = await dailyTransport.connect(connectOptions(sink));
    await session.setMicrophoneEnabled(false);
    await session.setMicrophoneEnabled(true);
    expect(daily.calls[0].localAudio).toEqual([false, true]);
  });

  it('leaves, destroys and empties the sink on disconnect', async () => {
    const session = await dailyTransport.connect(connectOptions(sink));
    const call = daily.calls[0];
    call.emit('track-started', { track: audioTrack(), participant: { session_id: 'p2' } });

    await session.disconnect();

    expect(call.leaveCalls).toBe(1);
    expect(call.destroyCalls).toBe(1);
    expect(sink.querySelectorAll('audio')).toHaveLength(0);
  });

  // Tearing down fires Daily's own left-meeting; treating that as a drop would
  // make every clean exit look like a failure to the hook above.
  it('does not report a local disconnect as the link dropping', async () => {
    const options = connectOptions(sink);
    const session = await dailyTransport.connect(options);
    await session.disconnect();
    daily.calls[0].emit('left-meeting', {});
    expect(options.onDisconnected).not.toHaveBeenCalled();
  });

  it('does report a drop that nobody asked for', async () => {
    const options = connectOptions(sink);
    await dailyTransport.connect(options);
    daily.calls[0].emit('left-meeting', {});
    expect(options.onDisconnected).toHaveBeenCalled();
  });
});

describe('link quality', () => {
  it('reads packet loss from the shape Daily actually returns', async () => {
    const session = await dailyTransport.connect(connectOptions(sink));
    daily.calls[0].stats = { stats: { latest: { totalRecvPacketLoss: 0.12 } } };
    await expect(session.linkStats()).resolves.toEqual({ rttMs: 0, loss: 0.12 });
  });

  it('accepts the older shape too', async () => {
    const session = await dailyTransport.connect(connectOptions(sink));
    daily.calls[0].stats = { latest: { recvPacketLoss: 0.4 } };
    await expect(session.linkStats()).resolves.toEqual({ rttMs: 0, loss: 0.4 });
  });

  // Reporting a made-up latency would move the quality ladder on a number
  // nobody measured. Daily gives loss; the ladder drops on loss alone.
  it('reports no round-trip time rather than inventing one', async () => {
    const session = await dailyTransport.connect(connectOptions(sink));
    daily.calls[0].stats = { stats: { latest: { totalRecvPacketLoss: 0 } } };
    await expect(session.linkStats()).resolves.toEqual({ rttMs: 0, loss: 0 });
  });

  it('says nothing when the measurement is missing or unusable', async () => {
    const session = await dailyTransport.connect(connectOptions(sink));
    for (const stats of [{}, { stats: {} }, { latest: { recvPacketLoss: NaN } }]) {
      daily.calls[0].stats = stats;
      await expect(session.linkStats()).resolves.toBeNull();
    }
  });

  it('survives an SDK that throws instead of answering', async () => {
    const session = await dailyTransport.connect(connectOptions(sink));
    daily.calls[0].getNetworkStats = async () => { throw new Error('gone'); };
    await expect(session.linkStats()).resolves.toBeNull();
  });

  it('clamps a nonsense figure into the range the ladder expects', async () => {
    const session = await dailyTransport.connect(connectOptions(sink));
    daily.calls[0].stats = { stats: { latest: { totalRecvPacketLoss: 7 } } };
    await expect(session.linkStats()).resolves.toEqual({ rttMs: 0, loss: 1 });
  });
});
