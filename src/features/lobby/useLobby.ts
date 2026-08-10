import { useEffect, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/shared/lib/supabase';
import { useGameStore } from '@/shared/store/gameStore';
import { useAuthStore } from '@/shared/store/authStore';
import * as roomService from '@/features/room/roomService';
import { roomDeckFilter } from '@/features/room/roomDeck';
import { countCards, wakeSupabase } from '@/features/game/cardRandomizer';
import { transition } from '@/features/game/stateMachine';
import { hapticImpact } from '@/shared/lib/telegram';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type { RoomPlayer, Room } from '@/shared/types/database';
import type { DeckFilter } from '@/shared/types/deck';

/** How long the host may keep tapping before the choice reaches the room. */
const DECK_WRITE_DEBOUNCE_MS = 500;
/** Same idea for the counter — one RPC per pause, not one per tap. */
const DECK_COUNT_DEBOUNCE_MS = 300;

export function useLobby() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { player } = useAuthStore();
  const {
    room, teams, roomPlayers,
    setRoom, setTeams, setRoomPlayers, upsertRoomPlayer, removeRoomPlayer,
    setLoading, setError,
  } = useGameStore();

  // The DB may fall asleep while the party assembles in the lobby; re-warm it
  // here so "Start game" deals round 1 without the cold-start stall.
  useEffect(() => { void wakeSupabase(); }, []);

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

  // ─── The room's deck ───────────────────────────────────────
  //
  // The host edits a DRAFT and the room follows, rather than the other way
  // round: a write is a round-trip, and a chip that springs back until the
  // server answers reads as a broken control. Guests hold no draft at all, so
  // for them `deckFilter` is the row itself and the existing realtime UPDATE
  // on `rooms` is what moves it.
  const [deckDraft, setDeckDraft] = useState<DeckFilter | null>(null);
  const [deckCount, setDeckCount] = useState<number | null>(null);
  const [deckError, setDeckError] = useState(false);

  const isHost = player ? room?.host_id === player.id : false;
  const deckFilter = deckDraft ?? (room ? roomDeckFilter(room.settings) : {});
  const deckKey = JSON.stringify(deckFilter);

  const setDeck = useCallback((next: DeckFilter) => {
    hapticImpact('light');
    setDeckDraft(next);
  }, []);

  // Leaving the lobby must not carry one room's draft into the next.
  useEffect(() => { setDeckDraft(null); setDeckError(false); }, [room?.id]);

  useEffect(() => {
    if (!isHost || !room?.id || deckDraft === null) return;
    const handle = setTimeout(() => {
      roomService.setRoomDeckFilter(room.id, JSON.parse(deckKey) as DeckFilter)
        .then(() => setDeckError(false))
        .catch((err) => {
          // Loud, because the failure is otherwise invisible: the chips would
          // stay where the host put them while the round dealt something else.
          console.error('[lobby] deck filter write failed:', err);
          setDeckError(true);
        });
    }, DECK_WRITE_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [isHost, room?.id, deckDraft, deckKey]);

  // The same count_deck the deal draws from, so the number in the lobby and
  // the hand of round 1 can never disagree — and an impossible combination is
  // visible as a 0 before Start rather than as a failure after it.
  useEffect(() => {
    if (!room) return;
    let cancelled = false;
    setDeckCount(null);
    const handle = setTimeout(() => {
      countCards(JSON.parse(deckKey) as DeckFilter)
        .then((n) => { if (!cancelled) setDeckCount(n); });
    }, DECK_COUNT_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [room, deckKey]);

  // ─── Actions ───────────────────────────────────────────────

  const assignTeam = useCallback(
    async (teamId: string) => {
      if (!player || !room) return;
      const myRoomPlayer = roomPlayers.find((rp) => rp.player_id === player.id);
      if (!myRoomPlayer) return;
      hapticImpact('light');
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
      console.error('[lobby] start failed:', err);
      setError(t('errors.start_failed'));
    } finally {
      setLoading(false);
    }
  }, [room, player, setLoading, setError, setTeams, t]);

  // ─── Derived state ─────────────────────────────────────────

  const isTeamMode = room?.mode !== '1v1';
  const myTeamId   = roomPlayers.find((rp) => rp.player_id === player?.id)?.team_id ?? null;

  const canStart = (() => {
    if (!isHost) return false;
    // A deck of zero deals nothing: starting would throw inside activateRound
    // and surface as "couldn't start", with no hint that the filter is why.
    // `null` is "still counting", which must not block a start.
    if (deckCount === 0) return false;
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
    deckFilter, deckCount, deckError, setDeck,
  };
}
