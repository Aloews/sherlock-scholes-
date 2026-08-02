import { useState, useRef, useCallback, useEffect } from 'react';
import { fetchVoiceToken, livekitUrl, voiceEnabled } from './voiceApi';
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

  const roomRef = useRef<Room | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streakRef = useRef(0);
  const levelRef = useRef<VoiceLevel>('voice');

  const disconnect = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    void roomRef.current?.disconnect();
    roomRef.current = null;
    streakRef.current = 0;
    setSpeaking([]);
    setStatus(voiceEnabled() ? 'off' : 'unavailable');
  }, []);

  // Leaving the screen must not leave a microphone open.
  useEffect(() => disconnect, [disconnect]);

  const connect = useCallback(async () => {
    if (!roomId || !voiceEnabled() || roomRef.current) return;
    setStatus('connecting');

    const granted = await fetchVoiceToken(roomId);
    if (!granted) { setStatus('unavailable'); return; }

    try {
      const { Room: LKRoom, RoomEvent } = await import('livekit-client');
      const room = new LKRoom({ adaptiveStream: false, dynacast: true });

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        setSpeaking(speakers.map((s) => s.identity));
      });
      room.on(RoomEvent.Disconnected, () => disconnect());

      await room.connect(livekitUrl(), granted.token);
      // Asking for the microphone here, not on app start: the handoff is
      // explicit that the prompt belongs to the moment the player opts in.
      await room.localParticipant.setMicrophoneEnabled(true);

      roomRef.current = room;
      setStatus('on');
      setMuted(false);

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
          await room.localParticipant.setMicrophoneEnabled(preset !== null && !muted);
        }
      }, STATS_INTERVAL_MS);
    } catch (err) {
      // A denied microphone is a choice, not a fault — the handoff says stay
      // quiet and carry on. Anything else is a link that would not come up.
      const denied = err instanceof DOMException &&
        (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError');
      setStatus(denied ? 'denied' : 'unavailable');
      void roomRef.current?.disconnect();
      roomRef.current = null;
    }
  }, [roomId, disconnect, muted]);

  const toggleMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const next = !muted;
    setMuted(next);
    await room.localParticipant.setMicrophoneEnabled(!next && audioPreset(levelRef.current) !== null);
  }, [muted]);

  return { status, level, muted, speaking, connect, disconnect, toggleMute };
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
