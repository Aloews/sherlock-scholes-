// Mirror of Supabase schema v2 — generic card deck

export type CardCategory =
  | 'player'
  | 'club'
  | 'term'
  | 'referee'
  | 'coach'
  | 'stadium'
  | 'club_nickname'
  | 'commentator'
  | 'position'
  | 'woman';

export const ALL_CATEGORIES: CardCategory[] = [
  'player', 'club', 'term', 'referee', 'coach',
  'stadium', 'club_nickname', 'commentator', 'position', 'woman',
];

export const CATEGORY_LABEL_RU: Record<CardCategory, string> = {
  player:        'Игроки',
  club:          'Клубы',
  term:          'Термины',
  referee:       'Судьи',
  coach:         'Тренеры',
  stadium:       'Стадионы',
  club_nickname: 'Прозвища клубов',
  commentator:   'Комментаторы',
  position:      'Позиции',
  woman:         'Женщины',
};

export const CATEGORY_EMOJI: Record<CardCategory, string> = {
  player:        '⚽',
  club:          '🏟️',
  term:          '📖',
  referee:       '🟨',
  coach:         '👔',
  stadium:       '🏟️',
  club_nickname: '🎭',
  commentator:   '🎙️',
  position:      '📍',
  woman:         '⚽',
};

// ─── Entities ────────────────────────────────────────────────

export interface Player {
  id: number; // Telegram user ID (bigint)
  username: string | null;
  first_name: string;
  last_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface RoomSettings {
  round_seconds: number;
  cards_per_round: number;
  total_rounds: number;
  categories: CardCategory[] | null; // null = all categories
}

export interface Room {
  id: string;
  code: string;
  host_id: number;
  status: 'waiting' | 'playing' | 'finished';
  settings: RoomSettings;
  current_round_id: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface Team {
  id: string;
  room_id: string;
  name: string;
  color: string;
  created_at: string;
}

export interface RoomPlayer {
  id: string;
  room_id: string;
  player_id: number;
  team_id: string | null;
  is_ready: boolean;
  joined_at: string;
  player?: Player;
}

// Generic card — covers all 10 categories from sherlock_cards.csv
export interface Card {
  id: string;
  name: string;
  category: CardCategory;
  category_ru: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  forbidden_words: string[];
  active: boolean;
  created_at: string;
}

export interface Round {
  id: string;
  room_id: string;
  team_id: string;
  explainer_id: number | null;
  round_number: number;
  status: 'pending' | 'active' | 'completed';
  started_at: string | null;
  ended_at: string | null;
  time_seconds: number;
}

export interface RoundCard {
  id: string;
  round_id: string;
  card_id: string;          // was football_player_id
  status: 'pending' | 'correct' | 'skipped';
  card_order: number;
  decided_at: string | null;
  card?: Card;              // joined via .select('*, card:cards(*)')
}

export interface Score {
  id: string;
  room_id: string;
  team_id: string;
  round_id: string;
  points: number;
  created_at: string;
}

export interface TeamScore {
  team_id: string;
  team_name: string;
  total_points: number;
  color: string;
}

export interface PlayerStats {
  player_id: number;
  games_played: number;
  games_won: number;
  cards_guessed: number;
  total_score: number;
  updated_at: string;
}
