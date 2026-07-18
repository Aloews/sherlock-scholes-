import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  IconUsersGroup, IconUser, IconQuestionMark, IconVolume, IconVolumeOff,
  IconCrown, IconLock,
} from '@tabler/icons-react';
import { Button } from '@/shared/ui/Button';
import { Avatar } from '@/shared/ui/Avatar';
import { LanguageToggle } from '@/shared/ui/LanguageToggle';
import { QuoteRotator } from '@/shared/ui/QuoteRotator';
import { useRoom } from '@/features/room/useRoom';
import { useAuthStore } from '@/shared/store/authStore';
import { useGameStore } from '@/shared/store/gameStore';
import { useSettingsStore } from '@/shared/store/settingsStore';
import { useProStore } from '@/shared/store/proStore';
import { usePlayerStats } from '@/features/game/usePlayerStats';
import { countDeck, wakeSupabase } from '@/features/game/cardRandomizer';
import { difficultyFloor, recordQuickGameStart } from '@/features/game/onboarding';
import { trackEvent } from '@/shared/lib/analytics';
import { hapticImpact, cloudGet } from '@/shared/lib/telegram';
import { FRAME_COLOR } from '@/shared/lib/pro';
import {
  ALL_CONTINENT_FILTERS,
  CATEGORY_LABEL_RU,
  CATEGORY_LABEL_EN,
  STAR_TAG,
  type CardCategory,
  type ContinentFilter,
} from '@/shared/types/database';

type View = 'home' | 'mode_select' | 'create_team' | 'create_1v1' | 'create_training' | 'join';

// Variant 2 — a single flat chip picker. Every filter (special tags,
// continents, non-player categories) is a chip; tap to multi-select. Tags are
// player-only and override the category/continent group (selecting a tag clears
// them, mirroring the deck RPC where a tag restricts to those player cards).
// Pro-only tags (legend, ballon_dor) are locked for free users.
const NON_PLAYER_CATEGORIES: CardCategory[] = [
  'club', 'club_nickname', 'stadium', 'coach', 'referee', 'commentator',
  'term', 'position', 'woman',
];

type ChipKind = 'tag' | 'continent' | 'category';
interface Chip {
  id: string;
  kind: ChipKind;
  value: string;            // tag value | continent value | category value
  pro: boolean;             // pro-only (locked for free users)
  labelKey?: string;        // i18n key for tag/continent chips
  cat?: CardCategory;       // set for category chips (label via CATEGORY_LABEL_*)
}

const TAG_CHIPS: Chip[] = [
  { id: 'star',       kind: 'tag', value: STAR_TAG,     pro: false, labelKey: 'home.chip_stars' },
  { id: 'legend',     kind: 'tag', value: 'legend',     pro: true,  labelKey: 'home.pro_filter_legends' },
  { id: 'ballon_dor', kind: 'tag', value: 'ballon_dor', pro: true,  labelKey: 'home.tag_ballon_dor' },
  { id: 'goalkeeper', kind: 'tag', value: 'goalkeeper', pro: false, labelKey: 'home.tag_goalkeeper' },
  { id: 'world_cup',  kind: 'tag', value: 'world_cup',  pro: false, labelKey: 'home.tag_world_cup' },
  { id: 'giant',      kind: 'tag', value: 'giant',      pro: false, labelKey: 'home.tag_giant' },
  { id: 'dwarf',      kind: 'tag', value: 'dwarf',      pro: false, labelKey: 'home.tag_dwarf' },
];
const CONTINENT_CHIPS: Chip[] = ALL_CONTINENT_FILTERS.map((c) => ({
  id: `cont_${c}`, kind: 'continent', value: c, pro: false, labelKey: `home.continent_${c}`,
}));
const CATEGORY_CHIPS: Chip[] = NON_PLAYER_CATEGORIES.map((c) => ({
  id: `cat_${c}`, kind: 'category', value: c, pro: false, cat: c,
}));
const CHIPS: Chip[] = [...TAG_CHIPS, ...CONTINENT_CHIPS, ...CATEGORY_CHIPS];

export function HomeScreen() {
  const navigate = useNavigate();
  const { player } = useAuthStore();
  const { loading, error } = useGameStore();
  const { soundEnabled, setSoundEnabled, proFrame } = useSettingsStore();
  const isPro = useProStore((s) => s.isPro);
  const gamesPlayed = useProStore((s) => s.gamesPlayed);
  const { createRoom, joinRoom } = useRoom();
  const { t, i18n } = useTranslation();
  const { stats, loading: statsLoading } = usePlayerStats(player?.id ?? null);

  useEffect(() => {
    // Telegram WebViews wipe localStorage between launches on some platforms,
    // which re-showed the tutorial every open. CloudStorage is the durable
    // source of truth; localStorage stays as a fast same-launch cache.
    if (localStorage.getItem('sherlock_tutorial_seen') === 'true') return;
    let cancelled = false;
    (async () => {
      const seen = await cloudGet('sherlock_tutorial_seen');
      if (cancelled) return;
      if (seen === 'true') {
        try { localStorage.setItem('sherlock_tutorial_seen', 'true'); } catch { /* private mode */ }
      } else {
        navigate('/tutorial', { replace: true });
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Warm up a possibly-sleeping free-tier DB the moment the home screen opens,
  // so the deck RPC is already hot by the time the player taps Play. Best-effort.
  useEffect(() => { void wakeSupabase(); }, []);

  const [view,      setView]      = useState<View>('home');
  const [code,      setCode]      = useState('');
  const [rounds1v1, setRounds1v1] = useState(3);

  // Chip selection. Default = everything (all continents + all non-player
  // categories, no tags) so Play works immediately; the user narrows from there.
  const [selConts, setSelConts] = useState<Set<ContinentFilter>>(new Set(ALL_CONTINENT_FILTERS));
  const [selCats,  setSelCats]  = useState<Set<CardCategory>>(new Set(NON_PLAYER_CATEGORIES));
  const [selTags,  setSelTags]  = useState<Set<string>>(new Set());
  // false until the player touches any chip. The first TAG tap on the pristine
  // default focuses the deck to just that tag (the old one-tap preset); after
  // that every group combines freely.
  const [touched, setTouched] = useState(false);

  const [deckCount,  setDeckCount]  = useState<number | null>(null);
  // Per-chip standalone counts → grey out empty chips (e.g. "Звёзды" before the
  // star tag is backfilled). null until the one-time load finishes.
  const [chipCounts, setChipCounts] = useState<Record<string, number> | null>(null);

  const handleJoin = async () => {
    if (code.trim().length !== 6) return;
    await joinRoom(code.trim());
  };

  // Hidden admin entrance: 5 quick taps on the hero logo (each ≤600ms after the
  // previous) open the password-gated /admin route. No visible hint.
  const adminTapRef = useRef<{ count: number; last: number }>({ count: 0, last: 0 });
  const handleLogoTap = () => {
    const now = Date.now();
    const { count, last } = adminTapRef.current;
    const next = now - last <= 600 ? count + 1 : 1;
    adminTapRef.current = { count: next, last: now };
    if (next >= 5) {
      adminTapRef.current = { count: 0, last: 0 };
      hapticImpact('medium');
      navigate('/admin');
    }
  };

  const getCatLabel = (cat: CardCategory) =>
    i18n.language === 'en' ? CATEGORY_LABEL_EN[cat] : CATEGORY_LABEL_RU[cat];

  // Every chip group combines freely: tags narrow the PLAYER pool, continents
  // filter players too, non-player categories add their own cards on top (the
  // deck is the union — see pickRandomCards). One ergonomic exception: the
  // first tag tap on the untouched default clears the all-on selection so
  // "Звёзды" still means just stars in one tap. Pro-only tags bounce free
  // users to the Pro screen instead of selecting (and never start a game).
  const toggleTagChip = (chip: Chip) => {
    if (chip.pro && !isPro) { hapticImpact('light'); navigate('/pro'); return; }
    hapticImpact('light');
    if (!touched) {
      setSelConts(new Set());
      setSelCats(new Set());
    }
    setTouched(true);
    setSelTags((prev) => {
      const next = new Set(prev);
      if (next.has(chip.value)) next.delete(chip.value);
      else { next.add(chip.value); trackEvent('category_selected', { kind: chip.pro ? 'pro_tag' : 'tag', value: chip.value }); }
      return next;
    });
  };

  const toggleContinentChip = (value: ContinentFilter) => {
    hapticImpact('light');
    setTouched(true);
    setSelConts((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else { next.add(value); trackEvent('category_selected', { kind: 'continent', value }); }
      return next;
    });
  };

  const toggleCategoryChip = (cat: CardCategory) => {
    hapticImpact('light');
    setTouched(true);
    setSelCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else { next.add(cat); trackEvent('category_selected', { kind: 'category', value: cat }); }
      return next;
    });
  };

  // Deck filter derived from the chip selection. The deck is a UNION of two
  // pools (see pickRandomCards): players — included when any continent OR tag
  // chip is on, filtered by both — plus every selected non-player category.
  const tagList = [...selTags];
  const tagMode = tagList.length > 0;
  const allContinentsOn = selConts.size === ALL_CONTINENT_FILTERS.length;
  const playersOn = selConts.size > 0 || tagMode;
  const everything = !tagMode && allContinentsOn && selCats.size === NON_PLAYER_CATEGORIES.length;
  const selCategories: CardCategory[] | null = everything
    ? null
    : [...(playersOn ? (['player'] as CardCategory[]) : []), ...selCats];
  const selContinents: ContinentFilter[] | null =
    playersOn && selConts.size > 0 && !allContinentsOn ? [...selConts] : null;
  const selMinPageviews = null;
  const deckTags: string[] | null = tagMode ? tagList : null;
  const nothingSelected = !tagMode && selConts.size === 0 && selCats.size === 0;
  const selectedCount = selTags.size + selConts.size + selCats.size;

  // One-time per-chip count to grey out empty chips. Each chip is counted in
  // isolation (its own filter). Errors leave a chip enabled (count -1).
  useEffect(() => {
    if (view !== 'create_training' || chipCounts) return;
    let cancelled = false;
    Promise.all(CHIPS.map(async (chip) => {
      let n = -1;
      try {
        if (chip.kind === 'tag') n = await countDeck(['player'], null, null, [chip.value]);
        else if (chip.kind === 'continent') n = await countDeck(['player'], [chip.value as ContinentFilter], null, null);
        else n = await countDeck([chip.cat as CardCategory], null, null, null);
      } catch { n = -1; }
      return [chip.id, n] as const;
    })).then((entries) => {
      if (!cancelled) setChipCounts(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [view, chipCounts]);

  // Live "Выбрано: N · M карточек" — debounced count of the current selection.
  const filterKey = JSON.stringify(
    { c: selCategories, k: selContinents, p: selMinPageviews, g: deckTags });
  useEffect(() => {
    if (view !== 'create_training') return;
    let cancelled = false;
    setDeckCount(null);
    const handle = setTimeout(() => {
      countDeck(selCategories, selContinents, selMinPageviews, deckTags)
        .then((n) => { if (!cancelled) setDeckCount(n); })
        .catch(() => { if (!cancelled) setDeckCount(null); });
    }, 350);
    return () => { cancelled = true; clearTimeout(handle); };
    // selection captured via filterKey (stable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, view]);

  const startTraining = () => {
    hapticImpact('light');
    // Onboarding difficulty applies ONLY to the broad default quick game (no
    // chip narrowing). If the player picked a specific category/continent/tag,
    // they chose it — give the full pool, no easing.
    const isDefaultGame = everything && !tagMode;
    const difficulty = isDefaultGame ? difficultyFloor(gamesPlayed) : null;
    trackEvent('quick_game_start', {
      preset: deckTags ? 'tags' : (everything ? 'all' : 'custom'),
      players: playersOn,
      categories: selCats.size,
      tags: deckTags?.join(',') ?? '',
      difficulty: difficulty ?? 0,
      games: gamesPlayed,
    });
    void recordQuickGameStart(); // increment AFTER reading the floor for this game
    navigate('/training', {
      state: {
        categories: selCategories,
        continents: selContinents,
        minPageviews: selMinPageviews,
        tags: deckTags,
        difficulty,
      },
    });
  };

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 pt-8">
        <div className="flex items-center gap-2">
          <img
            src="/logo-white-clean.png"
            alt="Шерлок Скоулс"
            className="h-8 w-auto"
          />
          <LanguageToggle />
          <button
            onClick={() => { hapticImpact('light'); navigate('/tutorial'); }}
            aria-label={t('home.tutorial_button_aria')}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-brand-surface border border-brand-border text-brand-muted hover:text-white hover:border-brand-accent transition-colors"
          >
            <IconQuestionMark size={18} stroke={1.5} />
          </button>
          <button
            onClick={() => { hapticImpact('light'); setSoundEnabled(!soundEnabled); }}
            aria-label={t('home.sound_toggle_aria')}
            aria-pressed={soundEnabled}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-brand-surface border border-brand-border text-brand-muted hover:text-white hover:border-brand-accent transition-colors"
          >
            {soundEnabled ? <IconVolume size={16} stroke={2} /> : <IconVolumeOff size={16} stroke={2} />}
          </button>
          <button
            onClick={() => { hapticImpact('light'); navigate('/pro'); }}
            aria-label={t('pro.title')}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-brand-surface border transition-colors hover:text-white"
            style={isPro ? { borderColor: '#FFD24A', color: '#FFD24A' } : undefined}
          >
            <IconCrown size={16} stroke={2} className={isPro ? '' : 'text-brand-muted'} />
          </button>
        </div>
        {player && (
          <span
            className="rounded-full inline-block"
            style={isPro && FRAME_COLOR[proFrame]
              ? { boxShadow: `0 0 0 2px ${FRAME_COLOR[proFrame]}` }
              : undefined}
          >
            <Avatar
              name={`${player.first_name} ${player.last_name ?? ''}`.trim()}
              src={player.avatar_url}
              size="md"
            />
          </span>
        )}
      </div>

      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-8">
        <div className="text-center space-y-3 flex flex-col items-center">
          <img
            src="/logo-white-clean.png"
            alt="Шерлок Скоулс"
            className="w-[220px] max-w-full h-auto"
            onClick={handleLogoTap}
            draggable={false}
          />
          <p className="text-brand-muted text-lg">{t('home.subtitle')}</p>
        </div>

        {/* Player stats — main view only */}
        {view === 'home' && !statsLoading && (
          <div className="w-full max-w-sm">
            <p className="text-brand-muted text-xs text-center mb-2 uppercase tracking-wider">
              {t('stats.title')}
            </p>
            {stats ? (
              <div className="bg-brand-surface rounded-2xl border border-brand-border p-3">
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    { label: t('stats.games'), value: stats.games_played },
                    { label: t('stats.wins'),  value: stats.games_won },
                    { label: t('stats.cards'), value: stats.cards_guessed },
                    { label: t('stats.score'), value: stats.total_score },
                  ].map((item) => (
                    <div key={item.label}>
                      <p className="text-white font-bold text-lg leading-none">{item.value}</p>
                      <p className="text-brand-muted text-xs mt-1">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-brand-surface/50 rounded-2xl border border-brand-border/50 p-3 text-center">
                <p className="text-brand-muted/70 text-sm">{t('stats.first_game')}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Main CTA: Quick game first, then competitive, then join ── */}
        {view === 'home' && (
          <div className="w-full max-w-sm space-y-3 animate-fade-in">
            <Button fullWidth size="lg" onClick={() => { hapticImpact('light'); setView('create_training'); }}>
              {t('home.mode_training_title')}
            </Button>
            <Button fullWidth size="lg" variant="secondary" onClick={() => { hapticImpact('light'); setView('mode_select'); }}>
              {t('home.competitive_mode')}
            </Button>
            <Button fullWidth size="lg" variant="secondary" onClick={() => { hapticImpact('light'); setView('join'); }}>
              {t('home.join_game')}
            </Button>
          </div>
        )}

        {/* ── Competitive mode: team game or 1v1 ── */}
        {view === 'mode_select' && (
          <div className="w-full max-w-sm space-y-3 animate-slide-up">
            <p className="text-brand-muted text-xs text-center uppercase tracking-wider mb-1">
              {t('home.competitive_mode')}
            </p>

            {/* Team game */}
            <button
              className="w-full bg-brand-surface border border-brand-border rounded-2xl p-5 text-left hover:border-brand-accent transition-colors"
              onClick={() => { hapticImpact('light'); setView('create_team'); }}
            >
              <div className="flex items-start gap-4">
                <div className="mt-0.5 text-brand-accent flex-shrink-0">
                  <IconUsersGroup size={28} stroke={1.5} />
                </div>
                <div>
                  <p className="text-white font-bold">{t('home.mode_team_title')}</p>
                  <p className="text-brand-muted text-sm mt-0.5">{t('home.mode_team_desc')}</p>
                </div>
              </div>
            </button>

            {/* 1v1 */}
            <button
              className="w-full bg-brand-surface border border-brand-border rounded-2xl p-5 text-left hover:border-brand-accent transition-colors"
              onClick={() => { hapticImpact('light'); setView('create_1v1'); }}
            >
              <div className="flex items-start gap-4">
                <div className="mt-0.5 text-brand-accent flex-shrink-0">
                  <IconUser size={28} stroke={1.5} />
                </div>
                <div>
                  <p className="text-white font-bold">{t('home.mode_1v1_title')}</p>
                  <p className="text-brand-muted text-sm mt-0.5">{t('home.mode_1v1_desc')}</p>
                </div>
              </div>
            </button>

            <Button fullWidth variant="ghost" onClick={() => { hapticImpact('light'); setView('home'); }}>
              {t('home.back')}
            </Button>
          </div>
        )}

        {/* ── Team game settings ── */}
        {view === 'create_team' && (
          <div className="w-full max-w-sm space-y-4 animate-slide-up">
            <div className="bg-brand-surface rounded-2xl p-4 border border-brand-border space-y-2">
              <p className="text-brand-muted text-sm">{t('home.game_settings')}</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label: t('home.setting_rounds'), value: '3' },
                  { label: t('home.setting_cards'),  value: '5' },
                  { label: t('home.setting_time'),   value: '60s' },
                ].map((s) => (
                  <div key={s.label} className="bg-brand-border rounded-xl p-2">
                    <p className="text-white font-bold">{s.value}</p>
                    <p className="text-brand-muted text-xs">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
            <Button fullWidth size="lg" loading={loading} onClick={() => createRoom()}>
              {t('home.create_room')}
            </Button>
            <Button fullWidth variant="ghost" onClick={() => { hapticImpact('light'); setView('mode_select'); }}>
              {t('home.back')}
            </Button>
          </div>
        )}

        {/* ── 1v1 settings ── */}
        {view === 'create_1v1' && (
          <div className="w-full max-w-sm space-y-4 animate-slide-up">
            <div className="bg-brand-surface rounded-2xl p-4 border border-brand-border space-y-4">
              <p className="text-brand-muted text-sm">{t('home.game_settings')}</p>
              <div>
                <p className="text-white text-sm font-medium mb-2">{t('home.setting_rounds')}</p>
                <div className="grid grid-cols-3 gap-2">
                  {[3, 5, 7].map((n) => (
                    <button
                      key={n}
                      className={`rounded-xl py-2 text-center font-bold transition-colors ${
                        rounds1v1 === n
                          ? 'bg-brand-accent text-brand-bg'
                          : 'bg-brand-border text-white hover:bg-brand-border/70'
                      }`}
                      onClick={() => { hapticImpact('light'); setRounds1v1(n); }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <p className="text-brand-muted/60 text-xs mt-2">{t('home.setting_rounds_1v1_hint')}</p>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-brand-muted">{t('home.setting_time')}</span>
                <span className="text-white">60s</span>
              </div>
            </div>
            <Button fullWidth size="lg" loading={loading} onClick={() => createRoom({ total_rounds: rounds1v1 }, '1v1')}>
              {t('home.create_room')}
            </Button>
            <Button fullWidth variant="ghost" onClick={() => { hapticImpact('light'); setView('mode_select'); }}>
              {t('home.back')}
            </Button>
          </div>
        )}

        {/* ── Quick game: chip picker (Variant 2) ── */}
        {view === 'create_training' && (
          <div className="w-full max-w-sm space-y-4 animate-slide-up">
            <div className="flex flex-wrap gap-2">
              {CHIPS.map((chip) => {
                const empty = !!chipCounts && (chipCounts[chip.id] ?? 0) === 0;
                const locked = chip.pro && !isPro;
                const active =
                  chip.kind === 'tag'       ? selTags.has(chip.value)
                  : chip.kind === 'continent' ? selConts.has(chip.value as ContinentFilter)
                  : selCats.has(chip.cat as CardCategory);
                const label = chip.cat ? getCatLabel(chip.cat) : t(chip.labelKey as string);
                // Empty chips grey out (no "звёзды 0"); a pro-locked chip stays
                // tappable so free users can reach the Pro screen.
                const disabled = empty && !locked;
                const handleClick = () => {
                  if (disabled) return;
                  if (chip.kind === 'tag') toggleTagChip(chip);
                  else if (chip.kind === 'continent') toggleContinentChip(chip.value as ContinentFilter);
                  else toggleCategoryChip(chip.cat as CardCategory);
                };
                return (
                  <button
                    key={chip.id}
                    disabled={disabled}
                    onClick={handleClick}
                    className={`inline-flex items-center gap-1 px-3 py-2 rounded-full text-xs font-medium border transition-colors ${
                      active
                        ? 'border-transparent text-white'
                        : 'border-brand-border bg-brand-border/40 text-brand-muted hover:text-white'
                    } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                    style={active ? { backgroundColor: '#FF6300' } : undefined}
                  >
                    {locked && <IconLock size={11} stroke={2.5} style={{ color: '#FFD24A' }} />}
                    <span className="truncate">{label}</span>
                    {chip.pro && !locked && <span style={{ color: '#FFD24A' }}>★</span>}
                  </button>
                );
              })}
            </div>

            {/* Live counter: selected chips · matching cards */}
            <p className="text-center text-sm text-brand-muted">
              {deckCount === null
                ? t('home.counting')
                : t('home.selected_chips', { n: selectedCount, m: deckCount })}
            </p>

            <Button
              fullWidth
              size="lg"
              disabled={nothingSelected || deckCount === 0}
              onClick={startTraining}
            >
              {t('home.create_room')}
            </Button>
            <Button fullWidth variant="ghost" onClick={() => { hapticImpact('light'); setView('home'); }}>
              {t('home.back')}
            </Button>
          </div>
        )}

        {/* ── Join ── */}
        {view === 'join' && (
          <div className="w-full max-w-sm space-y-4 animate-slide-up">
            <div className="space-y-2">
              <label className="text-brand-muted text-sm font-medium">
                {t('home.room_code_label')}
              </label>
              <input
                type="text"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder={t('home.room_code_placeholder')}
                className="w-full h-14 bg-brand-surface border border-brand-border rounded-2xl px-4 text-white text-2xl font-black tracking-[0.5em] text-center uppercase placeholder-brand-muted/50 focus:outline-none focus:border-brand-accent transition-colors"
                autoFocus
              />
            </div>
            <Button fullWidth size="lg" loading={loading} disabled={code.length !== 6} onClick={handleJoin}>
              {t('home.join_room')}
            </Button>
            <Button fullWidth variant="ghost" onClick={() => { hapticImpact('light'); setCode(''); setView('home'); }}>
              {t('home.back')}
            </Button>
          </div>
        )}

        {error && (
          <div className="w-full max-w-sm bg-red-500/10 border border-red-500/30 rounded-2xl p-3 text-center">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}
      </div>

      <div className="px-6 pt-2 pb-6 space-y-4">
        <QuoteRotator />
        <p className="text-brand-muted/40 text-xs text-center">{t('home.footer')}</p>
      </div>
    </div>
  );
}
