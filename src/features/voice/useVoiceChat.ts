import { useState, useRef, useCallback, useEffect } from 'react';
import { fetchVoiceToken, voiceEnabled, type VoiceUnavailableReason } from './voiceApi';
import { loadTransportFor, availableProviders, voiceProvider } from './providers';
import { levelFor, nextLevel, audioPreset, type VoiceLevel, type LinkStats } from './voiceQuality';
import { JOIN_TIMEOUT_MS } from './connectPolicy';
import { providerOrder, nextProvider } from './failover';
import type { VoiceSession, VoiceProviderId } from './providers';

export type VoiceStatus = 'off' | 'connecting' | 'on' | 'denied' | 'unavailable';

const STATS_INTERVAL_MS = 5000;

/** What one service's turn ended in. */
interface AttemptFailure {
  ok: false;
  reason: VoiceUnavailableReason | null;
  detail: string | null;
  /** The player refused the microphone. Ends the ladder, not just this rung. */
  denied: boolean;
  /**
   * The service that actually failed — what the server signed for, which is
   * not always the rung we were standing on. Blaming the rung would send
   * somebody to look at a service that was never contacted, and would ask the
   * server to move a room off a vendor it is not on.
   */
  on: VoiceProviderId;
}

type AttemptResult = { ok: true } | AttemptFailure;

/** How each service answered this time round. Empty until something is tried. */
export type ProviderAttempts = Partial<
  Record<VoiceProviderId, { reason: VoiceUnavailableReason | null; detail: string | null }>
>;

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
  // Why the last attempt failed. Kept beside the status because 'unavailable'
  // alone is what made this bug undiagnosable from a player's screen.
  const [reason, setReason] = useState<VoiceUnavailableReason | null>(
    voiceEnabled() ? null : 'not_configured',
  );
  // The last measurement behind `level`. The ladder deliberately smooths the
  // level, so the raw numbers are the only way to see a link going bad before
  // it has gone bad — which is what a diagnostics panel is for.
  const [linkStats, setLinkStats] = useState<LinkStats | null>(null);
  // The provider's own words for why it would not come up. Never shown as the
  // primary message — it is vendor English — but a diagnostics panel that
  // cannot quote the service is how a week goes into guessing.
  const [detail, setDetail] = useState<string | null>(null);
  // The service currently in use, or being tried. Not the same as the build's
  // preferred one once the ladder has walked past it, and the panel must show
  // which one is actually carrying the audio rather than which one was asked
  // for first.
  const [active, setActive] = useState<VoiceProviderId>(voiceProvider());
  // What every service that got a turn answered. The panel reads this: after a
  // failover, "Daily refused, LiveKit is up" is the whole story, and one
  // reason on one row cannot tell it.
  const [tried, setTried] = useState<ProviderAttempts>({});

  const sessionRef = useRef<VoiceSession | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streakRef = useRef(0);
  const levelRef = useRef<VoiceLevel>('voice');
  // Mirrors `muted` for the quality ladder below, which runs on an interval
  // created once per connection. Reading the state there would read whatever
  // it was AT CONNECT TIME, so a player who muted themselves and then hit a
  // bad patch of network had their microphone switched back on for them.
  const mutedRef = useRef(false);
  // True from the first line of connect() until it has either a session or a
  // failure. `sessionRef` cannot serve as the guard: it stays null for the
  // whole attempt, so a tap arriving while auto-connect was mid-join let both
  // run, and two adapters each built a client. Daily allows exactly one per
  // page and rejects the second — see providers/daily.ts.
  const connectingRef = useRef(false);

  const disconnect = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    void sessionRef.current?.disconnect();
    sessionRef.current = null;
    streakRef.current = 0;
    // The remote <audio> elements go with the session. Leaving them behind
    // would leave the last thing anybody said hanging in the document.
    closeAudioSink();
    setSpeaking([]);
    setAudioBlocked(false);
    setStatus(voiceEnabled() ? 'off' : 'unavailable');
    setReason(voiceEnabled() ? null : 'not_configured');
  }, []);

  // Leaving the screen must not leave a microphone open.
  useEffect(() => disconnect, [disconnect]);

  /**
   * One service, one attempt. Reports rather than decides: whether a failure
   * is worth taking to the next vendor is failover.ts's question, and it is
   * answered once, in the ladder below, instead of at each exit here.
   */
  const attemptOn = useCallback(async (
    providerId: VoiceProviderId,
    /** A service that already failed this round, for the server to move off. */
    deadProvider: VoiceProviderId | null,
  ): Promise<AttemptResult> => {
    const granted = await fetchVoiceToken(roomId!, providerId, deadProvider);
    if (!granted.ok) {
      return { ok: false, reason: granted.reason, detail: null, denied: false, on: providerId };
    }

    // Held outside the try so a failure AFTER the link came up can still close
    // it. `sessionRef` cannot serve: it is only set once everything succeeded,
    // so cleanup that reached for it was disconnecting null while the session
    // stayed open, still subscribed, still delivering audio to a player who
    // was being told the connection had failed.
    let opened: VoiceSession | null = null;

    // THE SERVER'S ANSWER WINS. It signed for whichever service the ROOM is
    // on, which is not always the one we asked for — the first player to
    // arrive fixed it for everybody. Loading what it named, rather than
    // refusing the mismatch, is what keeps a room on one vendor: a channel
    // exists inside one service only, and two players on two of them hear
    // silence while both are told they are connected.
    //
    // Refusing used to be right, back when the server signed for its own
    // choice and a mismatch meant two dashboards had drifted. Now it just
    // costs rungs: pinned to agora with a livekit-first build, the ladder
    // walked livekit → mismatch → daily → mismatch → agora to reach an answer
    // it was handed at the first step.
    const signed = granted.credentials.provider;
    if (signed !== providerId && !availableProviders().includes(signed)) {
      // The room is on a service this build cannot load at all. Nothing here
      // can fix that; the ladder may as well try what it does carry.
      return { ok: false, reason: 'provider_mismatch', detail: null, denied: false, on: signed };
    }

    let stage: 'sdk' | 'join' = 'sdk';
    try {
      const transport = await loadTransportFor(signed);
      stage = 'join';
      if (signed !== providerId) setActive(signed);

      // A join with no deadline is how "Подключаемся…" becomes permanent: the
      // service can accept the token and then never answer, and nothing in the
      // SDKs promises otherwise.
      const session = await withTimeout(
        transport.connect({
          credentials: granted.credentials,
          sink: audioSink(),
          onSpeakers: setSpeaking,
          onPlaybackChanged: (playing) => setAudioBlocked(!playing),
          onDisconnected: () => disconnect(),
        }),
        JOIN_TIMEOUT_MS,
      );
      opened = session;

      // Asking for the microphone here, not on app start: the handoff is
      // explicit that the prompt belongs to the moment the player opts in.
      await session.setMicrophoneEnabled(true);
      // Spend the tap that got us here — connect() only ever runs from one.
      // Telegram's WebView does not always carry the gesture through, so the
      // result is read rather than assumed.
      await session.startAudio().catch(() => { /* the button is the retry */ });

      sessionRef.current = session;
      setStatus('on');
      setMuted(false);
      mutedRef.current = false;
      setAudioBlocked(!session.canPlaybackAudio());

      // Measure the link and let the ladder move the level. Down fast, up
      // slow — see voiceQuality.ts.
      timerRef.current = setInterval(async () => {
        const stats = await session.linkStats();
        if (!stats) return;
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
      return { ok: true };
    } catch (err) {
      // A denied microphone is a choice, not a fault — the handoff says stay
      // quiet and carry on. Anything else is a link that would not come up.
      const denied = err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      void opened?.disconnect();
      sessionRef.current = null;
      // Subscriptions can land before the microphone prompt is answered, so a
      // failure here can still leave someone talking into an element nobody
      // owns any more.
      closeAudioSink();
      // The token was granted, so the server is not the problem — the service
      // is. WHICH part of it matters: a chunk that would not load, a join that
      // was refused and a join that never answered are three different
      // afternoons, and they all used to read as "network".
      return {
        ok: false,
        on: signed,
        denied,
        reason: denied ? null
          : stage === 'sdk' ? 'sdk_failed'
          : err instanceof JoinTimeout ? 'join_timeout'
          : 'join_failed',
        detail: denied ? null : messageOf(err),
      };
    }
  }, [roomId, disconnect]);

  /**
   * Try the services in turn, and stop for the right reasons.
   *
   * ONE ATTEMPT AT A TIME. Auto-connect fires from an effect and the button
   * fires from a tap, and neither knows about the other. `sessionRef` is no
   * guard: it is null for the whole of an attempt, so two overlapping calls
   * both got as far as building a client — and Daily allows exactly one per
   * page, so the second was refused and the first was stranded.
   *
   * WHERE THE LADDER STOPS, which matters more than where it walks:
   *   • a refused microphone ends everything. The next service would prompt
   *     again, and a player who said no must be asked once, by a tap, never by
   *     a loop working through vendors;
   *   • a failure that is not the vendor's — the room, the player, our own
   *     server — ends it too. All three would answer identically, and the
   *     player would wait three times as long to read the same sentence;
   *   • the reason kept is the FIRST service's, not the last. It is the one
   *     the deployment chose and the one worth fixing; "Agora also declined"
   *     is true and useless.
   */
  const connect = useCallback(async () => {
    if (connectingRef.current || sessionRef.current) return;
    if (!roomId || !voiceEnabled()) return;
    connectingRef.current = true;
    setStatus('connecting');
    setReason(null);
    setDetail(null);
    setTried({});

    try {
      const order = providerOrder(voiceProvider(), availableProviders());
      let first: AttemptFailure | null = null;
      // Services that have genuinely had a turn — which is not the same as
      // rungs the loop has passed, because the server can hand us a different
      // vendor than the one we asked for.
      const attempted: VoiceProviderId[] = [];
      // The service that just refused us, carried to the next attempt so the
      // SERVER can move the room off it. Without this, obeying the room's pin
      // defeats the ladder outright: every rung is handed the same dead vendor
      // and the player gets three attempts at one broken service.
      let dead: VoiceProviderId | null = null;
      let target: VoiceProviderId | null = order[0] ?? null;

      while (target) {
        setActive(target);
        const result = await attemptOn(target, dead);
        if (result.ok) return;

        first ??= result;
        // Recorded against the service that actually failed, not the rung we
        // stood on: the panel must send a person to the vendor that was really
        // contacted.
        setTried((t) => ({ ...t, [result.on]: { reason: result.reason, detail: result.detail } }));

        if (result.denied) {
          setStatus('denied');
          setReason(null);
          setDetail(null);
          return;
        }

        // Handed a vendor that already refused us this round: the room did not
        // move, so asking again produces the same refusal. This is also what
        // keeps the loop finite — `attempted` only grows on services actually
        // reached, so without it a server that never moves would hand back the
        // same one forever.
        if (attempted.includes(result.on)) break;
        attempted.push(result.on);
        dead = result.on;
        target = nextProvider(order, attempted, result.reason);
      }

      setStatus('unavailable');
      setReason(first?.reason ?? 'network');
      setDetail(first?.detail ?? null);
      // Back to the service this deployment prefers: the panel, the next
      // attempt and the next reading of the logs should all start where the
      // build starts, not wherever the ladder happened to give up.
      setActive(voiceProvider());
    } finally {
      connectingRef.current = false;
    }
  }, [roomId, attemptOn]);

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
    status, reason, detail, level, linkStats, muted, speaking, audioBlocked,
    active, tried,
    connect, disconnect, toggleMute, startAudio,
  };
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

/** Thrown when a join outlives its deadline, so the catch can name it. */
class JoinTimeout extends Error {
  constructor(ms: number) {
    super(`the service did not answer within ${Math.round(ms / 1000)}s`);
    this.name = 'JoinTimeout';
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new JoinTimeout(ms)), ms);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/** The provider's message, trimmed to something a panel can hold. */
function messageOf(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}
