import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  IconUsersGroup, IconUser, IconQuestionMark, IconVolume, IconVolumeOff,
  IconCrown,
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
import { wakeSupabase } from '@/features/game/cardRandomizer';
import { recordQuickGameStart } from '@/features/game/onboarding';
import { trackEvent } from '@/shared/lib/analytics';
import { hapticImpact, cloudGet } from '@/shared/lib/telegram';
import { FRAME_COLOR } from '@/shared/lib/pro';
import { DeckPickerScreen } from './DeckPickerScreen';
import type { DeckFilter } from '@/shared/types/deck';
import { PRO } from '@/shared/ui/palette';

type View = 'home' | 'mode_select' | 'create_team' | 'create_1v1' | 'create_training' | 'join';

export function HomeScreen() {
  const navigate = useNavigate();
  const { player } = useAuthStore();
  const { loading, error } = useGameStore();
  const { soundEnabled, setSoundEnabled, proFrame } = useSettingsStore();
  const isPro = useProStore((s) => s.isPro);
  const gamesPlayed = useProStore((s) => s.gamesPlayed);
  const { createRoom, joinRoom } = useRoom();
  const { t } = useTranslation();
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

  // Quick game: the deck picker is its own screen (DeckPickerScreen). It
  // owns the filter it builds and hands the finished DeckFilter back here.
  const startGame = (filter: DeckFilter, presetId: string) => {
    trackEvent('quick_game_start', {
      preset: presetId,
      players: filter.categories == null || filter.categories.includes('player'),
      categories: filter.categories?.length ?? 0,
      tags: filter.tags?.join(',') ?? '',
      fame_min: filter.fame_min ?? 0,
      games: gamesPlayed,
    });
    void recordQuickGameStart(); // increment AFTER reading the floor for this game
    navigate('/training', { state: { filter } });
  };

  if (view === 'create_training') {
    return (
      <DeckPickerScreen
        isPro={isPro}
        gamesPlayed={gamesPlayed}
        onClose={() => setView('home')}
        onNeedPro={() => navigate('/pro')}
        onStart={startGame}
      />
    );
  }

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
            style={isPro ? { borderColor: PRO, color: PRO } : undefined}
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
