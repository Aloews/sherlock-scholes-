import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/shared/lib/supabase';
import { useGameStore } from '@/shared/store/gameStore';
import { useAuthStore } from '@/shared/store/authStore';
import * as roomService from '@/features/room/roomService';
import { transition } from '@/features/game/stateMachine';
import { hapticImpact, hapticSelection } from '@/shared/lib/telegram';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type { RoomPlayer, Room } from '@/shared/types/database';

export function useLobby() {
  const navigate = useNavigate();
  const { player } = useAuthStore();
  const {
    room, teams, roomPlayers,
    setRoom, setTeams, setRoomPlayers, upsertRoomPlayer, removeRoomPlayer,
    setLoading, setError,
  } = useGameStore();

  // ─── Realtime Subscriptions ────────────────────────────────
  useEffect(() => {
    if (!room?.id) return;

    const channel = supabase
      .channel(`lobby-${room.id}`)
      .on<RoomPlayer>(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'room_players', filter: `room_id=eq.${room.id}` },
        async () => {
          const players = await roomService.fetchRoomPlayers(room.id);
          setRoomPlayers(players);
        },
      )
      .on<RoomPlayer>(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'room_players', filter: `room_id=eq.${room.id}` },
        (payload: RealtimePostgresChangesPayload<RoomPlayer>) => {
          if (payload.new) upsertRoomPlayer(payload.new as RoomPlayer);
        },
      )
      .on<RoomPlayer>(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'room_players', filter: `room_id=eq.${room.id}` },
        (payload: RealtimePostgresChangesPayload<RoomPlayer>) => {
          const old = payload.old as Partial<RoomPlayer>;
          if (old.id) removeRoomPlayer(old.id);
        },
      )
      .on<Room>(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${room.id}` },
        (payload: RealtimePostgresChangesPayload<Room>) => {
          const updated = payload.new as Room;
          if (!updated) return;
          setRoom(updated);
          if (updated.status === 'playing') {
            transition('countdown');
            navigate('/game');
          }
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [room?.id, setRoom, setRoomPlayers, upsertRoomPlayer, removeRoomPlayer, navigate]);

  // ─── Actions ───────────────────────────────────────────────

  const assignTeam = useCallback(
    async (teamId: string) => {
      if (!player || !room) return;
      const myRoomPlayer = roomPlayers.find((rp) => rp.player_id === player.id);
      if (!myRoomPlayer) return;
      hapticSelection();
      await roomService.assignTeam(myRoomPlayer.id, teamId);
    },
    [player, room, roomPlayers],
  );

  const startGame = useCallback(async () => {
    if (!room || !player || room.host_id !== player.id) return;
    setLoading(true);
    setError(null);
    try {
      hapticImpact('heavy');
      const freshTeams = await roomService.fetchTeams(room.id);
      setTeams(freshTeams);
      await roomService.startGame(room, freshTeams);
      // Room status update triggers realtime → navigate to /game
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start game');
    } finally {
      setLoading(false);
    }
  }, [room, player, setLoading, setError, setTeams]);

  // ─── Derived state ─────────────────────────────────────────

  const isHost     = player ? room?.host_id === player.id : false;
  const isTeamMode = room?.mode !== '1v1';
  const myTeamId   = roomPlayers.find((rp) => rp.player_id === player?.id)?.team_id ?? null;

  const canStart = (() => {
    if (!isHost) return false;
    if (room?.mode === '1v1') {
      return roomPlayers.length === 2 && roomPlayers.every((rp) => rp.team_id !== null);
    }
    // Team mode: every team needs ≥ 2 players and all must be assigned
    const teamCounts = teams.reduce<Record<string, number>>((acc, t) => {
      acc[t.id] = roomPlayers.filter((rp) => rp.team_id === t.id).length;
      return acc;
    }, {});
    return Object.values(teamCounts).every((count) => count >= 2) &&
           roomPlayers.every((rp) => rp.team_id !== null);
  })();

  return {
    room, teams, roomPlayers, isHost, isTeamMode, myTeamId, canStart, assignTeam, startGame,
  };
}
