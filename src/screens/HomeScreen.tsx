import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  IconUsersGroup, IconUser, IconUserCircle, IconHelp, IconVolume, IconVolumeOff,
  IconCrown, IconBallFootball, IconTrophy,
} from '@tabler/icons-react';
import { Button } from '@/shared/ui/Button';
import { Avatar } from '@/shared/ui/Avatar';
import { IconButton } from '@/shared/ui/IconButton';
import { LanguageToggle } from '@/shared/ui/LanguageToggle';
import { DesignToggle } from '@/shared/ui/DesignToggle';
import { HomeLandingMaster } from '@/screens/home/HomeLandingMaster';
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
import { hapticImpact, cloudGet, getStartParam } from '@/shared/lib/telegram';
import { useMainButton } from '@/shared/lib/useMainButton';
import { useKeyboardOpen } from '@/shared/lib/useKeyboardOpen';
import { normalizeCode, sanitizeCodeInput, CODE_LENGTH } from '@/features/lobby/invite';
import { PendingInvitesPanel } from '@/features/lobby/PendingInvitesPanel';
import { FRAME_COLOR } from '@/shared/lib/pro';
import { DeckPickerScreen } from './DeckPickerScreen';
import type { DeckFilter } from '@/shared/types/deck';

type View = 'home' | 'mode_select' | 'create_team' | 'create_1v1' | 'create_training'
  | 'join' | 'joining';

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
  const [code,      setCode]      = useState('');
  const [rounds1v1, setRounds1v1] = useState(3);

  // What the typed code amounts to. Null until it is a whole one — every use
  // below asks this rather than measuring the string, so "long enough" and
  // "actually a code" can never drift apart.
  const typedCode = normalizeCode(code);

  // Every way into a room ends here: a typed code, an invite link, a friend's
  // invitation. One path means one set of failure messages and one screen to
  // land on — a second entrance is the one that goes stale.
  const joinByCode = async (roomCode: string) => {
    const valid = normalizeCode(roomCode);
    if (!valid) return;
    // Same reason as the start_param effect below: joinRoom refuses a null
    // player outright, so acting before authentication lands spends the
    // attempt on a guaranteed failure.
    if (!player) return;
    setCode(valid);
    setView('joining');
    await joinRoom(valid);
    // joinRoom navigates on success, so still being here means it failed.
    // Fall back to the form, with the code and the error already in place.
    if (!useGameStore.getState().room) setView('join');
  };

  const handleJoin = async () => {
    if (!typedCode) return;
    await joinRoom(typedCode);
  };

  // THE LAST CHARACTER IS THE BUTTON. Six characters is the whole code, so
  // there is nothing left to decide once they are there — and asking for a tap
  // afterwards is asking the player to find a button that the keyboard is
  // sitting on top of (docs/LOBBY_AND_VOICE_FIXES.md §2).
  //
  // Guarded by the code we last tried rather than a boolean: after a failure
  // the field keeps its contents so it can be corrected, and a plain "already
  // tried" flag would either re-fire on every render or never fire again.
  const autoJoined = useRef<string | null>(null);
  useEffect(() => {
    if (view !== 'join' || !typedCode || loading) return;
    // Not yet authenticated: joinRoom would refuse instantly, and the latch
    // below would record that refusal as "already tried this code".
    if (!player) return;
    if (autoJoined.current === typedCode) return;
    autoJoined.current = typedCode;
    void joinRoom(typedCode);
  }, [view, typedCode, loading, joinRoom, player]);

  // Arrived through an invite link (t.me/…?startapp=CODE): Telegram hands the
  // payload over as start_param, and this is the only place that reads it —
  // without this half, the link opens the app and the code goes nowhere.
  // It is unverified input, so it is validated as a room code before use.
  const startParamHandled = useRef(false);
  useEffect(() => {
    if (startParamHandled.current) return;
    const invited = normalizeCode(getStartParam());
    if (!invited) return;

    // WAIT FOR THE PLAYER, AND ONLY THEN CLAIM THE PARAM. This is why invite
    // links did not work.
    //
    // Authentication is asynchronous, so `player` is null for the first render
    // or two after launch — and joinRoom answers a null player instantly with
    // `errors.auth` rather than joining. The latch used to be set BEFORE that
    // attempt, so the one attempt an invite got was the one guaranteed to
    // fail: the invitee landed on the code form with an auth error, holding a
    // link that had worked perfectly.
    //
    // joinRoom's identity changes when the player arrives (it closes over
    // them), so this effect re-runs on its own — it only ever needed to stop
    // burning the single attempt before there was anybody to join as.
    if (!player) return;

    startParamHandled.current = true;
    setCode(invited);
    // NOT the join view: it autofocuses the code field, so an invitee who has
    // nothing to type would still get a keyboard thrown at them over a form
    // that is already filled in. This view has no input at all.
    setView('joining');

    let cancelled = false;
    void (async () => {
      await joinRoom(invited);
      if (cancelled) return;
      // joinRoom navigates to the lobby on success, so reaching here with no
      // room means it failed — fall back to the form with the code and the
      // error already in place.
      if (!useGameStore.getState().room) setView('join');
    })();
    return () => { cancelled = true; };
    // `player` is here so the effect re-runs the moment authentication lands.
    // Without it the guard above would be a permanent refusal rather than a
    // wait, which is the same bug in a different shape.
  }, [joinRoom, player]);

  // Telegram draws MainButton above the on-screen keyboard, which is exactly
  // where the in-page "Join" button is not: on a phone the keyboard covers it
  // the moment the field takes focus (docs/LOBBY_AND_VOICE_FIXES.md §2).
  useMainButton({
    visible: view === 'join',
    text: t('home.join_room'),
    active: typedCode !== null && !loading,
    onClick: () => { void handleJoin(); },
  });

  // MainButton rides above the keyboard, but the field itself can still end up
  // under it — the join view autofocuses, so on a short screen the keyboard
  // comes up over the very thing being typed into. Telegram tells us when that
  // happens (viewportHeight drops, viewportStableHeight does not); bring the
  // field back into the middle of what is left.
  const codeInputRef = useRef<HTMLInputElement>(null);
  const keyboardOpen = useKeyboardOpen();
  useEffect(() => {
    if (view !== 'join' || !keyboardOpen) return;
    codeInputRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [view, keyboardOpen]);

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

  // An invite link goes straight into the room. All the player sees on the way
  // is which room they are entering — no landing, no form, no keyboard.
  if (view === 'joining') {
    return (
      <div className="min-h-screen bg-brand-bg ds-screen flex flex-col items-center justify-center px-6 gap-4">
        <img src="/logo-white-clean.png" alt="" className="w-[132px] max-w-full h-auto" />
        <span
          className="w-[30px] h-[30px] rounded-full animate-spin"
          style={{
            border: '2.5px solid rgb(var(--brand-accent) / 0.2)',
            borderTopColor: 'rgb(var(--brand-accent))',
            animationDuration: '0.9s',
          }}
          aria-hidden
        />
        <p className="text-white text-sm" aria-live="polite">{t('home.joining')}</p>
        <p className="ds-display text-2xl font-black text-white tracking-widest">{code}</p>
      </div>
    );
  }

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
          {/* Classic has no tab bar, so these two keep their only entry point. */}
          {!master && (
            <IconButton onClick={() => navigate('/pro')} label={t('pro.title')} active={isPro}>
              <IconCrown size={17} stroke={1.75} />
            </IconButton>
          )}
          {!master && player && (
            <IconButton onClick={() => navigate('/profile')} label={t('profile.title')}>
              <IconUserCircle size={17} stroke={1.75} />
            </IconButton>
          )}
        </div>
        {player && (
          <button
            type="button"
            onClick={() => { hapticImpact('light'); navigate('/profile'); }}
            aria-label={t('profile.title')}
            className="rounded-full inline-block shrink-0"
            style={isPro && FRAME_COLOR[proFrame]
              ? { boxShadow: `0 0 0 2px ${FRAME_COLOR[proFrame]}` }
              : undefined}
          >
            <Avatar
              name={`${player.first_name} ${player.last_name ?? ''}`.trim()}
              src={player.avatar_url}
              size="md"
            />
          </button>
        )}
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
            <PendingInvitesPanel onJoin={(invitedCode) => { void joinByCode(invitedCode); }} />
          </div>
        )}

        {/* What football is on next. Under the invitations and above the
            landing: it is a reason to open the app on a day with no game in
            it, which is exactly the day the landing has nothing to offer. */}
        {view === 'home' && (
          <button
            type="button"
            onClick={() => { hapticImpact('light'); navigate('/matches'); }}
            className="w-full max-w-sm ds-panel bg-brand-surface border border-brand-border rounded-2xl px-4 py-3 flex items-center gap-3 text-left hover:border-brand-accent/50 transition-colors"
          >
            <IconBallFootball size={20} stroke={1.75} className="text-brand-muted shrink-0" />
            <span className="flex-1 text-white text-sm">{t('home.matches_link')}</span>
            <span className="text-brand-muted text-lg leading-none">›</span>
          </button>
        )}

        {view === 'home' && (
          <button
            type="button"
            onClick={() => { hapticImpact('light'); navigate('/fantasy'); }}
            className="w-full max-w-sm ds-panel bg-brand-surface border border-brand-border rounded-2xl px-4 py-3 flex items-center gap-3 text-left hover:border-brand-accent/50 transition-colors"
          >
            <IconTrophy size={20} stroke={1.75} className="text-brand-muted shrink-0" />
            <span className="flex-1 text-white text-sm">{t('home.fantasy_link')}</span>
            <span className="text-brand-muted text-lg leading-none">›</span>
          </button>
        )}

        {view === 'home' && (
          <button
            type="button"
            onClick={() => { hapticImpact('light'); navigate('/quiz'); }}
            className="w-full max-w-sm ds-panel bg-brand-surface border border-brand-border rounded-2xl px-4 py-3 flex items-center gap-3 text-left hover:border-brand-accent/50 transition-colors"
          >
            <IconHelp size={20} stroke={1.75} className="text-brand-muted shrink-0" />
            <span className="flex-1 text-white text-sm">{t('home.quiz_link')}</span>
            <span className="text-brand-muted text-lg leading-none">›</span>
          </button>
        )}

        {/* ── Landing, master design ── */}
        {view === 'home' && master && (
          <HomeLandingMaster
            playerName={player ? `${player.first_name} ${player.last_name ?? ''}`.trim() : null}
            onQuickGame={() => { hapticImpact('light'); setView('create_training'); }}
            onCompetitive={() => { hapticImpact('light'); setView('mode_select'); }}
            onJoin={() => { hapticImpact('light'); setView('join'); }}
          />
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

        {/* ── Main CTA, classic design: quick game, competitive, join ── */}
        {view === 'home' && !master && (
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
            <Button fullWidth size="lg" variant="secondary" onClick={() => { hapticImpact('light'); navigate('/collection'); }}>
              {t('home.collection')}
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
                ref={codeInputRef}
                type="text"
                maxLength={CODE_LENGTH}
                value={code}
                // Sanitised, not uppercased: the field must hold exactly what
                // a code can hold, so the controlled value never disagrees with
                // what the keyboard just produced. See sanitizeCodeInput.
                onChange={(e) => setCode(sanitizeCodeInput(e.target.value))}
                // The keyboard's own action key submits, so the player never
                // has to reach a button hidden behind that keyboard.
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleJoin(); } }}
                enterKeyHint="go"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                placeholder={t('home.room_code_placeholder')}
                className="w-full h-14 bg-brand-surface border border-brand-border rounded-2xl px-4 text-white text-2xl font-black tracking-[0.5em] text-center uppercase placeholder-brand-muted/50 focus:outline-none focus:border-brand-accent transition-colors"
                autoFocus
              />
            </div>
            <Button fullWidth size="lg" loading={loading} disabled={typedCode === null} onClick={handleJoin}>
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

      {/* The master landing is a clean action stack — no commentator quotes. */}
      <div className="px-6 pt-2 pb-6 space-y-4">
        {!master && <QuoteRotator />}
        <p className="text-brand-muted/40 text-xs text-center">{t('home.footer')}</p>
      </div>
    </div>
  );
}
