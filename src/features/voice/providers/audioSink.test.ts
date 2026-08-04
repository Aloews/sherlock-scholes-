// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AudioSink } from './audioSink';

// The half of "connected but nothing is audible" that is not LiveKit's.
//
// Daily hands over a raw MediaStreamTrack; Agora plays its own. For everyone
// in the first group this class IS the playback, and the thing it must not do
// is what the original bug did — create an element, never notice that play()
// was refused, and leave the channel silently connected.

const changed = vi.fn();
let host: HTMLElement;
let play: ReturnType<typeof vi.fn>;

/** jsdom has no media stack: play() must be supplied before anything calls it. */
function playbackAllowed(allowed: boolean) {
  play.mockImplementation(() => (allowed ? Promise.resolve() : Promise.reject(new Error('NotAllowedError'))));
}

const fakeTrack = () => ({ kind: 'audio' }) as unknown as MediaStreamTrack;
const elements = () => host.querySelectorAll('audio');

beforeEach(() => {
  changed.mockReset();
  host = document.createElement('div');
  document.body.appendChild(host);
  play = vi.fn();
  HTMLMediaElement.prototype.play = play as unknown as HTMLMediaElement['play'];
  // jsdom cannot build a MediaStream from a fake track; the sink only needs
  // the element to exist and be asked to play.
  vi.stubGlobal('MediaStream', class { constructor(public tracks: unknown[]) {} });
  playbackAllowed(true);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('attaching remote audio', () => {
  it('puts an element in the host and asks it to play', async () => {
    const sink = new AudioSink(host, changed);
    sink.add('peer-1', fakeTrack());
    expect(elements()).toHaveLength(1);
    expect(play).toHaveBeenCalledTimes(1);
    expect(host.contains(elements()[0])).toBe(true);
  });

  it('gives every peer their own element', () => {
    const sink = new AudioSink(host, changed);
    sink.add('peer-1', fakeTrack());
    sink.add('peer-2', fakeTrack());
    expect(elements()).toHaveLength(2);
  });

  it('replaces rather than stacks when a peer republishes', () => {
    // Muting and unmuting republishes the track. Two elements on one peer
    // means the same voice twice, slightly out of step.
    const sink = new AudioSink(host, changed);
    sink.add('peer-1', fakeTrack());
    sink.add('peer-1', fakeTrack());
    expect(elements()).toHaveLength(1);
  });

  it('takes an element away by key, and all of them on clear', () => {
    const sink = new AudioSink(host, changed);
    sink.add('peer-1', fakeTrack());
    sink.add('peer-2', fakeTrack());
    sink.remove('peer-1');
    expect(elements()).toHaveLength(1);
    sink.clear();
    expect(elements()).toHaveLength(0);
  });

  it('ignores a removal for a peer it never had', () => {
    const sink = new AudioSink(host, changed);
    expect(() => sink.remove('nobody')).not.toThrow();
  });
});

describe('a refused autoplay', () => {
  it('is reported instead of vanishing into an unhandled rejection', async () => {
    playbackAllowed(false);
    const sink = new AudioSink(host, changed);
    sink.add('peer-1', fakeTrack());
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(false));
    expect(sink.canPlay()).toBe(false);
  });

  it('survives a play() that throws instead of rejecting', async () => {
    // Some WebViews do this. An exception here would take down the track
    // handler and lose every later track with it.
    play.mockImplementation(() => { throw new Error('sync boom'); });
    const sink = new AudioSink(host, changed);
    expect(() => sink.add('peer-1', fakeTrack())).not.toThrow();
    await vi.waitFor(() => expect(sink.canPlay()).toBe(false));
  });

  it('survives a play() that returns nothing at all', async () => {
    play.mockImplementation(() => undefined);
    const sink = new AudioSink(host, changed);
    sink.add('peer-1', fakeTrack());
    await vi.waitFor(() => expect(sink.canPlay()).toBe(true));
  });

  it('clears once a tap gets the elements going', async () => {
    playbackAllowed(false);
    const sink = new AudioSink(host, changed);
    sink.add('peer-1', fakeTrack());
    await vi.waitFor(() => expect(sink.canPlay()).toBe(false));

    playbackAllowed(true);
    await sink.start();
    expect(sink.canPlay()).toBe(true);
    expect(changed).toHaveBeenLastCalledWith(true);
  });

  it('stays blocked when the tap did not take', async () => {
    playbackAllowed(false);
    const sink = new AudioSink(host, changed);
    sink.add('peer-1', fakeTrack());
    await sink.start();
    expect(sink.canPlay()).toBe(false);
  });

  it('reports each change once, not on every track', async () => {
    playbackAllowed(false);
    const sink = new AudioSink(host, changed);
    sink.add('peer-1', fakeTrack());
    sink.add('peer-2', fakeTrack());
    await vi.waitFor(() => expect(sink.canPlay()).toBe(false));
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
