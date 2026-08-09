import { useEffect, useRef } from 'react';
import { supabase } from '@/shared/lib/supabase';
import { getRawInitData } from '@/shared/lib/telegram';
import type { VoiceStatus } from '@/features/voice/useVoiceChat';

/**
 * Holds the round's clock while the explainer's voice is down.
 *
 * WHY THE EXPLAINER AND NOBODY ELSE. They are the one talking: if their audio
 * is gone the round cannot be played at all, and the seconds ticking away are
 * being taken from them for something that is not their fault. A guesser
 * dropping is a different situation — the others carry on, the guesser rejoins
 * — and letting any of four phones stop the clock would hand the pace of the
 * game to the flakiest connection in the room.
 *
 * WHERE IT REFUSES TO ACT, which is most of the time:
 *   • voice off in this build, or the player opted out — there is no voice to
 *     lose, and a game played without it must never freeze;
 *   • a microphone the player refused — that is a choice, not a failure, and
 *     the round would never restart;
 *   • the round is not running;
 *   • the server said no (not in the room, no team yet). Those do not clear by
 *     waiting, so holding the clock would just stop the game.
 *
 * `connecting` deliberately does NOT pause. The first join happens as the
 * round starts and takes a moment; pausing for it would mean every round began
 * on hold.
 */
export function usePauseOnVoiceDrop(input: {
  roundId: string | null;
  roundActive: boolean;
  /** True only when this device is the one explaining. */
  isExplainer: boolean;
  /** Whether voice is on at all for this player, in this build. */
  voiceInUse: boolean;
  status: VoiceStatus;
}): void {
  const { roundId, roundActive, isExplainer, voiceInUse, status } = input;

  // What we last told the server, so a re-render does not send it again. The
  // RPCs are idempotent, but a request per render is still a request per
  // render.
  const sentRef = useRef<'paused' | 'running' | null>(null);
  // Whether the link has been up at all this round.
  //
  // WITHOUT THIS EVERY ROUND STARTS PAUSED. 'off' is both "not connected yet"
  // and "was connected and dropped", and at the moment a round begins it is
  // always the first. Only a link that was actually up can be lost.
  const wasUpRef = useRef(false);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    sentRef.current = null;
    wasUpRef.current = false;
  }, [roundId]);

  useEffect(() => {
    if (status === 'on') wasUpRef.current = true;
  }, [status]);

  useEffect(() => {
    if (!roundId || !roundActive || !isExplainer || !voiceInUse) return;
    // 'denied' is the player's own answer and 'connecting' is the ordinary
    // start of a round. Neither is a link that was lost.
    if (status === 'connecting' || status === 'denied') return;

    const down = (status === 'off' || status === 'unavailable') && wasUpRef.current;
    const want = down ? 'paused' : 'running';
    // Nothing to lift when nothing was ever held. A round whose voice simply
    // has not connected yet must not be told to resume — it was never paused.
    if (want === 'running' && sentRef.current !== 'paused') return;
    if (sentRef.current === want) return;

    const initData = getRawInitData();
    if (!initData) return;

    let cancelled = false;
    const send = () => {
      sentRef.current = want;
      void supabase.rpc(down ? 'pause_round' : 'resume_round', {
        p_round_id: roundId,
        p_init_data: initData,
      }).then(({ error }) => {
        if (!error || cancelled) return;
        // A request that never landed has to be sent again on its own: the
        // effect will not re-run, because nothing about the props changed. A
        // pause that fails is survivable — the clock simply runs. A RESUME
        // that fails is not: the round stays held on a request nobody sent,
        // which is worse than never pausing at all.
        sentRef.current = null;
        retryRef.current = setTimeout(send, 2000);
      });
    };
    send();

    return () => {
      cancelled = true;
      if (retryRef.current) { clearTimeout(retryRef.current); retryRef.current = null; }
    };
  }, [roundId, roundActive, isExplainer, voiceInUse, status]);
}
