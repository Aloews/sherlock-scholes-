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
import { countCards, wakeSupabase } from '@/features/game/cardRandomizer';
import { supabase } from '@/shared/lib/supabase';
import { countryName } from '@/shared/lib/countryName';
import { fameFloor, recordQuickGameStart } from '@/features/game/onboarding';
import { trackEvent } from '@/shared/lib/analytics';
import { hapticImpact, cloudGet } from '@/shared/lib/telegram';
import { FRAME_COLOR } from '@/shared/lib/pro';
import {
  ALL_CONTINENT_FILTERS,
  type CardCategory,
  type ContinentFilter,
} from '@/shared/types/database';
import {
  CATEGORY_GROUPS, DECK_LEAGUES, DECK_PRESETS, DECK_TRAITS,
  FAME_LEVELS, FAME_MIN, NON_PLAYER_CATEGORIES, normalizeFilter,
  type DeckFilter, type DeckPreset, type FameLevel,
} from '@/shared/types/deck';

type View = 'home' | 'mode_select' | 'create_team' | 'create_1v1' | 'create_training' | 'join';

// ── The quick-game picker ────────────────────────────────────────────
// It used to be one wall of 27 chips in which a tag, a continent and a
// category were visually identical, plus a tier row and two dropdowns —
// five ways of saying "narrow the deck" on one screen, with a hidden rule
// where the first tag tap silently wiped everything else.
//
// It is now a wizard over ONE DeckFilter (src/shared/types/deck.ts):
//   presets  play a ready deck in one tap, or build your own
//   1 who    which cards are in the deck at all
//   2 fame   how well-known they are — the single fame axis
//   3 refine player-only narrowing (continent, country, league, traits)
//
// Every step counts its own options through the same count_deck RPC the
// game deals from, so a step never offers an empty deck.
type Step = 'presets' | 'who' | 'fame' | 'refine';
const BUILD_STEPS: Step[] = ['who', 'fame', 'refine'];

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

  // ── Picker state ───────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('presets');
  // Deck composition. Default = the whole deck, so Play works immediately.
  const [withPlayers, setWithPlayers] = useState(true);
  const [selCats, setSelCats] = useState<Set<CardCategory>>(new Set(NON_PLAYER_CATEGORIES));
  // The one fame axis. `fameTouched` keeps the onboarding floor honest: it
  // applies only while the player hasn't stated a preference of their own.
  const [fameLevel, setFameLevel] = useState<FameLevel>('any');
  const [fameTouched, setFameTouched] = useState(false);
  // Player-only narrowing (step 3).
  const [selConts, setSelConts] = useState<Set<ContinentFilter>>(new Set());
  const [selTraits, setSelTraits] = useState<Set<string>>(new Set());
  const [selCountry, setSelCountry] = useState('');
  const [selLeague, setSelLeague] = useState('');
  const [countryOpts, setCountryOpts] = useState<string[] | null>(null);

  // Live counts, all through count_deck: the current deck, one per preset,
  // and one per fame step so each option shows what it would leave.
  const [deckCount, setDeckCount] = useState<number | null>(null);
  const [presetCounts, setPresetCounts] = useState<Record<string, number> | null>(null);
  const [fameCounts, setFameCounts] = useState<Record<string, number> | null>(null);

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

  const getCatLabel = (cat: CardCategory) => t(`category.${cat}`);
  const lang = i18n.language.slice(0, 2);

  // ── The filter under construction ──────────────────────────────────
  // One object, built by the wizard, counted by count_deck and handed to
  // the game untouched. Player-only dimensions (continents, country,
  // league, traits) are dropped when players are not in the deck, so they
  // can never silently shrink a clubs-only game.
  const selectedCats: CardCategory[] = [
    ...(withPlayers ? (['player'] as CardCategory[]) : []),
    ...NON_PLAYER_CATEGORIES.filter((c) => selCats.has(c)),
  ];
  const everything = withPlayers && selCats.size === NON_PLAYER_CATEGORIES.length;

  const filter: DeckFilter = normalizeFilter({
    categories: everything ? null : selectedCats,
    continents: withPlayers && selConts.size ? [...selConts] : null,
    countries:  withPlayers && selCountry ? [selCountry] : null,
    leagues:    withPlayers && selLeague ? [selLeague] : null,
    tags:       withPlayers && selTraits.size ? [...selTraits] : null,
    fame_min:   FAME_MIN[fameLevel],
    lang,
  });

  // The onboarding floor and the player's own choice are the SAME axis
  // now, so they collapse: whoever asks for more fame wins. The floor
  // applies only while the player hasn't spoken for themselves —
  // otherwise picking "любые" would quietly deal famous cards and the
  // counter under the button would be describing a different deck.
  const onboardingFloor = fameTouched ? 0 : fameFloor(gamesPlayed);
  const withFloor = (f: DeckFilter): DeckFilter => normalizeFilter({
    ...f, lang, fame_min: Math.max(f.fame_min ?? 0, onboardingFloor),
  });
  const effectiveFilter = withFloor(filter);

  const nothingSelected = selectedCats.length === 0;
  const filterKey = JSON.stringify(effectiveFilter);

  // ── Counts ─────────────────────────────────────────────────────────
  // Live count of the deck as configured — the same RPC the game deals
  // from, so this number IS the deck, not an approximation of it.
  useEffect(() => {
    if (view !== 'create_training') return;
    let cancelled = false;
    setDeckCount(null);
    const handle = setTimeout(() => {
      countCards(JSON.parse(filterKey) as DeckFilter)
        .then((n) => { if (!cancelled) setDeckCount(n); });
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [filterKey, view]);

  // Per-preset counts, once: a preset that would deal nothing is disabled
  // rather than starting an empty game.
  useEffect(() => {
    if (view !== 'create_training' || presetCounts) return;
    let cancelled = false;
    Promise.all(DECK_PRESETS.map(async (preset) => {
      // Counted WITH the onboarding floor, because that is the deck the tap
      // would actually deal — a preset must not advertise 3364 cards and
      // hand a newcomer 500.
      const n = await countCards({
        ...preset.filter, lang,
        fame_min: Math.max(preset.filter.fame_min ?? 0, onboardingFloor),
      });
      return [preset.id, n ?? -1] as const;
    })).then((entries) => {
      if (!cancelled) setPresetCounts(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [view, presetCounts, lang, onboardingFloor]);

  // What each fame step would leave of the CURRENT deck — the difference
  // between "знаменитые" and "любые" is a number, not a guess.
  useEffect(() => {
    if (view !== 'create_training' || step !== 'fame') return;
    let cancelled = false;
    const base = JSON.parse(filterKey) as DeckFilter;
    Promise.all(FAME_LEVELS.map(async (level) => {
      const n = await countCards({ ...base, fame_min: FAME_MIN[level] });
      return [level, n ?? -1] as const;
    })).then((entries) => {
      if (!cancelled) setFameCounts(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [view, step, filterKey]);

  // Country options come from the deck (the ISO codes players actually
  // have). Leagues do NOT: they are the fixed DECK_LEAGUES list, because
  // deriving that dropdown from live data is exactly how "FA Cup" and
  // "Friendlies Clubs" got into it (supabase/migrations/deck_top_league.sql).
  useEffect(() => {
    if (view !== 'create_training' || countryOpts) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('cards').select('country')
        .eq('active', true).eq('category', 'player').not('country', 'is', null);
      if (cancelled || !data) return;
      setCountryOpts([...new Set(data.map((r) => r.country).filter(Boolean) as string[])]);
    })().catch(() => { if (!cancelled) setCountryOpts([]); });
    return () => { cancelled = true; };
  }, [view, countryOpts]);

  // ── Actions ────────────────────────────────────────────────────────
  const toggleCategory = (cat: CardCategory) => {
    hapticImpact('light');
    setSelCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else { next.add(cat); trackEvent('category_selected', { kind: 'category', value: cat }); }
      return next;
    });
  };

  // A group header toggles its whole group: all off if any of it is on.
  const toggleGroup = (cats: CardCategory[]) => {
    hapticImpact('light');
    setSelCats((prev) => {
      const next = new Set(prev);
      const anyOn = cats.some((c) => next.has(c));
      cats.forEach((c) => (anyOn ? next.delete(c) : next.add(c)));
      return next;
    });
  };

  const toggleContinent = (value: ContinentFilter) => {
    hapticImpact('light');
    setSelConts((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else { next.add(value); trackEvent('category_selected', { kind: 'continent', value }); }
      return next;
    });
  };

  // Pro-only traits bounce free users to the Pro screen instead of
  // selecting — the server strips them anyway (deck_sanitize_filter).
  const toggleTrait = (tag: string, pro?: boolean) => {
    if (pro && !isPro) { hapticImpact('light'); navigate('/pro'); return; }
    hapticImpact('light');
    setSelTraits((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else { next.add(tag); trackEvent('category_selected', { kind: pro ? 'pro_tag' : 'tag', value: tag }); }
      return next;
    });
  };

  const pickFame = (level: FameLevel) => {
    hapticImpact('light');
    setFameLevel(level);
    setFameTouched(true);
    trackEvent('category_selected', { kind: 'fame', value: level });
  };

  const resetPicker = () => {
    hapticImpact('light');
    setWithPlayers(true);
    setSelCats(new Set(NON_PLAYER_CATEGORIES));
    setFameLevel('any');
    setFameTouched(false);
    setSelConts(new Set());
    setSelTraits(new Set());
    setSelCountry('');
    setSelLeague('');
    setFameCounts(null);
  };

  const closePicker = () => {
    hapticImpact('light');
    setStep('presets');
    setView('home');
  };

  const startGame = (deckFilter: DeckFilter, presetId: string) => {
    hapticImpact('light');
    const final = withFloor(deckFilter);
    trackEvent('quick_game_start', {
      preset: presetId,
      players: final.categories == null || final.categories.includes('player'),
      categories: final.categories?.length ?? 0,
      tags: final.tags?.join(',') ?? '',
      fame_min: final.fame_min ?? 0,
      games: gamesPlayed,
    });
    void recordQuickGameStart(); // increment AFTER reading the floor for this game
    navigate('/training', { state: { filter: final } });
  };

  const startPreset = (preset: DeckPreset) => {
    if (preset.pro && !isPro) { hapticImpact('light'); navigate('/pro'); return; }
    startGame(preset.filter, preset.id);
  };

  // Step 3 only narrows players; with a players-free deck there is nothing
  // to refine, so the wizard is two steps long.
  const steps = withPlayers ? BUILD_STEPS : BUILD_STEPS.filter((s) => s !== 'refine');
  const stepIndex = steps.indexOf(step);
  const goNext = () => {
    hapticImpact('light');
    const next = steps[stepIndex + 1];
    if (next) setStep(next);
    else startGame(filter, 'custom');
  };
  const goBack = () => {
    hapticImpact('light');
    setStep(stepIndex <= 0 ? 'presets' : steps[stepIndex - 1]);
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

        {/* ── Quick game: the deck wizard ── */}
        {view === 'create_training' && (
          <div className="w-full max-w-sm space-y-4 animate-slide-up">

            {/* Step 0 — ready decks. Most games start and end here. */}
            {step === 'presets' && (
              <>
                <p className="text-brand-muted text-xs text-center uppercase tracking-wider">
                  {t('home.picker_title')}
                </p>
                <div className="space-y-2">
                  {DECK_PRESETS.map((preset) => {
                    const n = presetCounts?.[preset.id];
                    const locked = !!preset.pro && !isPro;
                    const empty = n === 0;
                    return (
                      <button
                        key={preset.id}
                        disabled={empty && !locked}
                        onClick={() => startPreset(preset)}
                        className={`w-full bg-brand-surface border border-brand-border rounded-2xl p-4 text-left transition-colors hover:border-brand-accent ${
                          empty && !locked ? 'opacity-40 cursor-not-allowed' : ''
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-2xl leading-none">{preset.emoji}</span>
                          <div className="min-w-0 flex-1">
                            <p className="text-white font-bold flex items-center gap-1.5">
                              {t(preset.labelKey)}
                              {locked && <IconLock size={13} stroke={2.5} style={{ color: '#FFD24A' }} />}
                              {preset.pro && !locked && <span style={{ color: '#FFD24A' }}>★</span>}
                            </p>
                            <p className="text-brand-muted text-xs mt-0.5">{t(preset.descKey)}</p>
                          </div>
                          {n != null && n >= 0 && (
                            <span className="text-brand-muted/70 text-xs flex-shrink-0">{n}</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <Button fullWidth variant="secondary" onClick={() => { hapticImpact('light'); setStep('who'); }}>
                  {t('home.build_own')}
                </Button>
                <Button fullWidth variant="ghost" onClick={closePicker}>
                  {t('home.back')}
                </Button>
              </>
            )}

            {/* Steps 1-3 — build your own deck. */}
            {step !== 'presets' && (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-brand-muted text-xs uppercase tracking-wider">
                    {t('home.step_of', { n: stepIndex + 1, total: steps.length })}
                  </p>
                  <button
                    onClick={resetPicker}
                    className="text-brand-muted text-xs hover:text-white transition-colors"
                  >
                    {t('home.reset')}
                  </button>
                </div>

                {/* 1 — who is in the deck */}
                {step === 'who' && (
                  <div className="space-y-3">
                    <p className="text-white font-bold">{t('home.step_who')}</p>

                    <button
                      onClick={() => { hapticImpact('light'); setWithPlayers((v) => !v); }}
                      className={`w-full rounded-2xl p-4 text-left border transition-colors ${
                        withPlayers
                          ? 'border-brand-accent bg-brand-accent/10'
                          : 'border-brand-border bg-brand-surface'
                      }`}
                    >
                      <p className="text-white font-bold">{getCatLabel('player')}</p>
                      <p className="text-brand-muted text-xs mt-0.5">{t('home.who_players_desc')}</p>
                    </button>

                    {CATEGORY_GROUPS.map((group) => {
                      const on = group.categories.filter((c) => selCats.has(c)).length;
                      return (
                        <div
                          key={group.id}
                          className={`rounded-2xl border p-3 transition-colors ${
                            on ? 'border-brand-accent/50 bg-brand-surface' : 'border-brand-border bg-brand-surface/50'
                          }`}
                        >
                          <button
                            onClick={() => toggleGroup(group.categories)}
                            className="w-full flex items-center justify-between text-left"
                          >
                            <span className="text-white text-sm font-medium">{t(group.labelKey)}</span>
                            <span className="text-brand-muted text-xs">
                              {on}/{group.categories.length}
                            </span>
                          </button>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {group.categories.map((cat) => (
                              <button
                                key={cat}
                                onClick={() => toggleCategory(cat)}
                                className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
                                  selCats.has(cat)
                                    ? 'border-transparent text-white'
                                    : 'border-brand-border bg-brand-border/40 text-brand-muted hover:text-white'
                                }`}
                                style={selCats.has(cat) ? { backgroundColor: '#FF6300' } : undefined}
                              >
                                {getCatLabel(cat)}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 2 — how well-known: one axis, three steps of it */}
                {step === 'fame' && (
                  <div className="space-y-3">
                    <p className="text-white font-bold">{t('home.step_fame')}</p>
                    <p className="text-brand-muted text-xs">{t('home.step_fame_hint')}</p>
                    <div className="space-y-2">
                      {FAME_LEVELS.map((level) => {
                        const n = fameCounts?.[level];
                        const on = fameLevel === level;
                        return (
                          <button
                            key={level}
                            onClick={() => pickFame(level)}
                            className={`w-full rounded-2xl p-4 text-left border transition-colors ${
                              on ? 'border-brand-accent bg-brand-accent/10' : 'border-brand-border bg-brand-surface'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-white font-bold">{t(`home.fame_${level}`)}</p>
                                <p className="text-brand-muted text-xs mt-0.5">{t(`home.fame_${level}_desc`)}</p>
                              </div>
                              {n != null && n >= 0 && (
                                <span className="text-brand-muted/70 text-xs flex-shrink-0">{n}</span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 3 — narrow the players (skippable) */}
                {step === 'refine' && (
                  <div className="space-y-4">
                    <p className="text-white font-bold">{t('home.step_refine')}</p>

                    <div>
                      <p className="text-brand-muted text-xs mb-1.5">{t('home.refine_continent')}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {ALL_CONTINENT_FILTERS.map((cont) => (
                          <button
                            key={cont}
                            onClick={() => toggleContinent(cont)}
                            className={`px-3 py-1.5 rounded-full text-xs border transition-colors ${
                              selConts.has(cont)
                                ? 'border-transparent text-white'
                                : 'border-brand-border bg-brand-border/40 text-brand-muted hover:text-white'
                            }`}
                            style={selConts.has(cont) ? { backgroundColor: '#FF6300' } : undefined}
                          >
                            {t(`home.continent_${cont}`)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-brand-muted text-xs mb-1.5">{t('home.refine_traits')}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {DECK_TRAITS.map((trait) => {
                          const locked = !!trait.pro && !isPro;
                          const on = selTraits.has(trait.tag);
                          return (
                            <button
                              key={trait.tag}
                              onClick={() => toggleTrait(trait.tag, trait.pro)}
                              className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs border transition-colors ${
                                on
                                  ? 'border-transparent text-white'
                                  : 'border-brand-border bg-brand-border/40 text-brand-muted hover:text-white'
                              }`}
                              style={on ? { backgroundColor: '#FF6300' } : undefined}
                            >
                              {locked && <IconLock size={11} stroke={2.5} style={{ color: '#FFD24A' }} />}
                              {t(trait.labelKey)}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      {!!countryOpts?.length && (
                        <select
                          value={selCountry}
                          onChange={(e) => { hapticImpact('light'); setSelCountry(e.target.value); }}
                          className="w-full bg-brand-surface border border-brand-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-accent"
                        >
                          <option value="">{t('home.filter_all_countries')}</option>
                          {countryOpts
                            .map((iso) => ({ iso, name: countryName(iso, i18n.language) || iso }))
                            .sort((a, b) => a.name.localeCompare(b.name, i18n.language))
                            .map(({ iso, name }) => <option key={iso} value={iso}>{name}</option>)}
                        </select>
                      )}
                      <select
                        value={selLeague}
                        onChange={(e) => { hapticImpact('light'); setSelLeague(e.target.value); }}
                        className="w-full bg-brand-surface border border-brand-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-accent"
                      >
                        <option value="">{t('home.filter_all_leagues')}</option>
                        {DECK_LEAGUES.map((lg) => (
                          <option key={lg} value={lg}>{t(`league.${lg}`, { defaultValue: lg })}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* Live count of exactly what the game will deal */}
                <p className="text-center text-sm text-brand-muted">
                  {nothingSelected
                    ? t('home.pick_something')
                    : deckCount === null
                      ? t('home.counting')
                      : t('home.deck_size', { count: deckCount })}
                </p>

                <Button
                  fullWidth
                  size="lg"
                  disabled={nothingSelected || deckCount === 0}
                  onClick={goNext}
                >
                  {stepIndex === steps.length - 1 ? t('home.play') : t('home.next')}
                </Button>
                <Button fullWidth variant="ghost" onClick={goBack}>
                  {t('home.back')}
                </Button>
              </>
            )}
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
