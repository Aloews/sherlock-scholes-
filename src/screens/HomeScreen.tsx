import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  IconUsersGroup, IconUser, IconQuestionMark, IconVolume, IconVolumeOff,
  IconChevronDown,
} from '@tabler/icons-react';
import { Button } from '@/shared/ui/Button';
import { Avatar } from '@/shared/ui/Avatar';
import { LanguageToggle } from '@/shared/ui/LanguageToggle';
import { QuoteRotator } from '@/shared/ui/QuoteRotator';
import { useRoom } from '@/features/room/useRoom';
import { useAuthStore } from '@/shared/store/authStore';
import { useGameStore } from '@/shared/store/gameStore';
import { useSettingsStore } from '@/shared/store/settingsStore';
import { usePlayerStats } from '@/features/game/usePlayerStats';
import { countDeck, wakeSupabase } from '@/features/game/cardRandomizer';
import { trackEvent } from '@/shared/lib/analytics';
import { hapticImpact } from '@/shared/lib/telegram';
import {
  ALL_CONTINENT_FILTERS,
  CATEGORY_LABEL_RU,
  CATEGORY_LABEL_EN,
  PAGEVIEWS_THRESHOLD,
  type CardCategory,
  type ContinentFilter,
} from '@/shared/types/database';

type View = 'home' | 'mode_select' | 'create_team' | 'create_1v1' | 'create_training' | 'join';

// "Только звёзды" floor — the famous-players pageviews threshold.
const STAR_MIN_PAGEVIEWS = PAGEVIEWS_THRESHOLD.novice ?? 19000;

// Accordion groups of the quick-game picker. "players" is special (it expands
// into continents); the rest list plain categories. A category that does not
// exist in the DB yet simply contributes an empty slice — nothing crashes,
// the live counter just shows fewer cards.
type GroupId = 'players' | 'clubs' | 'people' | 'knowledge';
const CAT_GROUPS: { id: Exclude<GroupId, 'players'>; cats: CardCategory[] }[] = [
  { id: 'clubs',     cats: ['club', 'club_nickname', 'stadium'] },
  { id: 'people',    cats: ['coach', 'referee', 'commentator'] },
  { id: 'knowledge', cats: ['term', 'position', 'woman'] },
];
const NON_PLAYER_CATEGORIES: CardCategory[] = CAT_GROUPS.flatMap((g) => g.cats);
const CLUBS_ONLY_CATS: CardCategory[] = ['club', 'club_nickname', 'stadium'];

type PresetId = 'all' | 'stars' | 'clubs_only' | 'world';
const PRESETS: PresetId[] = ['all', 'stars', 'clubs_only', 'world'];

const sameMembers = (set: Set<string>, arr: readonly string[]) =>
  set.size === arr.length && arr.every((x) => set.has(x));

/** Checkbox row shared by the quick-game accordion items. */
function CheckRow({ active, label, onToggle }: {
  active: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-colors text-left ${
        active ? 'bg-brand-accent/15 text-white' : 'bg-brand-border text-brand-muted'
      }`}
      onClick={() => { hapticImpact('light'); onToggle(); }}
    >
      <span
        className={`w-3.5 h-3.5 rounded flex-shrink-0 flex items-center justify-center text-[10px] font-bold ${
          active ? 'bg-brand-accent text-brand-bg' : 'bg-brand-muted/30'
        }`}
      >
        {active ? '✓' : ''}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

export function HomeScreen() {
  const navigate = useNavigate();
  const { player } = useAuthStore();
  const { loading, error } = useGameStore();
  const { soundEnabled, setSoundEnabled } = useSettingsStore();
  const { createRoom, joinRoom } = useRoom();
  const { t, i18n } = useTranslation();
  const { stats, loading: statsLoading } = usePlayerStats(player?.id ?? null);

  useEffect(() => {
    if (localStorage.getItem('sherlock_tutorial_seen') !== 'true') {
      navigate('/tutorial', { replace: true });
    }
  }, []);

  // Warm up a possibly-sleeping free-tier DB the moment the home screen opens,
  // so the deck RPC is already hot by the time the player taps Play. Best-effort.
  useEffect(() => { void wakeSupabase(); }, []);

  const [view,            setView]            = useState<View>('home');
  const [code,            setCode]            = useState('');
  const [rounds1v1,       setRounds1v1]       = useState(3);
  // Quick game picker. Default = preset "Всё": every continent + every
  // non-player category, no star floor.
  const [trainingContinents, setTrainingContinents] =
    useState<Set<ContinentFilter>>(new Set(ALL_CONTINENT_FILTERS));
  const [trainingCats, setTrainingCats] =
    useState<Set<CardCategory>>(new Set(NON_PLAYER_CATEGORIES));
  const [starMode, setStarMode] = useState(false);
  const [openGroup, setOpenGroup] = useState<GroupId | null>(null);
  const [deckCount, setDeckCount] = useState<number | null>(null);

  const handleJoin = async () => {
    if (code.trim().length !== 6) return;
    await joinRoom(code.trim());
  };

  // Any manual edit leaves "stars" mode (it's a preset, not a toggle).
  const toggleCat = (cat: CardCategory) => {
    setStarMode(false);
    setTrainingCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const toggleContinent = (continent: ContinentFilter) => {
    setStarMode(false);
    setTrainingContinents((prev) => {
      const next = new Set(prev);
      if (next.has(continent)) next.delete(continent);
      else next.add(continent);
      return next;
    });
  };

  // Parent "all players" checkbox: every continent at once / none.
  const allContinentsOn = trainingContinents.size === ALL_CONTINENT_FILTERS.length;
  const playersOn = trainingContinents.size > 0;
  const togglePlayers = () => {
    setStarMode(false);
    setTrainingContinents(allContinentsOn ? new Set() : new Set(ALL_CONTINENT_FILTERS));
  };

  const applyPreset = (id: PresetId) => {
    hapticImpact('light');
    setStarMode(id === 'stars');
    if (id === 'clubs_only') {
      setTrainingContinents(new Set());
      setTrainingCats(new Set(CLUBS_ONLY_CATS));
    } else if (id === 'all') {
      setTrainingContinents(new Set(ALL_CONTINENT_FILTERS));
      setTrainingCats(new Set(NON_PLAYER_CATEGORIES));
    } else {
      // stars / world: players only, all continents, no other categories.
      setTrainingContinents(new Set(ALL_CONTINENT_FILTERS));
      setTrainingCats(new Set());
    }
  };

  const toggleGroup = (group: GroupId) => {
    hapticImpact('light');
    setOpenGroup((prev) => (prev === group ? null : group));
  };

  const getCatLabel = (cat: CardCategory) =>
    i18n.language === 'en' ? CATEGORY_LABEL_EN[cat] : CATEGORY_LABEL_RU[cat];

  // Deck filter derived from the current selection (mirrors the RPC inputs).
  const everything = allContinentsOn
    && trainingCats.size === NON_PLAYER_CATEGORIES.length && !starMode;
  const selCategories: CardCategory[] | null = everything
    ? null
    : [...(playersOn ? (['player'] as CardCategory[]) : []), ...trainingCats];
  const selContinents: ContinentFilter[] | null =
    playersOn && !allContinentsOn ? [...trainingContinents] : null;
  const selMinPageviews = starMode ? STAR_MIN_PAGEVIEWS : null;
  const nothingSelected = !playersOn && trainingCats.size === 0;

  const activePreset: PresetId | null = useMemo(() => {
    const allCont = sameMembers(trainingContinents, ALL_CONTINENT_FILTERS);
    const noCont = trainingContinents.size === 0;
    const allCats = sameMembers(trainingCats, NON_PLAYER_CATEGORIES);
    const noCats = trainingCats.size === 0;
    const clubsOnly = sameMembers(trainingCats, CLUBS_ONLY_CATS);
    if (!starMode && allCont && allCats) return 'all';
    if (starMode && allCont && noCats) return 'stars';
    if (!starMode && noCont && clubsOnly) return 'clubs_only';
    if (!starMode && allCont && noCats) return 'world';
    return null;
  }, [trainingContinents, trainingCats, starMode]);

  // Live "Выбрано: N карточек" — debounced count of the current filter.
  const filterKey = JSON.stringify(
    { c: selCategories, k: selContinents, p: selMinPageviews });
  useEffect(() => {
    if (view !== 'create_training') return;
    let cancelled = false;
    setDeckCount(null);
    const handle = setTimeout(() => {
      countDeck(selCategories, selContinents, selMinPageviews)
        .then((n) => { if (!cancelled) setDeckCount(n); })
        .catch(() => { if (!cancelled) setDeckCount(null); });
    }, 350);
    return () => { cancelled = true; clearTimeout(handle); };
    // selCategories/selContinents are captured via filterKey (stable string).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, view]);

  const startTraining = () => {
    hapticImpact('light');
    trackEvent('quick_game_start', {
      preset: activePreset ?? 'custom',
      players: playersOn,
      categories: trainingCats.size,
    });
    navigate('/training', {
      state: {
        categories: selCategories,
        continents: selContinents,
        minPageviews: selMinPageviews,
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
        </div>
        {player && (
          <Avatar
            name={`${player.first_name} ${player.last_name ?? ''}`.trim()}
            src={player.avatar_url}
            size="md"
          />
        )}
      </div>

      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-8">
        <div className="text-center space-y-3 flex flex-col items-center">
          <img
            src="/logo-white-clean.png"
            alt="Шерлок Скоулс"
            className="w-[220px] max-w-full h-auto"
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

        {/* ── Training settings ── */}
        {view === 'create_training' && (
          <div className="w-full max-w-sm space-y-4 animate-slide-up">
            {/* Live deck size for the current selection */}
            <p className="text-center text-sm text-brand-muted">
              {deckCount === null
                ? t('home.counting')
                : t('home.selected_count', { count: deckCount })}
            </p>

            {/* One-tap presets */}
            <div className="grid grid-cols-2 gap-2">
              {PRESETS.map((preset) => {
                const on = activePreset === preset;
                return (
                  <button
                    key={preset}
                    className={`rounded-xl py-2.5 px-2 text-xs font-bold transition-colors ${
                      on ? 'text-brand-bg' : 'bg-brand-border text-white hover:bg-brand-border/70'
                    }`}
                    style={on ? { backgroundColor: '#FF6300' } : undefined}
                    onClick={() => applyPreset(preset)}
                  >
                    {t(`home.preset_${preset}`)}
                  </button>
                );
              })}
            </div>

            {/* Fine-grained accordion groups */}
            <div className="bg-brand-surface rounded-2xl p-4 border border-brand-border space-y-3">
              {/* Players group — expands into continents */}
              <div className="rounded-xl bg-brand-border/40 overflow-hidden">
                <div className="flex items-stretch">
                  <CheckRow
                    active={playersOn}
                    label={t('home.group_players')}
                    onToggle={togglePlayers}
                  />
                  <button
                    className="flex-1 flex items-center justify-end px-3 text-brand-muted hover:text-white transition-colors"
                    aria-expanded={openGroup === 'players'}
                    aria-label={t('home.group_players')}
                    onClick={() => toggleGroup('players')}
                  >
                    <IconChevronDown
                      size={18}
                      stroke={2}
                      className={`transition-transform duration-200 ${
                        openGroup === 'players' ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                </div>
                {openGroup === 'players' && (
                  <div className="grid grid-cols-2 gap-2 p-2 pt-0 animate-fade-in">
                    {ALL_CONTINENT_FILTERS.map((continent) => (
                      <CheckRow
                        key={continent}
                        active={trainingContinents.has(continent)}
                        label={t(`home.continent_${continent}`)}
                        onToggle={() => toggleContinent(continent)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Category groups */}
              {CAT_GROUPS.map((group) => {
                const selected = group.cats.filter((c) => trainingCats.has(c)).length;
                return (
                  <div key={group.id} className="rounded-xl bg-brand-border/40 overflow-hidden">
                    <button
                      className="w-full flex items-center justify-between px-3 py-2 text-xs text-white text-left"
                      aria-expanded={openGroup === group.id}
                      onClick={() => toggleGroup(group.id)}
                    >
                      <span>
                        {t(`home.group_${group.id}`)}
                        <span className="text-brand-muted ml-1.5">
                          {selected}/{group.cats.length}
                        </span>
                      </span>
                      <IconChevronDown
                        size={18}
                        stroke={2}
                        className={`text-brand-muted transition-transform duration-200 ${
                          openGroup === group.id ? 'rotate-180' : ''
                        }`}
                      />
                    </button>
                    {openGroup === group.id && (
                      <div className="grid grid-cols-2 gap-2 p-2 pt-0 animate-fade-in">
                        {group.cats.map((cat) => (
                          <CheckRow
                            key={cat}
                            active={trainingCats.has(cat)}
                            label={getCatLabel(cat)}
                            onToggle={() => toggleCat(cat)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
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
