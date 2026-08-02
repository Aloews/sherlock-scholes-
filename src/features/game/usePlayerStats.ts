import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/shared/lib/supabase';
import type { PlayerStats } from '@/shared/types/database';

export function usePlayerStats(playerId: number | null) {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Exposed so a screen that causes xp to change server-side — claiming a
  // weekly quest — can show the new total without a remount. Reading it back
  // rather than adding the reward locally keeps one source of truth: if the
  // server declined the claim, the number does not move.
  const reload = useCallback(async () => {
    if (playerId === null) return;
    const { data } = await supabase
      .from('player_stats')
      .select()
      .eq('player_id', playerId)
      .maybeSingle();
    setStats(data as PlayerStats | null);
  }, [playerId]);

  useEffect(() => {
    if (playerId === null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void reload().finally(() => setLoading(false));
  }, [playerId, reload]);

  return { stats, loading, reload };
}
