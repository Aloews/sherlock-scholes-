// Game-specific types — state machine, phases, events

export type GamePhase =
  | 'idle'           // Home screen, no room
  | 'lobby'          // In room lobby, waiting / team setup
  | 'countdown'      // 3-2-1 animation before round starts
  | 'round_active'   // Timer running, cards being shown
  | 'round_summary'  // Round ended, showing results
  | 'game_end';      // All rounds done, winner declared

export type PlayerRole =
  | 'host'           // Created the room
  | 'explainer'      // Currently describing the card
  | 'guesser'        // Teammate guessing
  | 'spectator';     // Other team watching

export interface CardResult {
  cardId: string;
  playerName: string;
  status: 'correct' | 'skipped';
}

export interface RoundResult {
  roundId: string;
  roundNumber: number;
  teamId: string;
  teamName: string;
  explainerName: string;
  points: number;
  cards: CardResult[];
}

export interface GameError {
  code: string;
  message: string;
}

// For countdown animation
export type CountdownStep = 3 | 2 | 1 | 0;
