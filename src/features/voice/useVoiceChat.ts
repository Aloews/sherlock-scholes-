import { useState, useRef, useCallback, useEffect } from 'react';
import { fetchVoiceToken, voiceEnabled, type VoiceUnavailableReason } from './voiceApi';
import { loadTransport, voiceChain } from './providers';
import { levelFor, nextLevel, audioPreset, type VoiceLevel, type LinkStats } from './voiceQuality';
import type { VoiceProviderId, VoiceSession, VoiceCredentials } from './providers';

export type VoiceStatus = 'off' | 'connecting' | 'on' | 'denied' | 'unavailable';

const STATS_INTERVAL_MS = 5000;

/**
 * How long a service gets to bring a link up before it is treated as down.
 *
 * A service that is blocked or unroutable does not usually refuse — it hangs,
 * and a hung connect() never rejects, so failover would never fire without a
 * clock. Long enough for a slow phone on a bad network to finish a real
 * handshake, short enough that a dead service does not eat the round.
 */
const CONNECT_TIMEOUT_MS = 12_000;

/**
 * How many times a call may put itself back together before giving up.
 *
 * A service that drops us the moment we join would otherwise be retried
 * forever, and a reconnect loop mid-round is worse than a channel that says
 * plainly it is down. Two is enough to cross a cell handover and to move to
 * the other service once.
 */
const MAX_RECOVERIES = 2;

/**
 * The in-game voice channel. Audio only in this phase.
 *
 * The service is behind `providers/`: this hook knows about a session it can
 * mute, measure and tear down, and nothing about LiveKit, Daily or Agora. The
 * adapter — and only the selected adapter's SDK, several hundred KB of it — is
 * imported dynamically when connect() runs, so a game played with voice off
 * never pays for any of them.
 *
 * The game never depends on this hook succeeding. Every failure path lands on
 * a status the UI can render as "no voice" and carries on.
 */
export function useVoiceChat(roomId: string | null) {
  const [status, setStatus] = useState<VoiceStatus>(voiceEnabled() ? 'off' : 'unavailable');
  const [level, setLevel] = useState<VoiceLevel>('voice');
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState<string[]>([]);
  // The link is up and a track is attached, but the browser will not play it.
  // Separate from every other failure: nothing is broken and nothing needs
  // reconnecting — it needs a tap. See startAudio() below.
  const [audioBlocked, setAudioBlocked] = useState(false);
  // Which service is actually carrying the call. Not always the preferred one:
  // failover may have walked past it. Reported so a live session can be placed
  // without guessing which half of the configuration was in play.
  const [provider, setProvider] = useState<VoiceProviderId | null>(null);
  // Why the last attempt failed. Kept beside the status because 'unavailable'
  // alone is what made this bug undiagnosable from a player's screen.
  const [reason, setReason] = useState<VoiceUnavailableReason | null>(
    voiceEnabled() ? null : 'not_configured',
  );
  // The last measurement behind `level`. The ladder deliberately smooths the
  // level, so the raw numbers are the only way to see a link going bad before
  // it has gone bad — which is what a diagnostics panel is for.
  const [linkStats, setLinkStats] = useState<LinkStats | null>(null);

  const sessionRef = useRef<VoiceSession | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streakRef = useRef(0);
  const levelRef = useRef<VoiceLevel>('voice');
  // Mirrors `muted` for the quality ladder below, which runs on an interval
  // created once per connection. Reading the state there would read whatever
  // it was AT CONNECT TIME, so a player who muted themselves and then hit a
  // bad patch of network had their microphone switched back on for them.
  const mutedRef = useRef(false);
  // What the server allowed for THIS room, kept so a mid-call drop can walk on
  // without asking again from scratch.
  const chainRef = useRef<VoiceProviderId[]>([]);
  // Deliberate hang-ups must not be recovered from. Without this, disconnect()
  // would race its own adapter's Disconnected event and reconnect the player
  // to the call they just left.
  const leavingRef = useRef(false);
  // Automatic recoveries spent on this session. Bounded, because a service
  // that drops us the moment we join would otherwise be retried forever, and
  // a reconnect loop is worse than a channel that is honestly down.
  const recoveriesRef = useRef(0);

  const disconnect = useCallback(() => {
    leavingRef.current = true;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    void sessionRef.current?.disconnect();
    sessionRef.current = null;
    streakRef.current = 0;
    // The remote <audio> elements go with the session. Leaving them behind
    // would leave the last thing anybody said hanging in the document.
    closeAudioSink();
    setSpeaking([]);
    setAudioBlocked(false);
    setProvider(null);
    setLinkStats(null);
    setStatus(voiceEnabled() ? 'off' : 'unavailable');
    setReason(voiceEnabled() ? null : 'not_configured');
  }, []);

  // Leaving the screen must not leave a microphone open.
  useEffect(() => disconnect, [disconnect]);

  /**
   * Take a freshly opened session live: microphone, playback, quality ladder.
   *
   * Shared by the first connect and by every in-room recovery, so a call that
   * moved to another service mid-round comes back with the same behaviour it
   * had before — including the mute the player had set.
   */
  const activate = useCallback(async (session: VoiceSession, on: VoiceProviderId, firstTime: boolean) => {
    // Asking for the microphone here, not on app start: the handoff is
    // explicit that the prompt belongs to the moment the player opts in.
    // A recovery keeps whatever the player chose rather than re-opening a
    // microphone they had closed.
    await session.setMicrophoneEnabled(!mutedRef.current);
    // Spend the tap that got us here — connect() only ever runs from one.
    // Telegram's WebView does not always carry the gesture through, so the
    // result is read rather than assumed. A recovery has no gesture at all,
    // which is exactly why the outcome is read and surfaced rather than
    // assumed to have worked.
    await session.startAudio().catch(() => { /* the button is the retry */ });

    sessionRef.current = session;
    setProvider(on);
    setStatus('on');
    if (firstTime) { setMuted(false); mutedRef.current = false; }
    setAudioBlocked(!session.canPlaybackAudio());

    // Measure the link and let the ladder move the level. Down fast, up
    // slow — see voiceQuality.ts.
    timerRef.current = setInterval(async () => {
      const stats = await session.linkStats();
      if (!stats) return;
      // The raw numbers behind `level`. The ladder smooths deliberately, so
      // these are the only way to watch a link going bad before it has gone —
      // which is what the diagnostics panel is for.
      setLinkStats(stats);
      const measured = levelFor(stats);
      streakRef.current = measured === levelRef.current ? 0 : streakRef.current + 1;
      const next = nextLevel(levelRef.current, measured, streakRef.current);
      if (next !== levelRef.current) {
        levelRef.current = next;
        setLevel(next);
        streakRef.current = 0;
        const preset = audioPreset(next);
        // 'text' means the link cannot carry voice: stop publishing rather
        // than pretend, so the player is not talking into a dead channel.
        // A player who muted themselves stays muted — the ladder may close
        // the microphone, never open it.
        await session.setMicrophoneEnabled(preset !== null && !mutedRef.current);
      }
    }, STATS_INTERVAL_MS);
  }, []);

  /**
   * The link went away on its own, mid-call. Get the player back on air.
   *
   * THIS IS THE IN-ROOM HALF OF FAILOVER. connect() walks the chain when a
   * service will not come up in the first place; this walks it when one dies
   * with a game in progress — which is the case that actually costs a round,
   * because nobody taps anything and the channel simply goes quiet.
   *
   * The service that just dropped goes to the BACK of the order, not out of
   * it: a service can drop for reasons that are not its fault, and a chain of
   * one would otherwise end the call the first time a phone changed cell.
   */
  const recover = useCallback(async (failed: VoiceProviderId | null) => {
    if (leavingRef.current) return;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    void sessionRef.current?.disconnect();
    sessionRef.current = null;
    closeAudioSink();

    if (!roomId || recoveriesRef.current >= MAX_RECOVERIES) {
      // Out of budget: say the channel is down rather than keep a player
      // staring at "Подключаюсь…" through the rest of the round.
      setStatus('unavailable');
      setReason('network');
      setSpeaking([]);
      setProvider(null);
      return;
    }
    recoveriesRef.current += 1;
    setStatus('connecting');
    setSpeaking([]);

    const order = rotatePast(chainRef.current, failed);
    const granted = await fetchVoiceToken(roomId, order[0]);
    if (!granted.ok) { setStatus('unavailable'); setReason(granted.reason); return; }

    try {
      const started = await openWithFailover(roomId, { ...granted.credentials, chain: order }, {
        sink: audioSink(),
        onSpeakers: setSpeaking,
        onPlaybackChanged: (playing) => setAudioBlocked(!playing),
        onDisconnected: () => { void recoverRef.current?.(providerRef.current); },
      });
      if (!started.ok) { setStatus('unavailable'); setReason(started.reason); closeAudioSink(); return; }
      chainRef.current = started.chain;
      providerRef.current = started.provider;
      await activate(started.session, started.provider, false);
    } catch (err) {
      setStatus(isMicrophoneDenied(err) ? 'denied' : 'unavailable');
      setReason(isMicrophoneDenied(err) ? null : 'network');
      closeAudioSink();
    }
  }, [roomId, activate]);

  // The drop handler is installed into adapters that outlive the callback that
  // built them, so it is reached through a ref rather than captured.
  const recoverRef = useRef(recover);
  recoverRef.current = recover;
  const providerRef = useRef<VoiceProviderId | null>(null);

  const connect = useCallback(async () => {
    if (!roomId || !voiceEnabled() || sessionRef.current) return;
    leavingRef.current = false;
    recoveriesRef.current = 0;
    setStatus('connecting');
    setReason(null);

    const granted = await fetchVoiceToken(roomId);
    if (!granted.ok) { setStatus('unavailable'); setReason(granted.reason); return; }

    // Held outside the try so a failure AFTER the link came up can still close
    // it. `sessionRef` cannot serve: it is only set once everything succeeded,
    // so cleanup that reached for it was disconnecting null while the session
    // stayed open, still subscribed, still delivering audio to a player who
    // was being told the connection had failed.
    let opened: VoiceSession | null = null;

    try {
      const started = await openWithFailover(roomId, granted.credentials, {
        sink: audioSink(),
        onSpeakers: setSpeaking,
        onPlaybackChanged: (playing) => setAudioBlocked(!playing),
        onDisconnected: () => { void recoverRef.current?.(providerRef.current); },
      });
      if (!started.ok) {
        setStatus('unavailable');
        setReason(started.reason);
        closeAudioSink();
        return;
      }
      opened = started.session;
      chainRef.current = started.chain;
      providerRef.current = started.provider;
      await activate(started.session, started.provider, true);
    } catch (err) {
      // A denied microphone is a choice, not a fault — the handoff says stay
      // quiet and carry on. Anything else is a link that would not come up.
      const denied = isMicrophoneDenied(err);
      setStatus(denied ? 'denied' : 'unavailable');
      // The token was granted, so the server is not the problem: the link to
      // the voice service is. Says so rather than repeating the last
      // token-stage reason.
      setReason(denied ? null : 'network');
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      void opened?.disconnect();
      sessionRef.current = null;
      // Subscriptions can land before the microphone prompt is answered, so a
      // failure here can still leave someone talking into an element nobody
      // owns any more.
      closeAudioSink();
    }
  }, [roomId, activate]);

  /**
   * Second attempt at playback, on a fresh tap.
   *
   * The only cure for a blocked autoplay is a user gesture, so this exists to
   * be wired to a button and must be called from the handler itself — not
   * after an await, which would spend the gesture on the way.
   */
  const startAudio = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    try { await session.startAudio(); } catch { /* still blocked; the button stays */ }
    setAudioBlocked(!session.canPlaybackAudio());
  }, []);

  const toggleMute = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    const next = !muted;
    setMuted(next);
    mutedRef.current = next;
    await session.setMicrophoneEnabled(!next && audioPreset(levelRef.current) !== null);
  }, [muted]);

  return {
    status, reason, level, linkStats, muted, speaking, audioBlocked, provider,
    connect, disconnect, toggleMute, startAudio,
  };
}

type OpenHooks = {
  sink: HTMLElement;
  onSpeakers(ids: string[]): void;
  onPlaybackChanged(playing: boolean): void;
  onDisconnected(): void;
};

type OpenResult =
  | { ok: true; session: VoiceSession; provider: VoiceProviderId; chain: VoiceProviderId[] }
  | { ok: false; reason: VoiceUnavailableReason };

/**
 * Bring a link up, trying the next service when one will not come up.
 *
 * WHAT THIS IS FOR, and what it is deliberately not for. Failover fires on a
 * service that cannot be REACHED — blocked, unroutable, having a bad day —
 * not on a service that is merely slow. Switching does not fix a weak last
 * mile: both services carry the same WebRTC over the same phone on the same
 * network, and a swap costs a teardown, a round trip for new credentials and
 * a fresh handshake. That is several seconds of silence, which is worse than
 * the dip that would have prompted it. Bad links are the quality ladder's
 * job (voiceQuality.ts); unreachable services are this one's.
 *
 * The order comes from the SERVER, in `credentials.chain`. The client may ask
 * for anything in that list and nothing outside it, so the original rule
 * holds: a caller still cannot choose which set of secrets to exercise.
 *
 * A microphone denial ends the walk immediately. It is the player's answer,
 * it will be the same answer at every service, and asking a second time is
 * just a second prompt.
 */
async function openWithFailover(
  roomId: string,
  first: VoiceCredentials,
  hooks: OpenHooks,
): Promise<OpenResult> {
  // The server's list wins; the build's own chain is the fallback for a
  // deployment too old to send one.
  const order = dedupe([first.provider, ...(first.chain ?? voiceChain())]);
  let lastReason: VoiceUnavailableReason = 'network';

  for (const id of order) {
    // The adapter is checked BEFORE the credential, so a chain entry this
    // build was not compiled with costs nothing. The server's list is what it
    // is willing to sign for, not a promise that every frontend carries it.
    let transport;
    try {
      transport = await loadTransport(id);
    } catch {
      continue;
    }

    // The first credential is in hand; every later one has to be minted anew,
    // because a token is only ever valid at the service that signed it.
    let credentials: VoiceCredentials;
    if (id === first.provider) {
      credentials = first;
    } else {
      const granted = await fetchVoiceToken(roomId, id);
      if (!granted.ok) { lastReason = granted.reason; continue; }
      credentials = granted.credentials;
    }

    // A credential for one service handed to another's adapter is valid and
    // useless — it would wait out a handshake that cannot happen. Refuse it
    // here rather than spend the timeout discovering it.
    if (credentials.provider !== transport.id) { lastReason = 'provider_mismatch'; continue; }

    try {
      const session = await withTimeout(
        transport.connect({ credentials, ...hooks }),
        CONNECT_TIMEOUT_MS,
      );
      return { ok: true, session, provider: id, chain: order };
    } catch (err) {
      if (isMicrophoneDenied(err)) throw err;
      // Whatever this service did, the next one gets a clean sink: a half-open
      // adapter may have attached something before giving up.
      hooks.sink.replaceChildren();
      lastReason = 'network';
    }
  }

  return { ok: false, reason: lastReason };
}

function dedupe(ids: VoiceProviderId[]): VoiceProviderId[] {
  return [...new Set(ids)];
}

function isMicrophoneDenied(err: unknown): boolean {
  return err instanceof DOMException &&
    (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
}

/**
 * A promise with a deadline.
 *
 * A blocked service does not refuse, it hangs — so a connect() that never
 * settles is the normal shape of the failure failover exists for, and without
 * a clock the walk would stop at the first one forever.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('voice: connect timed out')), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

const SINK_ATTR = 'data-voice-sink';

/**
 * Where the remote <audio> elements live.
 *
 * They are deliberately NOT React-rendered. They carry no UI, they arrive and
 * leave on the service's events rather than on a render, and a re-render that
 * replaced one would interrupt whoever was talking. One plain node in <body>,
 * outside the tree, owned by connect/disconnect and handed to the adapter.
 *
 * It is hidden by having no size rather than by `display:none` or `hidden`: a
 * media element that must keep playing has no business being in a subtree the
 * browser is invited to treat as inert.
 */
function audioSink(): HTMLElement {
  const existing = document.querySelector<HTMLElement>(`[${SINK_ATTR}]`);
  if (existing) return existing;
  const sink = document.createElement('div');
  sink.setAttribute(SINK_ATTR, '');
  sink.setAttribute('aria-hidden', 'true');
  sink.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;pointer-events:none;';
  document.body.appendChild(sink);
  return sink;
}

function closeAudioSink(): void {
  document.querySelector(`[${SINK_ATTR}]`)?.remove();
}

/**
 * The same services, with the one that just failed moved to the back.
 *
 * Not removed: a service can drop a call for reasons that are not its own —
 * a phone changing cell, a tunnel — and a chain of one would end the call the
 * first time that happened. It goes last so anything else is tried first.
 */
function rotatePast(chain: VoiceProviderId[], failed: VoiceProviderId | null): VoiceProviderId[] {
  if (chain.length === 0) return failed ? [failed] : voiceChain();
  if (!failed || !chain.includes(failed)) return chain;
  return [...chain.filter((id) => id !== failed), failed];
}
