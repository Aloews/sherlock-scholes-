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

export const CATEGORY_LABEL_EN: Record<CardCategory, string> = {
  player:        'Players',
  club:          'Clubs',
  term:          'Terms',
  referee:       'Referees',
  coach:         'Coaches',
  stadium:       'Stadiums',
  club_nickname: 'Club Nicknames',
  commentator:   'Commentators',
  position:      'Positions',
  woman:         'Women in Football',
};

export const CATEGORY_LABEL_RU: Record<CardCategory, string> = {
  player:        'Игроки',
  club:          'Клубы',
  term:          'Термины',
  referee:       'Судьи',
  coach:         'Тренеры',
  stadium:       'Стадионы',
  club_nickname: 'Прозвища',
  commentator:   'Комментаторы',
  position:      'Позиции',
  woman:         'Женщины',
};

// ─── Player continents ───────────────────────────────────────
// cards.continent values (players only; other categories keep NULL).
// 'other' is NOT a column value — it's the UI/RPC sentinel for
// continent IS NULL ("Прочие"). See supabase/migrations/continents_filter.sql.

export type Continent =
  | 'europe'
  | 'south_america'
  | 'africa'
  | 'asia'
  | 'north_america';

export type ContinentFilter = Continent | 'other';

export const ALL_CONTINENT_FILTERS: ContinentFilter[] = [
  'europe', 'south_america', 'africa', 'asia', 'north_america', 'other',
];

// ─── Difficulty (dormant) ────────────────────────────────────
// The UI switch was removed — the game always plays the whole deck
// (p_min_pageviews = null). Thresholds and the cards.pageviews column are
// kept as data for possible future use:
//   novice → only world-famous cards   (pageviews > 19000)
//   fan    → well-known, top-level pool (pageviews > 3000)
//   expert → the entire deck, no threshold (null)
// With a threshold set, cards with NULL pageviews are EXCLUDED by
// pick_random_cards (see supabase/migrations/difficulty_levels.sql).

export type Difficulty = 'novice' | 'fan' | 'expert';

export const PAGEVIEWS_THRESHOLD: Record<Difficulty, number | null> = {
  novice: 19000,
  fan:    3000,
  expert: null,
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

export type GameMode = 'team' | '1v1';

export interface Room {
  id: string;
  code: string;
  host_id: number;
  status: 'waiting' | 'playing' | 'finished';
  mode: GameMode;
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

// Card-name translation (card_translations table, docs/card_translations.sql).
// Fallback chain when displaying: translation -> name_en -> name.
export interface CardTranslation {
  card_id: string;
  lang: string;           // 'es' | 'pt' | 'fr' | 'zh' | 'ja' | 'ko' | 'ar'
  name: string;
  source?: string | null; // 'sitelink' | 'label' | 'name_en'
}

// One club + summed minutes from the collected seasons (cards.clubs_minutes,
// docs/cards_fill_clubs_minutes.sql). NOT a full career — only our seasons.
export interface ClubMinutes {
  club: string;
  minutes: number;
}

// Career snapshot for legends from Wikidata (cards.legend_career,
// docs/cards_legend_career_column.sql). clubs carry years, not minutes.
export interface LegendClub {
  club: string;
  years: string; // "1984–1991" | "1984–"
}
export interface LegendCareer {
  clubs: LegendClub[];
  position?: string | null;
  titles?: string[] | null; // short prestige titles, e.g. ["Золотой мяч ×3", "ЧМ 1998"]
}

// Generic card — covers all 10 categories from sherlock_cards.csv
export interface Card {
  id: string;
  name: string;
  name_en: string | null; // English display name; null for old cards — fall back to `name`
  category: CardCategory;
  category_ru: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  forbidden_words: string[];
  pageviews: number | null; // Wikipedia pageviews; null for non-player cards
  photo_url: string | null; // Commons photo (players); null = no photo
  continent?: Continent | null; // players only; absent until continents_filter.sql runs
  country?: string | null;      // ISO code for the flag (GB-ENG etc.); absent until cards_country_column.sql runs
  position_ru?: string | null;  // Вратарь/Защитник/Полузащитник/Нападающий; absent until cards_position_column.sql runs
  top_club?: string | null;     // club of the max-minutes season (players); absent until cards_fill_top_club.sql runs
  top_minutes?: number | null;  // minutes of that season
  clubs_minutes?: ClubMinutes[] | null; // top clubs by summed minutes; absent until cards_fill_clubs_minutes.sql runs
  legend_career?: LegendCareer | null;  // legends (no API minutes): clubs with years; absent until cards_legend_career_column.sql runs
  card_translations?: CardTranslation[] | null; // embedded via select('*, card_translations(*)') or merged in code
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
