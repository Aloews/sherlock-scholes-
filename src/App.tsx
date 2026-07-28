import { useEffect, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { Router } from '@/app/Router';
import { useAuth } from '@/features/auth/useAuth';
import { useProStatus } from '@/features/pro/useProStatus';
import { useGameStore } from '@/shared/store/gameStore';
import { wakeSupabase } from '@/features/game/cardRandomizer';
import { useDesignSync, useDesign } from '@/shared/design/useDesign';

const SPLASH_TIMEOUT_MS = 9_000;

function AuthGate({ children }: { children: React.ReactNode }) {
  const master = useDesign() === 'master';
  const { initialized } = useAuth();
  const { error } = useGameStore();
  const { t } = useTranslation();

  // Fetch server-validated Pro status (no-op outside Telegram).
  useProStatus();

  // Failsafe: if auth never settles, surface a reload option instead of a hung splash.
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    if (initialized) return;
    const id = setTimeout(() => setTimedOut(true), SPLASH_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [initialized]);

  if (!initialized) {
    return (
      <div className="min-h-screen bg-brand-bg ds-screen flex items-center justify-center">
        <div className="text-center space-y-4 max-w-sm px-6">
          {timedOut ? (
            <>
              <p className="text-zinc-300 text-sm">{t('app.load_failed')}</p>
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center justify-center h-11 px-6 rounded-2xl bg-brand-accent text-brand-bg font-medium"
              >
                {t('app.reload')}
              </button>
            </>
          ) : master ? (
            /* Master splash: the gradient wordmark over a ring spinner, per
               the prototype. Classic keeps its bouncing ball. */
            <div className="flex flex-col items-center gap-5">
              <img src="/logo-white-clean.png" alt="Шерлок Скоулс" className="w-[168px] h-auto" />
              <span
                className="w-[30px] h-[30px] rounded-full animate-spin"
                style={{
                  border: '2.5px solid rgb(var(--brand-accent) / 0.2)',
                  borderTopColor: 'rgb(var(--brand-accent))',
                  animationDuration: '0.9s',
                }}
                aria-hidden
              />
              <p className="text-[11px] uppercase tracking-[0.18em] text-brand-muted">
                {t('app.loading')}
              </p>
            </div>
          ) : (
            <>
              <motion.svg
                viewBox="0 0 24 24"
                className="w-16 h-16 mx-auto"
                animate={{ y: [0, -6, 0] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
              >
                <circle cx="12" cy="12" r="10" fill="#fff" />
              </motion.svg>
              <p className="text-zinc-500 text-sm">{t('app.loading')}</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {children}
      {/* Global error toast */}
      {error && (
        <div className="fixed bottom-4 left-4 right-4 bg-red-900/80 backdrop-blur border border-red-500/30 rounded-2xl p-4 z-50 animate-slide-up">
          <p className="text-red-300 text-sm text-center">{error}</p>
        </div>
      )}
    </>
  );
}

export default function App() {
  // Free-tier Supabase sleeps when idle and the FIRST query of a cold session
  // can take 5–30s — players saw the first round load with no cards. Ping the
  // DB the moment the app boots (before auth even settles), so it is warming
  // up while the player is still on the splash/home/lobby.
  useEffect(() => { void wakeSupabase(); }, []);

  // Keep <html data-design> on the persisted design system. index.html already
  // set it before first paint; this owns it from here on (switcher, rehydrate).
  useDesignSync();

  return (
    <BrowserRouter>
      <AuthGate>
        <Router />
      </AuthGate>
    </BrowserRouter>
  );
}
