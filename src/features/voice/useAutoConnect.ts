import { useEffect, useRef } from 'react';
import { decideRetry, shouldAutoConnect } from './connectPolicy';
import type { VoiceStatus } from './useVoiceChat';
import type { VoiceUnavailableReason } from './voiceApi';

interface AutoConnectInput {
  enabled: boolean;
  status: VoiceStatus;
  reason: VoiceUnavailableReason | null;
  roomId: string | null;
  needsTeam: boolean;
  optedOut: boolean;
  connect: () => void | Promise<void>;
}

/**
 * Joins the channel without waiting to be asked, and gives up like a person
 * would.
 *
 * WHY AT ALL. Voice in a party game is not a per-room decision anybody wants
 * to make: everyone is already in the room, talking, holding one phone. A
 * button that must be found and pressed in every lobby is a button that gets
 * pressed once and then blamed for not working.
 *
 * WHERE IT STOPS, which is the more important half:
 *   • it never retries a refusal — no team yet, not in the room, a build the
 *     deployment cannot serve. Those are answers, and asking again is noise;
 *   • it never re-prompts for a microphone the player refused;
 *   • it stops after MAX_RETRIES, so a dead service costs a few seconds of
 *     battery rather than the whole game;
 *   • the retry timer dies with the screen, and a room change cancels the
 *     schedule rather than joining the previous room late.
 */
export function useAutoConnect(input: AutoConnectInput): void {
  const { enabled, status, reason, roomId, needsTeam, optedOut, connect } = input;

  const attempts = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Kept in a ref so the effect below does not re-run when the callback's
  // identity changes, which it does on every render of the provider.
  const connectRef = useRef(connect);
  connectRef.current = connect;

  // A new room is a fresh start: the previous room's attempts say nothing
  // about this one.
  useEffect(() => {
    attempts.current = 0;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, [roomId]);

  useEffect(() => {
    if (!shouldAutoConnect({ enabled, status, reason, roomId, needsTeam, optedOut })) return;

    // First attempt goes immediately — the player is already in the lobby and
    // a delay would only be felt as the app being slow.
    if (attempts.current === 0) {
      attempts.current = 1;
      void connectRef.current();
      return;
    }

    const { retry, delayMs } = decideRetry(reason, attempts.current);
    if (!retry) return;

    timer.current = setTimeout(() => {
      attempts.current += 1;
      void connectRef.current();
    }, delayMs);

    return () => {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    };
  }, [enabled, status, reason, roomId, needsTeam, optedOut]);

  // A session that came up is proof the room is joinable: forget the failures
  // so a later drop gets its own full budget of retries.
  useEffect(() => {
    if (status === 'on') attempts.current = 0;
  }, [status]);
}
