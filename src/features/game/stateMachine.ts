// Scalable game state machine — defines valid transitions and guards
// All transitions go through this module; never mutate phase directly elsewhere.

import { useGameStore } from '@/shared/store/gameStore';
import type { GamePhase } from '@/shared/types/game';

type Transition = Record<GamePhase, GamePhase[]>;

// Valid transitions: current phase → allowed next phases
// The round loop is round_active → round_summary → round_active (next round
// activates straight from the summary — there is no per-round countdown).
// round_active → game_end covers a missed 'completed' event on the final
// round: the room's 'finished' update must still reach the end screen.
const TRANSITIONS: Transition = {
  idle:          ['lobby'],
  lobby:         ['idle', 'countdown'],
  countdown:     ['round_active', 'idle'],
  round_active:  ['round_summary', 'game_end'],
  round_summary: ['countdown', 'round_active', 'game_end'],
  game_end:      ['idle'],
};

function canTransition(from: GamePhase, to: GamePhase): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transition(to: GamePhase): void {
  const { phase, setPhase } = useGameStore.getState();

  if (!canTransition(phase, to)) {
    if (import.meta.env.DEV) {
      console.warn(`[StateMachine] Invalid transition: ${phase} → ${to}`);
    }
    return;
  }
  setPhase(to);
}

export function forceTransition(to: GamePhase): void {
  useGameStore.getState().setPhase(to);
}

export function getCurrentPhase(): GamePhase {
  return useGameStore.getState().phase;
}

// Convenience guards used by hooks and components
export const GameGuards = {
  isIdle:         () => useGameStore.getState().phase === 'idle',
  isInLobby:      () => useGameStore.getState().phase === 'lobby',
  isCountdown:    () => useGameStore.getState().phase === 'countdown',
  isRoundActive:  () => useGameStore.getState().phase === 'round_active',
  isRoundSummary: () => useGameStore.getState().phase === 'round_summary',
  isGameEnd:      () => useGameStore.getState().phase === 'game_end',
} as const;
