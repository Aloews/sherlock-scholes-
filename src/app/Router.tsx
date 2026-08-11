import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useGameStore } from '@/shared/store/gameStore';
import { useSessionRestore } from '@/features/room/useSessionRestore';
import { VoiceProvider } from '@/features/voice/VoiceProvider';
import { useDesign } from '@/shared/design/useDesign';
import { TabBar, TAB_ROUTES } from '@/app/TabBar';
import { HomeScreen }     from '@/screens/HomeScreen';

// HomeScreen stays static so the first screen never flashes. The rest are
// lazy-loaded to keep them out of the initial bundle (faster cold start).
const LobbyScreen    = lazy(() => import('@/screens/LobbyScreen').then((m) => ({ default: m.LobbyScreen })));
const GameScreen     = lazy(() => import('@/screens/GameScreen').then((m) => ({ default: m.GameScreen })));
const EndScreen      = lazy(() => import('@/screens/EndScreen').then((m) => ({ default: m.EndScreen })));
const TrainingScreen = lazy(() => import('@/screens/TrainingScreen').then((m) => ({ default: m.TrainingScreen })));
const TutorialScreen = lazy(() => import('@/screens/TutorialScreen').then((m) => ({ default: m.TutorialScreen })));
const CollectionScreen = lazy(() => import('@/screens/CollectionScreen').then((m) => ({ default: m.CollectionScreen })));
const ProfileScreen  = lazy(() => import('@/screens/ProfileScreen').then((m) => ({ default: m.ProfileScreen })));
const FriendsScreen  = lazy(() => import('@/screens/FriendsScreen').then((m) => ({ default: m.FriendsScreen })));
const MatchesScreen  = lazy(() => import('@/screens/MatchesScreen').then((m) => ({ default: m.MatchesScreen })));
const FantasyScreen  = lazy(() => import('@/screens/FantasyScreen').then((m) => ({ default: m.FantasyScreen })));
const QuizScreen     = lazy(() => import('@/screens/QuizScreen').then((m) => ({ default: m.QuizScreen })));
const DigestScreen   = lazy(() => import('@/screens/DigestScreen').then((m) => ({ default: m.DigestScreen })));
const ProScreen      = lazy(() => import('@/screens/ProScreen').then((m) => ({ default: m.ProScreen })));
// Admin card editor — separate route, NOT linked from the game menu.
const AdminScreen = lazy(() => import('@/screens/AdminScreen').then((m) => ({ default: m.AdminScreen })));

// Full-screen fallback in the app style: brand bg + a small bouncing ball
// (matching the splash), no text, so there's no white flash while chunks load.
function LazyFallback() {
  return (
    <div className="min-h-screen bg-brand-bg ds-screen flex items-center justify-center">
      <motion.svg
        viewBox="0 0 24 24"
        className="w-12 h-12"
        animate={{ y: [0, -6, 0] }}
        transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <circle cx="12" cy="12" r="10" fill="#fff" />
      </motion.svg>
    </div>
  );
}

function RequireRoom({ children }: { children: React.ReactNode }) {
  const room      = useGameStore((s) => s.room);
  const restoring = useGameStore((s) => s.restoring);
  // A reload lands here with an empty store; hold the route while
  // useSessionRestore checks for an unfinished room instead of bouncing home.
  if (!room && restoring) return <LazyFallback />;
  if (!room) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  );
}

export function Router() {
  useSessionRestore();
  const { pathname } = useLocation();
  // The tab bar belongs to the master app shell, and only to its root routes —
  // never over a live game, lobby or results, where leaving mid-round by a
  // stray tap would be destructive. `with-tabbar` shortens the screens'
  // min-h-screen by the bar's height (see index.css).
  const showTabs = useDesign() === 'master'
    && (TAB_ROUTES as readonly string[]).includes(pathname);

  return (
    // VoiceProvider sits ABOVE the routes on purpose: the session must survive
    // lobby -> /game, which unmounts the lobby. See VoiceProvider.tsx.
    <VoiceProvider>
    <div className={showTabs ? 'with-tabbar' : undefined}>
    <Suspense fallback={<LazyFallback />}>
    <Routes>
      <Route path="/" element={<PageTransition><HomeScreen /></PageTransition>} />
      <Route
        path="/lobby"
        element={
          <RequireRoom>
            <PageTransition><LobbyScreen /></PageTransition>
          </RequireRoom>
        }
      />
      <Route
        path="/game"
        element={
          <RequireRoom>
            <PageTransition><GameScreen /></PageTransition>
          </RequireRoom>
        }
      />
      <Route
        path="/end"
        element={
          <RequireRoom>
            <PageTransition><EndScreen /></PageTransition>
          </RequireRoom>
        }
      />
      <Route path="/training"  element={<PageTransition><TrainingScreen /></PageTransition>} />
      <Route path="/tutorial"  element={<PageTransition><TutorialScreen /></PageTransition>} />
      <Route path="/collection" element={<PageTransition><CollectionScreen /></PageTransition>} />
      <Route path="/profile"   element={<PageTransition><ProfileScreen /></PageTransition>} />
      <Route path="/friends"   element={<PageTransition><FriendsScreen /></PageTransition>} />
      <Route path="/matches"   element={<PageTransition><MatchesScreen /></PageTransition>} />
      <Route path="/fantasy"   element={<PageTransition><FantasyScreen /></PageTransition>} />
      <Route path="/quiz"      element={<PageTransition><QuizScreen /></PageTransition>} />
      <Route path="/digest"    element={<PageTransition><DigestScreen /></PageTransition>} />
      <Route path="/pro"       element={<PageTransition><ProScreen /></PageTransition>} />
      <Route path="/admin"     element={<AdminScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
    {showTabs && <TabBar />}
    </div>
    </VoiceProvider>
  );
}
