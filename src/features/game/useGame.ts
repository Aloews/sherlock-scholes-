import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/shared/lib/supabase';
import { useGameStore } from '@/shared/store/gameStore';
import { useAuthStore } from '@/shared/store/authStore';
import * as roomService from '@/features/room/roomService';
import { transition } from '@/features/game/stateMachine';
import { hapticImpact } from '@/shared/lib/telegram';
import { preloadPhotos } from '@/shared/lib/preloadPhotos';
import { playSound } from '@/shared/lib/sounds';
import { deadlineAt } from './roundClock';
// Read at call time, not captured in a dep array: the round's cards are
// fetched in realtime callbacks, and a language switched mid-game must apply
// to the next round rather than to the next remount.
import i18n from '@/shared/i18n';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type { Round, RoundCard, Room, TeamScore } from '@/shared/types/database';

// How many card photos to keep warm ahead of the one being explained.
// Matches useTraining's window — the same trade-off, the same answer.
const PHOTO_PRELOAD_AHEAD = 5;

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
            const cards = await roomService.fetchRoundCards(round.id, i18n.language);
            setCurrentCards(cards);
            transition('round_active');
          } else if (round.status === 'completed') {
            setCurrentRound(round);
            hapticImpact('heavy');
            playSound('whistle_end');
            // Transition BEFORE any await: the next round's 'active' event is
            // processed while this handler is suspended, and its own transition
            // must come strictly after this one (message order), or the phase
            // flips back to round_summary and sticks there for a whole round.
            transition('round_summary');
            const rawScores = await roomService.fetchRoundScores(room.id);
            const scores: TeamScore[] = rawScores.map((s) => ({
              team_id:      s.teamId,
              team_name:    s.teamName,
              total_points: s.total,
              color:        teams.find((t) => t.id === s.teamId)?.color ?? '#22c55e',
            }));
            setTeamScores(scores);
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

  // ─── Load current round when realtime missed its activation ──
  // Covers two cases: (a) mount — round 1 went 'active' before this hook
  // subscribed, so its UPDATE event was never received; (b) mid-game — the
  // rooms UPDATE (current_round_id) arrived but the rounds UPDATE didn't.
  // Either way rooms.current_round_id is the source of truth: fetch the round,
  // and if it's active, move the phase forward so the game doesn't sit in
  // countdown / round_summary forever.
  useEffect(() => {
    const roundId = room?.current_round_id;
    if (!roundId || currentRound?.id === roundId) return;
    (async () => {
      const { data } = await supabase
        .from('rounds')
        .select()
        .eq('id', roundId)
        .single();
      if (data) {
        setCurrentRound(data as Round);
        const cards = await roomService.fetchRoundCards(data.id, i18n.language);
        setCurrentCards(cards);
        if ((data as Round).status === 'active') transition('round_active');
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.current_round_id, currentRound?.id]);

  // ─── Realtime backstop: poll the room row + resync on resume ──
  // Telegram's WebView suspends the websocket when the app is backgrounded or
  // the screen locks, and missed postgres_changes events are NEVER replayed.
  // A client that slept through a round change stays on its old round — e.g.
  // the previous explainer keeps seeing cards while the other player is
  // already explaining round N+1. rooms.current_round_id is the source of
  // truth, so refetch it cheaply every few seconds and on visibility resume;
  // the effect above then reconciles the round, cards and phase.
  useEffect(() => {
    if (!room?.id) return;
    const roomId = room.id;
    let stopped = false;

    const resync = async () => {
      const { data } = await supabase.from('rooms').select().eq('id', roomId).single();
      if (stopped || !data) return;
      const fresh = data as Room;
      const stale = useGameStore.getState().room;
      if (
        stale?.current_round_id !== fresh.current_round_id ||
        stale?.status !== fresh.status
      ) {
        setRoom(fresh);
        if (fresh.status === 'finished') {
          transition('game_end');
          navigate('/end');
        }
      }
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') void resync();
    };
    document.addEventListener('visibilitychange', onVisible);
    const interval = setInterval(resync, 5000);
    return () => {
      stopped = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id]);

  // ─── Fallback: end the round if the explainer vanished ─────
  // Only the explainer ends the round on timer expiry. If they closed the
  // app or dropped offline, the round would stay 'active' forever and the
  // game would hang for everyone. Every other client schedules an end
  // attempt a few seconds past the deadline (staggered per player so they
  // don't all fire at once); the atomic claim inside endRound makes
  // concurrent attempts safe.
  useEffect(() => {
    if (!room || !currentRound || currentRound.status !== 'active' || !currentRound.started_at) return;
    if (currentRound.explainer_id === player?.id) return; // normal path handles it

    const { roomPlayers } = useGameStore.getState();
    const idx = roomPlayers.findIndex((rp) => rp.player_id === player?.id);
    const graceMs  = 4000 + Math.max(0, idx) * 1500;
    // Through roundClock, not from started_at directly: a held round's
    // deadline moves, and a fallback that ignored that would end the round
    // while every screen still showed time left — the pause undone by the
    // safety net meant to protect the round.
    const deadline = deadlineAt({
      startedAt: currentRound.started_at,
      seconds: currentRound.time_seconds,
      pausedMs: currentRound.paused_ms ?? 0,
      pausedAt: currentRound.paused_at ?? null,
    }, Date.now()) + graceMs;

    const roundId = currentRound.id;
    const timer = setTimeout(async () => {
      // No pre-checks: end_round claims the round atomically and answers
      // 'already_ended' if the explainer got there first, so the two selects
      // this used to make — one to re-read the round, one for the whole
      // rounds list — were a slower way of asking the same question.
      await roomService.endRound(roundId, room);
    }, Math.max(0, deadline - Date.now()));

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRound?.id, currentRound?.status, currentRound?.started_at,
      currentRound?.paused_at, currentRound?.paused_ms, room?.id, player?.id]);

  // ─── Watchdog: the round runner died between rounds ────────
  // endRound holds the summary for SUMMARY_PAUSE_MS before activating the
  // next round. If the client running it closed mid-pause, the game would
  // sit on the summary forever. Every client re-checks a few seconds past
  // the pause (staggered) and moves the game forward itself; the
  // current_round_id claim inside activateRound keeps this single-shot.
  useEffect(() => {
    if (!room || room.status !== 'playing') return;
    if (!currentRound || currentRound.status !== 'completed' || !currentRound.ended_at) return;

    const { roomPlayers } = useGameStore.getState();
    const idx = roomPlayers.findIndex((rp) => rp.player_id === player?.id);
    const dueAt = new Date(currentRound.ended_at).getTime()
      + roomService.SUMMARY_PAUSE_MS + 4000 + Math.max(0, idx) * 1500;

    const roundId = currentRound.id;
    const roomId  = room.id;
    const timer = setTimeout(async () => {
      const { data } = await supabase.from('rooms').select().eq('id', roomId).single();
      const freshRoom = data as Room | null;
      // Someone already moved the game forward (or finished it) — nothing to do.
      if (!freshRoom || freshRoom.status !== 'playing' || freshRoom.current_round_id !== roundId) return;

      const { data: allRounds } = await supabase
        .from('rounds')
        .select()
        .eq('room_id', roomId)
        .order('round_number');
      const rounds    = (allRounds ?? []) as Round[];
      const completed = rounds.find((r) => r.id === roundId);
      const next = completed
        ? rounds.find((r) => r.round_number === completed.round_number + 1 && r.status === 'pending')
        : undefined;

      if (next) {
        await roomService.activateRound(next.id, freshRoom);
      } else {
        // Final round done but the runner died before closing the room.
        await supabase
          .from('rooms')
          .update({ status: 'finished', ended_at: new Date().toISOString() })
          .eq('id', roomId)
          .eq('status', 'playing');
      }
    }, Math.max(0, dueAt - Date.now()));

    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRound?.id, currentRound?.status, room?.id, room?.status, player?.id]);

  // Needed by the preload effect below, so it is derived here rather than
  // down with the rest of the derived state.
  const isExplainer = currentRound?.explainer_id === player?.id;

  // Warm the watermark photos just ahead of the card being explained.
  //
  // This used to preload the whole round, on the reasoning that "a round is
  // only a handful of cards". That stopped being true when 1v1 started
  // dealing 100: the photos average 67 kB and each is a Commons redirect
  // chain, so it meant ~6.6 MB over ~300 requests the instant the round
  // landed — starving the connection the game itself needs.
  //
  // Two limits, both of which have to hold:
  //   • only the EXPLAINER sees a card at all (GameScreen renders the
  //     listening view for everyone else), so the guesser fetched megabytes
  //     of images it could never display;
  //   • a window, not the deck — the same rule useTraining already follows.
  useEffect(() => {
    if (!isExplainer) return;
    preloadPhotos(
      currentCards
        .slice(activeCardIndex, activeCardIndex + PHOTO_PRELOAD_AHEAD)
        .map((rc) => rc.card?.photo_url),
    );
  }, [currentCards, activeCardIndex, isExplainer]);

  // ─── Card actions (explainer only) ────────────────────────

  const markCorrect = useCallback(async () => {
    const card = currentCards[activeCardIndex];
    if (!card || card.status !== 'pending') return;
    hapticImpact('medium');
    playSound('correct');
    await roomService.markCard(card.id, 'correct');
  }, [currentCards, activeCardIndex]);

  const markSkipped = useCallback(async () => {
    const card = currentCards[activeCardIndex];
    if (!card || card.status !== 'pending') return;
    hapticImpact('light');
    playSound('skip');
    await roomService.markCard(card.id, 'skipped');
  }, [currentCards, activeCardIndex]);

  const handleRoundEnd = useCallback(async () => {
    if (!currentRound || !room) return;
    await roomService.endRound(currentRound.id, room);
  }, [currentRound, room]);

  // ─── Derived state ─────────────────────────────────────────

  const is1v1       = room?.mode === '1v1';
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
