import { useState, useRef, useCallback, useEffect } from 'react';
import { fetchVoiceToken, livekitUrl, voiceEnabled, type VoiceUnavailableReason } from './voiceApi';
import { levelFor, nextLevel, audioPreset, type VoiceLevel } from './voiceQuality';
import type { Room } from 'livekit-client';

export type VoiceStatus = 'off' | 'connecting' | 'on' | 'denied' | 'unavailable';

const STATS_INTERVAL_MS = 5000;

/**
 * The in-game voice channel. Audio only in this phase.
 *
 * livekit-client is imported dynamically: it is a few hundred KB, and a game
 * played with voice off — the default, and the only mode until the server is
 * configured — must not pay for it. Nothing here loads until connect() runs.
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

  const roomRef = useRef<Room | null>(null);
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
    void roomRef.current?.disconnect();
    roomRef.current = null;
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
    if (!roomId || !voiceEnabled() || roomRef.current) return;
    setStatus('connecting');
    setReason(null);

    const granted = await fetchVoiceToken(roomId);
    if (!granted.ok) { setStatus('unavailable'); setReason(granted.reason); return; }

    // Held outside the try so a failure AFTER the link came up can still close
    // it. `roomRef` cannot serve: it is only set once everything succeeded, so
    // the old cleanup here was disconnecting null while the room stayed open,
    // still subscribing, still delivering audio to a session the player was
    // being told had failed.
    let opened: Room | null = null;

    try {
      const { Room: LKRoom, RoomEvent, Track } = await import('livekit-client');
      const room = new LKRoom({ adaptiveStream: false, dynacast: true });
      opened = room;

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        setSpeaking(speakers.map((s) => s.identity));
      });

      // THE BUG THIS FIXES: "подключено, но ничего не слышно".
      //
      // LiveKit subscribes to the other player's microphone and hands the
      // track over. It does NOT play it — that is the application's job, and
      // this hook was not doing it. We published our own microphone, received
      // theirs, and dropped it on the floor: every status said "on" and the
      // room was silent. attach() builds the <audio> element the audio needs
      // to come out of; the sink below puts it in the document.
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        audioSink().appendChild(track.attach());
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return;
        track.detach().forEach((el) => el.remove());
      });

      // Autoplay policy: an attached element is not a playing element. The
      // browser tells LiveKit it refused, LiveKit tells us here, and the UI
      // turns that into a button — the one thing that fixes it is a tap.
      room.on(RoomEvent.AudioPlaybackStatusChanged, (playing) => {
        setAudioBlocked(!playing);
      });

      room.on(RoomEvent.Disconnected, () => disconnect());

      await room.connect(livekitUrl(), granted.token);
      // Asking for the microphone here, not on app start: the handoff is
      // explicit that the prompt belongs to the moment the player opts in.
      await room.localParticipant.setMicrophoneEnabled(true);
      // Spend the tap that got us here — connect() only ever runs from one.
      // Telegram's WebView does not always carry the gesture through, so the
      // result is read rather than assumed.
      await room.startAudio().catch(() => { /* the button is the retry */ });

      roomRef.current = room;
      setStatus('on');
      setMuted(false);
      mutedRef.current = false;
      setAudioBlocked(!room.canPlaybackAudio);

      // Measure the link and let the ladder move the level. Down fast, up
      // slow — see voiceQuality.ts.
      timerRef.current = setInterval(async () => {
        const stats = await readLinkStats(room);
        if (!stats) return;
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
          await room.localParticipant.setMicrophoneEnabled(preset !== null && !mutedRef.current);
        }
      }, STATS_INTERVAL_MS);
    } catch (err) {
      // A denied microphone is a choice, not a fault — the handoff says stay
      // quiet and carry on. Anything else is a link that would not come up.
      const denied = err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      setStatus(denied ? 'denied' : 'unavailable');
      // The token was granted, so the server is not the problem: the link to
      // LiveKit is. Says so rather than repeating the last token-stage reason.
      setReason(denied ? null : 'network');
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      void opened?.disconnect();
      roomRef.current = null;
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
    const room = roomRef.current;
    if (!room) return;
    try { await room.startAudio(); } catch { /* still blocked; the button stays */ }
    setAudioBlocked(!room.canPlaybackAudio);
  }, []);

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !muted;
    setMuted(next);
    mutedRef.current = next;
    await room.localParticipant.setMicrophoneEnabled(!next && audioPreset(levelRef.current) !== null);
  }, [muted]);

  return { status, reason, level, muted, speaking, audioBlocked, connect, disconnect, toggleMute, startAudio };
}

const SINK_ATTR = 'data-voice-sink';

/**
 * Where the remote <audio> elements live.
 *
 * They are deliberately NOT React-rendered. They carry no UI, they arrive and
 * leave on LiveKit's events rather than on a render, and a re-render that
 * replaced one would interrupt whoever was talking. One plain node in <body>,
 * outside the tree, owned by connect/disconnect.
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

/** RTT and loss from the publisher's WebRTC stats, averaged by the browser. */
async function readLinkStats(room: Room): Promise<{ rttMs: number; loss: number } | null> {
  try {
    const stats = await room.engine?.pcManager?.publisher?.getStats?.();
    if (!stats) return null;
    let rttMs = 0;
    let lost = 0;
    let sent = 0;
    stats.forEach((report: { type: string; currentRoundTripTime?: number; packetsLost?: number; packetsSent?: number }) => {
      if (report.type === 'candidate-pair' && typeof report.currentRoundTripTime === 'number') {
        rttMs = report.currentRoundTripTime * 1000;
      }
      if (report.type === 'remote-inbound-rtp') {
        lost += report.packetsLost ?? 0;
      }
      if (report.type === 'outbound-rtp') {
        sent += report.packetsSent ?? 0;
      }
    });
    return { rttMs, loss: sent > 0 ? Math.max(0, Math.min(1, lost / sent)) : 0 };
  } catch {
    return null;
  }
}
