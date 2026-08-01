import { describe, it, expect, beforeEach, vi } from 'vitest';
import fc from 'fast-check';
import {
  transition,
  forceTransition,
  getCurrentPhase,
  GameGuards,
} from './stateMachine';
import { useGameStore } from '@/shared/store/gameStore';
import type { GamePhase } from '@/shared/types/game';

const ALL_PHASES: GamePhase[] = [
  'idle',
  'lobby',
  'countdown',
  'round_active',
  'round_summary',
  'game_end',
];

// Authoritative transition table, mirrored from stateMachine.ts. Kept here so a
// mutation to the production table (e.g. dropping an allowed edge or adding an
// illegal one) is caught by the exhaustive cross-check below.
const ALLOWED: Record<GamePhase, GamePhase[]> = {
  idle: ['lobby'],
  lobby: ['idle', 'countdown'],
  countdown: ['round_active', 'idle'],
  round_active: ['round_summary', 'game_end'],
  round_summary: ['countdown', 'round_active', 'game_end'],
  game_end: ['idle'],
};

beforeEach(() => {
  forceTransition('idle');
});

describe('transition — allowed edges', () => {
  it('performs every legal transition in the table', () => {
    for (const from of ALL_PHASES) {
      for (const to of ALLOWED[from]) {
        forceTransition(from);
        transition(to);
        expect(getCurrentPhase()).toBe(to);
      }
    }
  });
});

describe('transition — illegal edges are refused', () => {
  it('never changes phase on a disallowed transition', () => {
    for (const from of ALL_PHASES) {
      const illegal = ALL_PHASES.filter((p) => !ALLOWED[from].includes(p));
      for (const to of illegal) {
        forceTransition(from);
        transition(to);
        expect(getCurrentPhase()).toBe(from);
      }
    }
  });
});

describe('transition — diagnostics', () => {
  it('warns with the offending edge when a transition is refused (dev)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    forceTransition('idle');
    transition('game_end'); // illegal
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0][0])).toContain('Invalid transition');
    expect(String(warn.mock.calls[0][0])).toContain('idle');
    expect(String(warn.mock.calls[0][0])).toContain('game_end');
    warn.mockRestore();
  });

  it('does not warn on a legal transition', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    forceTransition('idle');
    transition('lobby'); // legal
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('forceTransition', () => {
  it('sets any phase unconditionally', () => {
    forceTransition('game_end');
    expect(getCurrentPhase()).toBe('game_end');
    forceTransition('round_active');
    expect(getCurrentPhase()).toBe('round_active');
  });
});

describe('GameGuards', () => {
  it('reports exactly the current phase as active', () => {
    const guardFor: Record<GamePhase, () => boolean> = {
      idle: GameGuards.isIdle,
      lobby: GameGuards.isInLobby,
      countdown: GameGuards.isCountdown,
      round_active: GameGuards.isRoundActive,
      round_summary: GameGuards.isRoundSummary,
      game_end: GameGuards.isGameEnd,
    };
    for (const phase of ALL_PHASES) {
      forceTransition(phase);
      for (const p of ALL_PHASES) {
        expect(guardFor[p]()).toBe(p === phase);
      }
    }
  });
});

describe('state machine — properties (fast-check)', () => {
  it('any sequence of transitions keeps phase within the known set and never makes an illegal jump', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(...ALL_PHASES), { maxLength: 50 }),
        (targets) => {
          forceTransition('idle');
          for (const to of targets) {
            const before = getCurrentPhase();
            transition(to);
            const after = getCurrentPhase();
            expect(ALL_PHASES).toContain(after);
            // Phase either stayed put or followed a declared edge — never a jump.
            if (after !== before) {
              expect(ALLOWED[before]).toContain(after);
            }
          }
        },
      ),
    );
  });
});

// Keep zustand store isolated between files.
beforeEach(() => {
  useGameStore.setState({ phase: 'idle' });
});
