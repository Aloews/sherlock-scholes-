import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/shared/lib/supabase';
import { useGameStore } from '@/shared/store/gameStore';
import { useAuthStore } from '@/shared/store/authStore';
import * as roomService from '@/features/room/roomService';
import { forceTransition } from '@/features/game/stateMachine';
import type { Room } from '@/shared/types/database';

// Only rooms this recent are candidates for restore. Games run for minutes —
// an abandoned 'waiting'/'playing' room from hours ago must not hijack every
// app start into its lobby.
const RESTORE_WINDOW_MS = 2 * 60 * 60 * 1000;

// After a page reload the in-memory store is empty, so a player mid-game
// would land on the home screen and lose the party. Look up their most recent
// unfinished room and put them back where they were (lobby or game). Runs
// once per page load; RequireRoom holds routes on a spinner via the store's
// `restoring` flag until this check completes.
export function useSessionRestore(): void {
  const navigate = useNavigate();
  const { player } = useAuthStore();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const { room, setRestoring } = useGameStore.getState();
    // Normal in-app navigation (room already set) or failed auth — nothing to do.
    if (!player || room) {
      setRestoring(false);
      return;
    }

    (async () => {
      try {
        const since = new Date(Date.now() - RESTORE_WINDOW_MS).toISOString();
        const { data } = await supabase
          .from('room_players')
          .select('joined_at, room:rooms!inner(*)')
          .eq('player_id', player.id)
          .in('room.status', ['waiting', 'playing'])
          .gte('room.created_at', since)
          .order('joined_at', { ascending: false })
          .limit(1);

        const found = (data?.[0] as unknown as { room: Room } | undefined)?.room;
        if (!found) return;

        const [teams, roomPlayers] = await Promise.all([
          roomService.fetchTeams(found.id),
          roomService.fetchRoomPlayers(found.id),
        ]);
        const store = useGameStore.getState();
        store.setRoom(found);
        store.setTeams(teams);
        store.setRoomPlayers(roomPlayers);

        if (found.status === 'waiting') {
          forceTransition('lobby');
          navigate('/lobby', { replace: true });
        } else {
          // 'playing': useGame reads rooms.current_round_id, loads the round
          // and moves countdown → round_active itself; a finished room never
          // matches the query above.
          forceTransition('countdown');
          navigate('/game', { replace: true });
        }
      } catch {
        // Restore is best-effort — on any failure the app just starts at home.
      } finally {
        useGameStore.getState().setRestoring(false);
      }
    })();
  }, [player, navigate]);
}
