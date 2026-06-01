import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconUsersGroup, IconUser, IconCards, IconQuestionMark } from '@tabler/icons-react';
import { Button } from '@/shared/ui/Button';
import { Avatar } from '@/shared/ui/Avatar';
import { LanguageToggle } from '@/shared/ui/LanguageToggle';
import { useRoom } from '@/features/room/useRoom';
import { useAuthStore } from '@/shared/store/authStore';
import { useGameStore } from '@/shared/store/gameStore';
import { usePlayerStats } from '@/features/game/usePlayerStats';
import { hapticImpact } from '@/shared/lib/telegram';
import {
  ALL_CATEGORIES,
  CATEGORY_LABEL_RU,
  CATEGORY_LABEL_EN,
  type CardCategory,
} from '@/shared/types/database';

type View = 'home' | 'mode_select' | 'create_team' | 'create_1v1' | 'create_training' | 'join';

export function HomeScreen() {
  const navigate = useNavigate();
  const { player } = useAuthStore();
  const { loading, error } = useGameStore();
  const { createRoom, joinRoom } = useRoom();
  const { t, i18n } = useTranslation();
  const { stats, loading: statsLoading } = usePlayerStats(player?.id ?? null);

  useEffect(() => {
    if (localStorage.getItem('sherlock_tutorial_seen') !== 'true') {
      navigate('/tutorial', { replace: true });
    }
  }, []);

  const [view,            setView]            = useState<View>('home');
  const [code,            setCode]            = useState('');
  const [rounds1v1,       setRounds1v1]       = useState(3);
  const [trainingCats,    setTrainingCats]    = useState<Set<CardCategory>>(new Set(ALL_CATEGORIES));

  const handleJoin = async () => {
    if (code.trim().length !== 6) return;
    await joinRoom(code.trim());
  };

  const toggleCat = (cat: CardCategory) => {
    setTrainingCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const getCatLabel = (cat: CardCategory) =>
    i18n.language === 'en' ? CATEGORY_LABEL_EN[cat] : CATEGORY_LABEL_RU[cat];

  const startTraining = () => {
    const cats = trainingCats.size === ALL_CATEGORIES.length ? null : [...trainingCats];
    navigate('/training', { state: { categories: cats } });
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
            onClick={() => navigate('/tutorial')}
            aria-label={t('home.tutorial_button_aria')}
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-brand-surface border border-brand-border text-brand-muted hover:text-white hover:border-brand-accent transition-colors"
          >
            <IconQuestionMark size={18} stroke={1.5} />
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

        {/* ── Main CTA ── */}
        {view === 'home' && (
          <div className="w-full max-w-sm space-y-3 animate-fade-in">
            <Button fullWidth size="lg" onClick={() => { hapticImpact('medium'); setView('mode_select'); }}>
              {t('home.create_game')}
            </Button>
            <Button fullWidth size="lg" variant="secondary" onClick={() => { hapticImpact('light'); setView('join'); }}>
              {t('home.join_game')}
            </Button>
          </div>
        )}

        {/* ── Mode selection ── */}
        {view === 'mode_select' && (
          <div className="w-full max-w-sm space-y-3 animate-slide-up">
            <p className="text-brand-muted text-xs text-center uppercase tracking-wider mb-1">
              {t('home.mode_select_title')}
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

            {/* Training */}
            <button
              className="w-full bg-brand-surface border border-brand-border rounded-2xl p-5 text-left hover:border-brand-accent transition-colors"
              onClick={() => { hapticImpact('light'); setView('create_training'); }}
            >
              <div className="flex items-start gap-4">
                <div className="mt-0.5 text-brand-accent flex-shrink-0">
                  <IconCards size={28} stroke={1.5} />
                </div>
                <div>
                  <p className="text-white font-bold">{t('home.mode_training_title')}</p>
                  <p className="text-brand-muted text-sm mt-0.5">{t('home.mode_training_desc')}</p>
                </div>
              </div>
            </button>

            <Button fullWidth variant="ghost" onClick={() => setView('home')}>
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
            <Button fullWidth variant="ghost" onClick={() => setView('mode_select')}>
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
                      onClick={() => setRounds1v1(n)}
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
            <Button fullWidth variant="ghost" onClick={() => setView('mode_select')}>
              {t('home.back')}
            </Button>
          </div>
        )}

        {/* ── Training settings ── */}
        {view === 'create_training' && (
          <div className="w-full max-w-sm space-y-4 animate-slide-up">
            <div className="bg-brand-surface rounded-2xl p-4 border border-brand-border space-y-3">
              <p className="text-brand-muted text-sm">{t('home.game_settings')}</p>
              <div className="grid grid-cols-2 gap-2">
                {ALL_CATEGORIES.map((cat) => {
                  const active = trainingCats.has(cat);
                  return (
                    <button
                      key={cat}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-colors text-left ${
                        active
                          ? 'bg-brand-accent/15 text-white'
                          : 'bg-brand-border text-brand-muted'
                      }`}
                      onClick={() => toggleCat(cat)}
                    >
                      <span
                        className={`w-3.5 h-3.5 rounded flex-shrink-0 flex items-center justify-center text-[10px] font-bold ${
                          active ? 'bg-brand-accent text-brand-bg' : 'bg-brand-muted/30'
                        }`}
                      >
                        {active ? '✓' : ''}
                      </span>
                      <span className="truncate">{getCatLabel(cat)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            <Button
              fullWidth
              size="lg"
              disabled={trainingCats.size === 0}
              onClick={startTraining}
            >
              {t('home.create_room')}
            </Button>
            <Button fullWidth variant="ghost" onClick={() => setView('mode_select')}>
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
            <Button fullWidth variant="ghost" onClick={() => { setCode(''); setView('home'); }}>
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

      <div className="p-6 text-center">
        <p className="text-brand-muted/40 text-xs">{t('home.footer')}</p>
      </div>
    </div>
  );
}
