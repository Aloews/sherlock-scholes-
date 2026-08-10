// The room's deck, chosen in the lobby.
//
// The controls are the picker's own — OptionRow, Chip, SelectRow — because a
// fourth way of saying "this one is selected" is exactly what the design
// system exists to prevent. What is different here is WHO may touch them: the
// host edits, everyone else reads. A guest still needs to see the deck, or
// they find out what they are playing when the first card lands.
//
// Collapsed by default. The lobby's job is to get four people into two teams,
// and a wall of chips above the team grid gets in the way of that; the summary
// line says what the deck is in one line, and the host opens it to change it.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chip } from '@/shared/ui/Chip';
import { OptionRow } from '@/shared/ui/OptionRow';
import { SelectRow } from '@/shared/ui/SelectRow';
import { hapticImpact } from '@/shared/lib/telegram';
import { fetchSquads, formatSquadAsOf, type Squad } from '@/features/game/squads';
import { isWholeDeck } from '@/features/room/roomDeck';
import { IconChevronDown } from '@tabler/icons-react';
import type { CardCategory } from '@/shared/types/database';
import {
  CATEGORY_GROUPS, DECK_LEAGUES, FAME_LEVELS, FAME_MIN, NON_PLAYER_CATEGORIES,
  type DeckFilter, type FameLevel,
} from '@/shared/types/deck';

interface Props {
  filter: DeckFilter;
  /** From count_deck — the RPC the deal itself uses. null = still counting. */
  count: number | null;
  isHost: boolean;
  /** True when the last write to the room failed; the chips are then a lie. */
  failed: boolean;
  onChange: (filter: DeckFilter) => void;
}

/** The fame step a stored floor corresponds to. Floors between steps round
 *  DOWN, so a deck is never described as stricter than it is. */
export function fameLevelOf(min: number | null | undefined): FameLevel {
  const n = min ?? 0;
  if (n >= FAME_MIN.famous) return 'famous';
  if (n >= FAME_MIN.known) return 'known';
  return 'any';
}

/** The categories the filter selects, as the two controls express them:
 *  a players toggle and the non-player groups. */
export function readCategories(
  filter: DeckFilter,
): { players: boolean; others: Set<CardCategory> } {
  const cats = filter.categories;
  // Absent means every category — which is what both controls fully on mean.
  if (!cats) return { players: true, others: new Set(NON_PLAYER_CATEGORIES) };
  return {
    players: cats.includes('player'),
    others:  new Set(NON_PLAYER_CATEGORIES.filter((c) => cats.includes(c))),
  };
}

/** …and back. `null` rather than the full list when everything is on, so the
 *  stored filter says "the whole deck" instead of enumerating it — the two
 *  deal identically, and only one of them survives a new category being
 *  added to the game. */
export function writeCategories(
  players: boolean,
  others: Set<CardCategory>,
): CardCategory[] | null {
  if (players && others.size === NON_PLAYER_CATEGORIES.length) return null;
  return [
    ...(players ? (['player'] as CardCategory[]) : []),
    ...NON_PLAYER_CATEGORIES.filter((c) => others.has(c)),
  ];
}

export function RoomDeckPanel({ filter, count, isHost, failed, onChange }: Props) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [squads, setSquads] = useState<Squad[]>([]);

  // Only the host can pick one, and only once the panel is open — the list is
  // an RPC, and every guest in every lobby fetching it buys nothing.
  useEffect(() => {
    if (!open || !isHost || squads.length) return;
    let cancelled = false;
    void fetchSquads().then((s) => { if (!cancelled) setSquads(s); });
    return () => { cancelled = true; };
  }, [open, isHost, squads.length]);

  const { players, others } = readCategories(filter);
  const league = filter.leagues?.[0] ?? '';
  const club   = filter.clubs?.[0] ?? '';
  const fame   = fameLevelOf(filter.fame_min);

  const clubName = squads.find((s) => s.key === club)?.name ?? club;
  const leagueLabel = league ? t(`league.${league}`, { defaultValue: league }) : '';

  // ── The one-line summary ───────────────────────────────────────────
  const parts: string[] = [];
  if (isWholeDeck(filter)) {
    parts.push(t('lobby.deck_everything'));
  } else {
    if (club) parts.push(clubName);
    else if (league) parts.push(leagueLabel);
    if (fame !== 'any') parts.push(t(`home.fame_${fame}`));
    if (!players) parts.push(t('lobby.deck_no_players'));
    else if (others.size === 0) parts.push(t('category.player'));
    else if (others.size < NON_PLAYER_CATEGORIES.length) {
      parts.push(t('lobby.deck_categories', { count: others.size + 1 }));
    }
    if (parts.length === 0) parts.push(t('lobby.deck_everything'));
  }

  // ── Edits ──────────────────────────────────────────────────────────
  const patch = (next: Partial<DeckFilter>) => onChange({ ...filter, ...next });

  const togglePlayers = () => {
    const nextPlayers = !players;
    // Turning players off takes the player-shaped narrowings with it, so a
    // clubs-and-stadiums deck is never silently shrunk by a league nobody can
    // see any more. Same rule the picker follows.
    patch(nextPlayers
      ? { categories: writeCategories(true, others) }
      : { categories: writeCategories(false, others), leagues: null, clubs: null });
  };

  const toggleGroup = (cats: CardCategory[]) => {
    const next = new Set(others);
    const anyOn = cats.some((c) => next.has(c));
    cats.forEach((c) => (anyOn ? next.delete(c) : next.add(c)));
    patch({ categories: writeCategories(players, next) });
  };

  // Picking a squad means the squad: the predicate narrows players and lets
  // every other category through, so without this a club choice would deal
  // twenty-three Arsenal players among four hundred club cards.
  const pickClub = (key: string) =>
    patch({ clubs: key ? [key] : null, categories: key ? (['player'] as CardCategory[]) : filter.categories ?? null });

  const pickLeague = (lg: string) => patch({ leagues: lg ? [lg] : null });

  const nothingSelected = Array.isArray(filter.categories) && filter.categories.length === 0;

  return (
    <div className="ds-panel bg-brand-surface rounded-2xl border border-brand-border overflow-hidden">
      <button
        className="w-full px-4 py-3 flex items-center gap-3 text-left active:opacity-70"
        onClick={() => { hapticImpact('light'); setOpen((v) => !v); }}
        aria-expanded={open}
        disabled={!isHost}
      >
        <div className="flex-1 min-w-0">
          <p className="text-brand-muted text-xs">{t('lobby.deck_title')}</p>
          <p className="text-white text-sm font-semibold truncate">{parts.join(' · ')}</p>
        </div>
        <span className="text-xs tabular-nums text-brand-muted shrink-0" aria-live="polite">
          {count === null ? '…' : t('lobby.deck_count', { count })}
        </span>
        {isHost && (
          <IconChevronDown
            size={16} stroke={2}
            className={`text-brand-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        )}
      </button>

      {failed && (
        <p className="px-4 pb-2 text-xs text-red-400">{t('lobby.deck_save_failed')}</p>
      )}
      {(count === 0 || nothingSelected) && (
        <p className="px-4 pb-2 text-xs text-red-400">{t('lobby.deck_empty')}</p>
      )}

      {open && isHost && (
        <div className="px-4 pb-4 space-y-3 border-t border-brand-border pt-3 animate-fade-in">
          <OptionRow
            leading="⚽"
            title={t('category.player')}
            description={t('home.who_players_desc')}
            selected={players}
            onClick={togglePlayers}
          />

          {CATEGORY_GROUPS.map((group) => {
            const on = group.categories.filter((c) => others.has(c)).length;
            return (
              <button
                key={group.id}
                onClick={() => { hapticImpact('light'); toggleGroup(group.categories); }}
                className="w-full flex items-center justify-between active:opacity-70"
              >
                <span className="text-white text-sm">{t(group.labelKey)}</span>
                <span className={`text-xs tabular-nums rounded-full px-2 py-0.5 border ${
                  on ? 'border-brand-accent/40 text-white bg-brand-accent/10'
                     : 'border-brand-border text-brand-muted'
                }`}>
                  {on}/{group.categories.length}
                </span>
              </button>
            );
          })}

          <div className="flex flex-wrap gap-1.5">
            {FAME_LEVELS.map((level) => (
              <Chip
                key={level}
                label={t(`home.fame_${level}`)}
                selected={fame === level}
                onClick={() => { hapticImpact('light'); patch({ fame_min: FAME_MIN[level] }); }}
              />
            ))}
          </div>

          {/* Player-shaped, so they are offered only when players are in. */}
          {players && (
            <div className="space-y-2">
              <SelectRow
                label={t('home.filter_all_leagues')}
                value={league}
                onChange={pickLeague}
                options={DECK_LEAGUES.map((lg) => ({
                  value: lg, label: t(`league.${lg}`, { defaultValue: lg }),
                }))}
              />
              {!!squads.length && (
                <SelectRow
                  label={t('home.filter_all_squads')}
                  value={club}
                  onChange={pickClub}
                  options={squads.map((s) => ({ value: s.key, label: `${s.name} · ${s.players}` }))}
                />
              )}
              {/* Says how old this is, every time — the squad is the club a
                  player had not left when their article was last read, so a
                  transfer from last week is not in it. */}
              {!!club && (
                <p className="text-[10.5px] text-brand-muted px-1">
                  {t('home.squad_as_of', {
                    date: formatSquadAsOf(
                      squads.find((s) => s.key === club)?.asOf ?? null,
                      i18n.language,
                    ),
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
