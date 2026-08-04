// Remote audio, attached by hand.
//
// LiveKit ships attach()/detach(). The other services hand over a raw
// MediaStreamTrack and leave the element to the application — which is the
// same job, done in the same wrong way by default: create no element, or
// create one and never notice that `play()` was refused.
//
// So it lives here once, for every adapter that needs it, with the refusal
// treated as a first-class outcome rather than an unhandled rejection. The
// autoplay policy is not an edge case in a Telegram WebView; it is the normal
// case until a gesture says otherwise.

/** One <audio> per remote track, keyed so the adapter can take it away again. */
export class AudioSink {
  private elements = new Map<string, HTMLAudioElement>();
  private blocked = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly onPlaybackChanged: (playing: boolean) => void,
  ) {}

  /**
   * Play a remote track. Replaces any element already held under `key`, so a
   * republish (the same participant turning their microphone off and on) does
   * not leave two elements racing on the same audio.
   */
  add(key: string, track: MediaStreamTrack): void {
    this.remove(key);
    const el = document.createElement('audio');
    el.autoplay = true;
    // iOS treats an element without this as a request to take over the screen.
    el.setAttribute('playsinline', '');
    el.srcObject = new MediaStream([track]);
    this.elements.set(key, el);
    this.host.appendChild(el);
    // The rejection IS the signal. Without this catch it is an unhandled
    // promise and the channel is simply silent.
    void attempt(el).then(() => this.report(false), () => this.report(true));
  }

  remove(key: string): void {
    const el = this.elements.get(key);
    if (!el) return;
    el.srcObject = null;
    el.remove();
    this.elements.delete(key);
  }

  clear(): void {
    for (const key of [...this.elements.keys()]) this.remove(key);
  }

  canPlay(): boolean {
    return !this.blocked;
  }

  /**
   * Retry every held element. Called from a click handler, where the gesture
   * that lifts the block is still in hand — so nothing is awaited before the
   * play() calls go out.
   */
  async start(): Promise<void> {
    // Every play() is issued before the first await, so they all run inside
    // the gesture rather than one per turn of the event loop.
    const attempts = [...this.elements.values()].map(attempt);
    const results = await Promise.allSettled(attempts);
    this.report(results.some((r) => r.status === 'rejected'));
  }

  private report(blocked: boolean): void {
    if (blocked === this.blocked) return;
    this.blocked = blocked;
    this.onPlaybackChanged(!blocked);
  }
}

/**
 * `play()` as a promise, whatever the environment thinks it returns.
 *
 * Browsers that predate the promise-returning definition hand back undefined,
 * and a WebView can throw synchronously instead of rejecting. Both would take
 * down the track handler that called this, so both are normalised here.
 */
function attempt(el: HTMLAudioElement): Promise<void> {
  try {
    return Promise.resolve(el.play()).then(() => undefined);
  } catch (err) {
    return Promise.reject(err);
  }
}
