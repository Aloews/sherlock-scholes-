import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/shared/lib/supabase';
import { useGameStore } from '@/shared/store/gameStore';
import { useAuthStore } from '@/shared/store/authStore';
import * as roomService from '@/features/room/roomService';
import { transition } from '@/features/game/stateMachine';
import { hapticSuccess, hapticImpact } from '@/shared/lib/telegram';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type { Round, RoundCard, Room, TeamScore } from '@/shared/types/database';

export function useGame() {
  const navigate = useNavigate();
  const { player } = useAuthStore();
  const {
    room, teams, currentRound, currentCards, activeCardIndex, teamScores,
    setCurrentRound, setCurrentCards, updateCard, setActiveCardIndex,
    setRoom, setTeamScores, phase,
  } = useGameStore();

  // ─── Realtime: room & round changes ───────────────────────
  useEffect(() => {
    if (!room?.id) return;

    const channel = supabase
      .channel(`game-${room.id}`)
      .on<Room>(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${room.id}` },
        (payload: RealtimePostgresChangesPayload<Room>) => {
          const updated = payload.new as Room | undefined;
          if (!updated) return;
          setRoom(updated);
          if (updated.status === 'finished') {
            transition('game_end');
            navigate('/end');
          }
        },
      )
      .on<Round>(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'rounds', filter: `room_id=eq.${room.id}` },
        async (payload: RealtimePostgresChangesPayload<Round>) => {
          const round = payload.new as Round | undefined;
          if (!round) return;
          if (round.status === 'active') {
            setCurrentRound(round);
            const cards = await roomService.fetchRoundCards(round.id);
            setCurrentCards(cards);
            transition('round_active');
          } else if (round.status === 'completed') {
            setCurrentRound(round);
            const rawScores = await roomService.fetchRoundScores(room.id);
            const scores: TeamScore[] = rawScores.map((s) => ({
              team_id:      s.teamId,
              team_name:    s.teamName,
              total_points: s.total,
              color:        teams.find((t) => t.id === s.teamId)?.color ?? '#22c55e',
            }));
            setTeamScores(scores);
            transition('round_summary');
          }
        },
      )
      .on<RoundCard>(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'round_cards' },
        (payload: RealtimePostgresChangesPayload<RoundCard>) => {
          const card = payload.new as RoundCard | undefined;
          if (!card || !currentRound || card.round_id !== currentRound.id) return;
          updateCard(card.id, card.status as 'correct' | 'skipped');
          const updatedCards = useGameStore.getState().currentCards;
          const nextIdx = updatedCards.findIndex(
            (c, i) => i > activeCardIndex && c.status === 'pending',
          );
          if (nextIdx >= 0) setActiveCardIndex(nextIdx);
        },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, currentRound?.id]);

  // ─── Load initial round on mount ──────────────────────────
  useEffect(() => {
    if (!room?.current_round_id || currentRound) return;
    (async () => {
      const { data } = await supabase
        .from('rounds')
        .select()
        .eq('id', room.current_round_id)
        .single();
      if (data) {
        setCurrentRound(data as Round);
        const cards = await roomService.fetchRoundCards(data.id);
        setCurrentCards(cards);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.current_round_id]);

  // ─── Card actions (explainer only) ────────────────────────

  const markCorrect = useCallback(async () => {
    const card = currentCards[activeCardIndex];
    if (!card || card.status !== 'pending') return;
    hapticSuccess();
    await roomService.markCard(card.id, 'correct');
  }, [currentCards, activeCardIndex]);

  const markSkipped = useCallback(async () => {
    const card = currentCards[activeCardIndex];
    if (!card || card.status !== 'pending') return;
    hapticImpact('light');
    await roomService.markCard(card.id, 'skipped');
  }, [currentCards, activeCardIndex]);

  const handleRoundEnd = useCallback(async () => {
    if (!currentRound || !room) return;
    const { data: allRounds } = await supabase
      .from('rounds')
      .select()
      .eq('room_id', room.id)
      .order('round_number');
    await roomService.endRound(currentRound, room, (allRounds ?? []) as Round[]);
  }, [currentRound, room]);

  // ─── Derived state ─────────────────────────────────────────

  const is1v1       = room?.mode === '1v1';
  const isExplainer = currentRound?.explainer_id === player?.id;
  const activeCard  = currentCards[activeCardIndex] ?? null;

  const myRoomPlayer = useGameStore.getState().roomPlayers.find((rp) => rp.player_id === player?.id);
  const myTeam       = teams.find((t) => t.id === myRoomPlayer?.team_id);
  const isMyTeamsTurn = myTeam?.id === currentRound?.team_id;
  const explainerTeam = teams.find((t) => t.id === currentRound?.team_id);
  const pendingCards  = currentCards.filter((c) => c.status === 'pending');
  const correctCount  = currentCards.filter((c) => c.status === 'correct').length;

  // 1v1 personal cumulative scores
  const myTeamId         = myRoomPlayer?.team_id ?? null;
  const myPersonalScore  = myTeamId ? (teamScores.find((ts) => ts.team_id === myTeamId)?.total_points ?? 0) : 0;
  const opponentScore    = myTeamId ? (teamScores.find((ts) => ts.team_id !== myTeamId)?.total_points ?? 0) : 0;

  return {
    phase,
    currentRound,
    currentCards,
    activeCard,
    activeCardIndex,
    isExplainer,
    isMyTeamsTurn,
    explainerTeam,
    pendingCards,
    correctCount,
    is1v1,
    myPersonalScore,
    opponentScore,
    markCorrect,
    markSkipped,
    handleRoundEnd,
  };
}
