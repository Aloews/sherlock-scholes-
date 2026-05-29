import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGameStore } from '@/shared/store/gameStore';
import { useAuthStore } from '@/shared/store/authStore';
import * as roomService from '@/features/room/roomService';
import { transition } from '@/features/game/stateMachine';
import { hapticImpact, hapticError } from '@/shared/lib/telegram';
import type { RoomSettings } from '@/shared/types/database';

export function useRoom() {
  const navigate = useNavigate();
  const { player } = useAuthStore();
  const { setRoom, setTeams, setRoomPlayers, setLoading, setError } = useGameStore();

  const createRoom = useCallback(
    async (settings?: Partial<RoomSettings>) => {
      if (!player) {
        setError('Ошибка авторизации. Обновите страницу.');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const room = await roomService.createRoom(player.id, settings);
        const [teams, roomPlayers] = await Promise.all([
          roomService.fetchTeams(room.id),
          roomService.fetchRoomPlayers(room.id),
        ]);
        setRoom(room);
        setTeams(teams);
        setRoomPlayers(roomPlayers);
        transition('lobby');
        hapticImpact('medium');
        navigate('/lobby');
      } catch (err) {
        hapticError();
        setError(err instanceof Error ? err.message : 'Failed to create room');
      } finally {
        setLoading(false);
      }
    },
    [player, navigate, setRoom, setTeams, setRoomPlayers, setLoading, setError],
  );

  const joinRoom = useCallback(
    async (code: string) => {
      if (!player) {
        setError('Ошибка авторизации. Обновите страницу.');
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const room = await roomService.joinRoom(code, player.id);
        const [teams, roomPlayers] = await Promise.all([
          roomService.fetchTeams(room.id),
          roomService.fetchRoomPlayers(room.id),
        ]);
        setRoom(room);
        setTeams(teams);
        setRoomPlayers(roomPlayers);
        transition('lobby');
        hapticImpact('medium');
        navigate('/lobby');
      } catch (err) {
        hapticError();
        setError(err instanceof Error ? err.message : 'Room not found');
      } finally {
        setLoading(false);
      }
    },
    [player, navigate, setRoom, setTeams, setRoomPlayers, setLoading, setError],
  );

  const leaveRoom = useCallback(async () => {
    const { room } = useGameStore.getState();
    if (!room || !player) return;
    await roomService.leaveRoom(room.id, player.id);
    useGameStore.getState().reset();
    navigate('/');
  }, [player, navigate]);

  return { createRoom, joinRoom, leaveRoom };
}
