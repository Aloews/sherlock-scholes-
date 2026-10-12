import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconHelp, IconVolume, IconVolumeOff, IconCards } from '@tabler/icons-react';
import { IconButton } from '@/shared/ui/IconButton';
import { LanguageToggle } from '@/shared/ui/LanguageToggle';
import { DesignToggle } from '@/shared/ui/DesignToggle';
import { HomeGameLink } from '@/screens/home/HomeGameLink';
import { HomeAliasActions } from '@/screens/home/HomeAliasActions';
import { HomeModeSelect } from '@/screens/home/HomeModeSelect';
import { HomeTeamSettings } from '@/screens/home/HomeTeamSettings';
import { HomeDuelSettings } from '@/screens/home/HomeDuelSettings';
import { HomeJoinForm } from '@/screens/home/HomeJoinForm';
import { HomeJoining } from '@/screens/home/HomeJoining';
import { useDesign } from '@/shared/design/useDesign';
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
import { useRoomJoin } from '@/features/lobby/useRoomJoin';
import { PendingInvitesPanel } from '@/features/lobby/PendingInvitesPanel';
import { OnlinePanel } from '@/features/social/OnlinePanel';
import { DeckPickerScreen } from './DeckPickerScreen';
import { SmartDecksPanel } from './home/SmartDecksPanel';
import type { DeckFilter } from '@/shared/types/deck';

// 'alias' is the football Alias's own menu — quick game, competitive, join.
// It exists because the home screen is now a LIST OF GAMES and Alias is one of
// them, rather than the screen itself with three others tacked underneath.
type View = 'home' | 'alias' | 'mode_select' | 'create_team' | 'create_1v1'
  | 'create_training' | 'join' | 'joining';

export function HomeScreen() {
  const navigate = useNavigate();
  const { player } = useAuthStore();
  const { loading } = useGameStore();
  const { soundEnabled, setSoundEnabled } = useSettingsStore();
  // Monetization is disabled: all Alias deck options are available to everyone.
  const isPro = true;
  const gamesPlayed = useProStore((s) => s.gamesPlayed);
  const { createRoom } = useRoom();
  const { t } = useTranslation();
  const { stats, loading: statsLoading } = usePlayerStats(player?.id ?? null);
  // The landing block has a different layout per design; everything below it
  // (mode select, room settings, chip picker, join) is shared.
  const master = useDesign() === 'master';

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
  const [rounds1v1, setRounds1v1] = useState(3);

  // ВЕСЬ ВХОД В КОМНАТУ ЖИВЁТ В ХУКЕ, и это не косметика. Способов войти
  // четыре — набрать код, открыть ссылку, нажать приглашение друга, нажать
  // кнопку Telegram над клавиатурой, — и все обязаны вести себя одинаково.
  // Пока они лежали вперемешку с разметкой меню игр, три ошибки подряд
  // оказались ошибками ПОРЯДКА, которые в разметке не видны вовсе.
  //
  // Колбэки завёрнуты в useCallback: хук держит их в зависимостях эффекта,
  // который забирает start_param, и новая функция на каждом рендере
  // перезапускала бы вход по ссылке бесконечно.
  const onJoining = useCallback(() => setView('joining'), []);
  const onFallBackToForm = useCallback(() => setView('join'), []);
  const join = useRoomJoin({
    formOpen: view === 'join',
    onJoining,
    onFallBackToForm,
  });

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

  // Ссылка-приглашение ведёт прямо в комнату. Всё, что видит игрок по
  // дороге, — в какую комнату он входит: ни лендинга, ни формы, ни клавиатуры.
  if (view === 'joining') return <HomeJoining code={join.code} />;

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
    <div className="min-h-screen bg-brand-bg ds-screen flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 p-4 pt-8">
        {/* One row, no wrapping. It used to hold eight things — a second copy
            of the logo that is already the hero below it, and chips for
            Profile and Pro that the master design keeps in the tab bar. On a
            390px phone they wrapped onto a second line and read as a pile of
            mismatched glyphs. What is left is what has nowhere else to live:
            language, design, tutorial, sound. */}
        <div className="flex items-center gap-1.5 min-w-0">
          {!master && (
            <img src="/logo-white-clean.png" alt="Шерлок Скоулс" className="h-8 w-auto mr-0.5" />
          )}
          <LanguageToggle />
          <DesignToggle />
          <IconButton
            onClick={() => navigate('/tutorial')}
            label={t('home.tutorial_button_aria')}
          >
            <IconHelp size={17} stroke={1.75} />
          </IconButton>
          <IconButton
            onClick={() => setSoundEnabled(!soundEnabled)}
            label={t('home.sound_toggle_aria')}
            pressed={soundEnabled}
          >
            {soundEnabled
              ? <IconVolume    size={17} stroke={1.75} />
              : <IconVolumeOff size={17} stroke={1.75} />}
          </IconButton>
        </div>

      </div>

      {/* Hero. The master design leads with the greeting + action stack
          instead of a centred logo lockup, so the hero shrinks to a compact
          wordmark there; classic keeps the full-size logo it always had. */}
      <div className={`flex-1 flex flex-col items-center px-6 ${
        // The master landing stacks from the top like the prototype; classic
        // keeps its vertically centred lockup.
        master ? 'justify-start gap-4 pt-2' : 'justify-center gap-8'
      }`}>
        <div className="text-center space-y-3 flex flex-col items-center">
          <img
            src="/logo-white-clean.png"
            alt="Шерлок Скоулс"
            className={master ? 'w-[132px] max-w-full h-auto' : 'w-[220px] max-w-full h-auto'}
            onClick={handleLogoTap}
            draggable={false}
          />
          {!master && <p className="text-brand-muted text-lg">{t('home.subtitle')}</p>}
        </div>

        {/* Somebody is waiting for this player. Above the landing on purpose:
            an invitation is the most actionable thing on the screen, and it
            expires when the room starts. Renders nothing when there is
            nothing waiting. */}
        {view === 'home' && (
          <div className="w-full max-w-sm">
            <PendingInvitesPanel onJoin={(invitedCode) => { void join.enter(invitedCode); }} />
          </div>
        )}

        {/* Online players are actionable from the landing screen: this is where
            players decide whether to start a game or invite someone into one. */}
        {view === 'home' && (
          <div className="w-full max-w-sm">
            <OnlinePanel />
          </div>
        )}

        {/* ⚠️ ИМЕНИ ЗДЕСЬ БОЛЬШЕ НЕТ. Владелец: «подпись „имени“ … можно
            убрать с главной». Раньше отсюда ушло «С возвращением», и по той
            же причине: аватар в шапке уже говорит, чей это телефон, а строка
            на весь экран отодвигала первое настоящее дело за сгиб. Имя было
            последним, что от этого блока осталось, — теперь нет и его. */}

        {view === 'home' && (
          <div className="w-full max-w-sm">
            <HomeGameLink
              icon={<IconCards size={20} stroke={1.75} />}
              label={t('home.alias_link')}
              onClick={() => setView('alias')}
            />
          </div>
        )}


        {/* ── The football Alias's own actions ── */}
        {view === 'alias' && (
          <HomeAliasActions
            onQuickGame={() => { hapticImpact('light'); setView('create_training'); }}
            onCompetitive={() => { hapticImpact('light'); setView('mode_select'); }}
            onJoin={() => { hapticImpact('light'); setView('join'); }}
            onBack={() => { hapticImpact('light'); setView('home'); }}
          />
        )}

        {view === 'alias' && (
          <SmartDecksPanel onStart={startGame} />
        )}

        {/* Player stats — classic landing only */}
        {view === 'home' && !master && !statsLoading && (
          <div className="w-full max-w-sm">
            <p className="text-brand-muted text-xs text-center mb-2 uppercase tracking-wider">
              {t('stats.title')}
            </p>
            {stats ? (
              <div className="ds-panel bg-brand-surface rounded-2xl border border-brand-border p-3">
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    { label: t('stats.games'), value: stats.games_played },
                    { label: t('stats.wins'),  value: stats.games_won },
                    { label: t('stats.cards'), value: stats.cards_guessed },
                    { label: t('stats.score'), value: stats.total_score },
                  ].map((item) => (
                    <div key={item.label}>
                      <p className="ds-display text-white font-bold text-lg leading-none">{item.value}</p>
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

        {/* ── Соревновательный режим: команда или один на один ── */}
        {view === 'mode_select' && (
          <HomeModeSelect
            onTeam={() => setView('create_team')}
            onOneVsOne={() => setView('create_1v1')}
            onBack={() => setView('home')}
          />
        )}

        {view === 'create_team' && (
          <HomeTeamSettings
            loading={loading}
            onCreate={() => createRoom()}
            onBack={() => setView('mode_select')}
          />
        )}

        {view === 'create_1v1' && (
          <HomeDuelSettings
            rounds={rounds1v1}
            onRounds={setRounds1v1}
            loading={loading}
            onCreate={() => createRoom({ total_rounds: rounds1v1 }, '1v1')}
            onBack={() => setView('mode_select')}
          />
        )}

        {view === 'join' && (
          <HomeJoinForm
            code={join.code}
            onCode={join.setCode}
            typedCode={join.typedCode}
            inputRef={join.inputRef}
            loading={loading}
            onSubmit={() => { void join.submit(); }}
            onJoinRoom={(roomCode) => { void join.enter(roomCode); }}
            playerId={player?.id ?? null}
            onBack={() => { join.setCode(''); setView('home'); }}
          />
        )}

        {/* Ошибка входа — из того же хука: она приходит из gameStore, и
            второй её читатель здесь развёл бы два источника одной правды. */}
        {join.error && (
          <div className="w-full max-w-sm bg-red-500/10 border border-red-500/30 rounded-2xl p-3 text-center">
            <p className="text-red-400 text-sm">{join.error}</p>
          </div>
        )}
      </div>

      {/* The master landing is a clean action stack — no commentator quotes. */}
      <div className="px-6 pt-2 pb-6 space-y-4">
        {!master && <QuoteRotator />}
        <p className="text-brand-muted/40 text-xs text-center">{t('home.footer')}</p>
      </div>
    </div>
  );
}
