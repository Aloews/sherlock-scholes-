import { useState, useRef, useCallback, useEffect } from 'react';
import { fetchVoiceToken, voiceEnabled, type VoiceUnavailableReason } from './voiceApi';
import { loadTransport } from './providers';
import { levelFor, nextLevel, audioPreset, type VoiceLevel, type LinkStats } from './voiceQuality';
import { JOIN_TIMEOUT_MS } from './connectPolicy';
import type { VoiceSession } from './providers';

export type VoiceStatus = 'off' | 'connecting' | 'on' | 'denied' | 'unavailable';

const STATS_INTERVAL_MS = 5000;

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

  const sessionRef = useRef<VoiceSession | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streakRef = useRef(0);
  const levelRef = useRef<VoiceLevel>('voice');
  // Mirrors `muted` for the quality ladder below, which runs on an interval
  // created once per connection. Reading the state there would read whatever
  // it was AT CONNECT TIME, so a player who muted themselves and then hit a
  // bad patch of network had their microphone switched back on for them.
  const mutedRef = useRef(false);

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

  const connect = useCallback(async () => {
    if (!roomId || !voiceEnabled() || sessionRef.current) return;
    setStatus('connecting');
    setReason(null);
    setDetail(null);

    const granted = await fetchVoiceToken(roomId);
    if (!granted.ok) { setStatus('unavailable'); setReason(granted.reason); return; }

    // Held outside the try so a failure AFTER the link came up can still close
    // it. `sessionRef` cannot serve: it is only set once everything succeeded,
    // so cleanup that reached for it was disconnecting null while the session
    // stayed open, still subscribed, still delivering audio to a player who
    // was being told the connection had failed.
    let opened: VoiceSession | null = null;

    let stage: 'sdk' | 'join' = 'sdk';
    try {
      const transport = await loadTransport();
      stage = 'join';
      // The build loaded one adapter; the server signed for whichever service
      // ITS secrets belong to. When those differ, the credential is valid and
      // useless — the adapter would hand a Daily token to LiveKit and get a
      // timeout. Say which mismatch it is instead.
      if (granted.credentials.provider !== transport.id) {
        setStatus('unavailable');
        setReason('provider_mismatch');
        return;
      }

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
    } catch (err) {
      // A denied microphone is a choice, not a fault — the handoff says stay
      // quiet and carry on. Anything else is a link that would not come up.
      const denied = err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      setStatus(denied ? 'denied' : 'unavailable');
      // The token was granted, so the server is not the problem — the service
      // is. WHICH part of it matters: a chunk that would not load, a join that
      // was refused and a join that never answered are three different
      // afternoons, and they all used to read as "network".
      setReason(
        denied ? null
        : stage === 'sdk' ? 'sdk_failed'
        : err instanceof JoinTimeout ? 'join_timeout'
        : 'join_failed',
      );
      setDetail(denied ? null : messageOf(err));
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      void opened?.disconnect();
      sessionRef.current = null;
      // Subscriptions can land before the microphone prompt is answered, so a
      // failure here can still leave someone talking into an element nobody
      // owns any more.
      closeAudioSink();
    }
  }, [roomId, disconnect]);

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
