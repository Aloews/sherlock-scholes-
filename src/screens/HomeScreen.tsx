import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/Button';
import { Avatar } from '@/shared/ui/Avatar';
import { LanguageToggle } from '@/shared/ui/LanguageToggle';
import { useRoom } from '@/features/room/useRoom';
import { useAuthStore } from '@/shared/store/authStore';
import { useGameStore } from '@/shared/store/gameStore';
import { usePlayerStats } from '@/features/game/usePlayerStats';
import { hapticImpact } from '@/shared/lib/telegram';

type View = 'home' | 'create' | 'join';

export function HomeScreen() {
  const { player } = useAuthStore();
  const { loading, error } = useGameStore();
  const { createRoom, joinRoom } = useRoom();
  const { t } = useTranslation();
  const { stats, loading: statsLoading } = usePlayerStats(player?.id ?? null);

  const [view, setView] = useState<View>('home');
  const [code, setCode] = useState('');

  const handleJoin = async () => {
    if (code.trim().length !== 6) return;
    await joinRoom(code.trim());
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 pt-8">
        <LanguageToggle />
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
        <div className="text-center space-y-3">
          <div className="text-7xl mb-2">⚽</div>
          <h1 className="text-4xl font-black text-white tracking-tight">
            Sherlock Scholes
          </h1>
          <p className="text-zinc-400 text-lg">{t('home.subtitle')}</p>
        </div>

        {/* Player stats — only on main view */}
        {view === 'home' && !statsLoading && (
          <div className="w-full max-w-sm">
            <p className="text-zinc-500 text-xs text-center mb-2 uppercase tracking-wider">
              {t('stats.title')}
            </p>
            {stats ? (
              <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-3">
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    { label: t('stats.games'), value: stats.games_played },
                    { label: t('stats.wins'),  value: stats.games_won },
                    { label: t('stats.cards'), value: stats.cards_guessed },
                    { label: t('stats.score'), value: stats.total_score },
                  ].map((item) => (
                    <div key={item.label}>
                      <p className="text-white font-bold text-lg leading-none">{item.value}</p>
                      <p className="text-zinc-500 text-xs mt-1">{item.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="bg-zinc-900/50 rounded-2xl border border-zinc-800/50 p-3 text-center">
                <p className="text-zinc-600 text-sm">{t('stats.first_game')}</p>
              </div>
            )}
          </div>
        )}

        {view === 'home' && (
          <div className="w-full max-w-sm space-y-3 animate-fade-in">
            <Button
              fullWidth
              size="lg"
              onClick={() => { hapticImpact('medium'); setView('create'); }}
            >
              {t('home.create_game')}
            </Button>
            <Button
              fullWidth
              size="lg"
              variant="secondary"
              onClick={() => { hapticImpact('light'); setView('join'); }}
            >
              {t('home.join_game')}
            </Button>
          </div>
        )}

        {view === 'create' && (
          <div className="w-full max-w-sm space-y-4 animate-slide-up">
            <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800 space-y-2">
              <p className="text-zinc-400 text-sm">{t('home.game_settings')}</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label: t('home.setting_rounds'), value: '3' },
                  { label: t('home.setting_cards'), value: '5' },
                  { label: t('home.setting_time'), value: '60s' },
                ].map((s) => (
                  <div key={s.label} className="bg-zinc-800 rounded-xl p-2">
                    <p className="text-white font-bold">{s.value}</p>
                    <p className="text-zinc-500 text-xs">{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
            <Button fullWidth size="lg" loading={loading} onClick={() => createRoom()}>
              {t('home.create_room')}
            </Button>
            <Button fullWidth variant="ghost" onClick={() => setView('home')}>
              {t('home.back')}
            </Button>
          </div>
        )}

        {view === 'join' && (
          <div className="w-full max-w-sm space-y-4 animate-slide-up">
            <div className="space-y-2">
              <label className="text-zinc-400 text-sm font-medium">
                {t('home.room_code_label')}
              </label>
              <input
                type="text"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder={t('home.room_code_placeholder')}
                className="w-full h-14 bg-zinc-900 border border-zinc-700 rounded-2xl px-4 text-white text-2xl font-black tracking-[0.5em] text-center uppercase placeholder-zinc-600 focus:outline-none focus:border-emerald-500 transition-colors"
                autoFocus
              />
            </div>
            <Button
              fullWidth
              size="lg"
              loading={loading}
              disabled={code.length !== 6}
              onClick={handleJoin}
            >
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

      {/* Footer */}
      <div className="p-6 text-center">
        <p className="text-zinc-700 text-xs">{t('home.footer')}</p>
      </div>
    </div>
  );
}
