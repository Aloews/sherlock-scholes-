// Synchronized timer — uses server-side started_at as source of truth.
// All clients compute remaining time identically → no drift between devices.
//
// A held clock is part of that same truth, not a local decision: `paused_at`
// and `paused_ms` come from the round, so a pause reaches every screen at once
// and the fallback that ends the round moves with it (roundClock.ts).

import { useState, useEffect, useRef } from 'react';
import type { Round } from '@/shared/types/database';
import { remainingSeconds, isPaused, type RoundClock } from './roundClock';

function clockOf(round: Round): RoundClock {
  return {
    startedAt: round.started_at,
    seconds: round.time_seconds,
    pausedMs: round.paused_ms ?? 0,
    pausedAt: round.paused_at ?? null,
  };
}

interface UseTimerOptions {
  onExpire?: () => void;
  onTick?: (remaining: number) => void;
}

export function useTimer(round: Round | null, options: UseTimerOptions = {}) {
  const [remaining, setRemaining] = useState(round?.time_seconds ?? 0);
  const { onExpire, onTick } = options;
  const expiredRef = useRef(false);

  useEffect(() => {
    if (!round || round.status !== 'active' || !round.started_at) {
      setRemaining(round?.time_seconds ?? 0);
      expiredRef.current = false;
      return;
    }

    expiredRef.current = false;
    let prevLeft = -1;

    const tick = () => {
      const left = remainingSeconds(clockOf(round), Date.now());
      setRemaining(left);

      if (left !== prevLeft) {
        prevLeft = left;
        onTick?.(left);
      }

      // A held clock never expires, even at zero. onExpire is what ends the
      // round for everybody, so firing it during a pause would end the round
      // the pause exists to protect.
      if (left === 0 && !expiredRef.current && !isPaused(clockOf(round))) {
        expiredRef.current = true;
        onExpire?.();
      }
    };

    tick(); // immediate first tick
    const id = setInterval(tick, 500); // 500ms for smoother updates
    return () => clearInterval(id);
  }, [
    round?.id, round?.status, round?.started_at, round?.time_seconds,
    round?.paused_at, round?.paused_ms, onExpire, onTick,
  ]);

  const pct = round ? remaining / round.time_seconds : 0;
  const paused = round ? isPaused(clockOf(round)) : false;
  // A held clock is not running out, however few seconds it shows. Red digits
  // and an alarm on a timer nobody can beat is the app shouting at a player
  // for their network.
  const isWarning = !paused && remaining <= 10 && remaining > 0;
  const isDanger  = !paused && remaining <= 5 && remaining > 0;
  const isExpired = remaining === 0;

  return { remaining, pct, paused, isWarning, isDanger, isExpired };
}
