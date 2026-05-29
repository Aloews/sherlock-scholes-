import { useState, useEffect } from 'react';
import { supabase } from '@/shared/lib/supabase';
import type { PlayerStats } from '@/shared/types/database';

export function usePlayerStats(playerId: number | null) {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (playerId === null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    supabase
      .from('player_stats')
      .select()
      .eq('player_id', playerId)
      .maybeSingle()
      .then(({ data }) => {
        setStats(data as PlayerStats | null);
        setLoading(false);
      });
  }, [playerId]);

  return { stats, loading };
}
