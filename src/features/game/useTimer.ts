// Synchronized timer — uses server-side started_at as source of truth.
// All clients compute remaining time identically → no drift between devices.

import { useState, useEffect, useRef } from 'react';
import type { Round } from '@/shared/types/database';

interface UseTimerOptions {
  onExpire?: () => void;
}

export function useTimer(round: Round | null, options: UseTimerOptions = {}) {
  const [remaining, setRemaining] = useState(round?.time_seconds ?? 0);
  const { onExpire } = options;
  const expiredRef = useRef(false);

  useEffect(() => {
    if (!round || round.status !== 'active' || !round.started_at) {
      setRemaining(round?.time_seconds ?? 0);
      expiredRef.current = false;
      return;
    }

    expiredRef.current = false;

    const tick = () => {
      const elapsed = Math.floor(
        (Date.now() - new Date(round.started_at!).getTime()) / 1000,
      );
      const left = Math.max(0, round.time_seconds - elapsed);
      setRemaining(left);

      if (left === 0 && !expiredRef.current) {
        expiredRef.current = true;
        onExpire?.();
      }
    };

    tick(); // immediate first tick
    const id = setInterval(tick, 500); // 500ms for smoother updates
    return () => clearInterval(id);
  }, [round?.id, round?.status, round?.started_at, round?.time_seconds, onExpire]);

  const pct = round ? remaining / round.time_seconds : 0;
  const isWarning = remaining <= 10 && remaining > 0;
  const isDanger  = remaining <= 5 && remaining > 0;
  const isExpired = remaining === 0;

  return { remaining, pct, isWarning, isDanger, isExpired };
}
