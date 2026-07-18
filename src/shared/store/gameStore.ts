import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Room, Team, RoomPlayer, Round, RoundCard, Score, TeamScore } from '@/shared/types/database';
import type { GamePhase, RoundResult } from '@/shared/types/game';

interface GameState {
  phase: GamePhase;
  room: Room | null;
  teams: Team[];
  roomPlayers: RoomPlayer[];
  currentRound: Round | null;
  currentCards: RoundCard[];
  activeCardIndex: number;
  scores: Score[];
  teamScores: TeamScore[];
  lastRoundResult: RoundResult | null;
  countdown: number;
  error: string | null;
  loading: boolean;
  // true until useSessionRestore has checked for an unfinished room after a
  // page reload; RequireRoom shows a spinner instead of bouncing to home.
  restoring: boolean;
}

interface GameActions {
  setPhase(phase: GamePhase): void;
  setRoom(room: Room | null): void;
  setTeams(teams: Team[]): void;
  setRoomPlayers(players: RoomPlayer[]): void;
  upsertRoomPlayer(player: RoomPlayer): void;
  removeRoomPlayer(id: string): void;
  setCurrentRound(round: Round | null): void;
  setCurrentCards(cards: RoundCard[]): void;
  updateCard(cardId: string, status: 'correct' | 'skipped'): void;
  setActiveCardIndex(index: number): void;
  setScores(scores: Score[]): void;
  setTeamScores(scores: TeamScore[]): void;
  setLastRoundResult(result: RoundResult | null): void;
  setCountdown(n: number): void;
  setError(msg: string | null): void;
  setLoading(v: boolean): void;
  setRestoring(v: boolean): void;
  reset(): void;
}

const initialState: GameState = {
  phase: 'idle',
  room: null,
  teams: [],
  roomPlayers: [],
  currentRound: null,
  currentCards: [],
  activeCardIndex: 0,
  scores: [],
  teamScores: [],
  lastRoundResult: null,
  countdown: 3,
  error: null,
  loading: false,
  restoring: true,
};

export const useGameStore = create<GameState & GameActions>()(
  immer((set) => ({
    ...initialState,

    setPhase: (phase) => set((s) => { s.phase = phase; }),

    setRoom: (room) => set((s) => { s.room = room; }),

    setTeams: (teams) => set((s) => { s.teams = teams; }),

    setRoomPlayers: (players) => set((s) => { s.roomPlayers = players; }),

    upsertRoomPlayer: (player) =>
      set((s) => {
        const idx = s.roomPlayers.findIndex((p) => p.id === player.id);
        if (idx >= 0) s.roomPlayers[idx] = player;
        else s.roomPlayers.push(player);
      }),

    removeRoomPlayer: (id) =>
      set((s) => {
        s.roomPlayers = s.roomPlayers.filter((p) => p.id !== id);
      }),

    setCurrentRound: (round) => set((s) => { s.currentRound = round; s.activeCardIndex = 0; }),

    setCurrentCards: (cards) =>
      set((s) => {
        s.currentCards = [...cards].sort((a, b) => a.card_order - b.card_order);
        s.activeCardIndex = 0;
      }),

    updateCard: (cardId, status) =>
      set((s) => {
        const card = s.currentCards.find((c) => c.id === cardId);
        if (card) {
          card.status = status;
          card.decided_at = new Date().toISOString();
        }
      }),

    setActiveCardIndex: (index) => set((s) => { s.activeCardIndex = index; }),

    setScores: (scores) => set((s) => { s.scores = scores; }),

    setTeamScores: (scores) => set((s) => { s.teamScores = scores; }),

    setLastRoundResult: (result) => set((s) => { s.lastRoundResult = result; }),

    setCountdown: (n) => set((s) => { s.countdown = n; }),

    setError: (msg) => set((s) => { s.error = msg; }),

    setLoading: (v) => set((s) => { s.loading = v; }),

    setRestoring: (v) => set((s) => { s.restoring = v; }),

    // restoring stays false after reset: the restore check runs once per page
    // load, and re-arming it here would leave RequireRoom on the spinner forever.
    reset: () => set(() => ({ ...initialState, restoring: false })),
  })),
);
