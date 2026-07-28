// Player level — derived from player_stats.xp, never stored.
//
// level = floor(sqrt(xp / 100)) + 1, i.e. xpForLevel(L) = (L - 1)² * 100.
// Quadratic on purpose: each level costs more xp than the last, matching the
// progress bar in the prototype (docs/PROGRESSION_FEATURES_HANDOFF.md §1.3).
// xp itself is only ever incremented server-side — see
// supabase/migrations/player_progression_xp.sql.

export function levelFromXp(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 100)) + 1;
}

export function xpForLevel(level: number): number {
  return Math.pow(Math.max(1, level) - 1, 2) * 100;
}

export interface LevelProgress {
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number; // span of the current level, in xp
  pct: number;            // 0–100, how far into the current level
}

export function levelProgress(xp: number): LevelProgress {
  const level = levelFromXp(xp);
  const floor = xpForLevel(level);
  const span  = xpForLevel(level + 1) - floor;
  const into  = xp - floor;
  return {
    level,
    xpIntoLevel: into,
    xpForNextLevel: span,
    pct: span > 0 ? Math.min(100, Math.round((into / span) * 100)) : 100,
  };
}

// Rank title by level range — a plain code-side lookup + i18n key, not a DB
// table (see handoff §1.4). Ranges are checked highest-first.
const TITLE_RANGES: { minLevel: number; i18nKey: string }[] = [
  { minLevel: 20, i18nKey: 'level.title_20' },
  { minLevel: 15, i18nKey: 'level.title_15' },
  { minLevel: 10, i18nKey: 'level.title_10' },
  { minLevel: 5,  i18nKey: 'level.title_5' },
  { minLevel: 1,  i18nKey: 'level.title_1' },
];

export function levelTitleKey(level: number): string {
  return (TITLE_RANGES.find((r) => level >= r.minLevel) ?? TITLE_RANGES[TITLE_RANGES.length - 1]).i18nKey;
}
