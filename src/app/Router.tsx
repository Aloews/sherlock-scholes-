import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useGameStore } from '@/shared/store/gameStore';
import { HomeScreen }     from '@/screens/HomeScreen';

// HomeScreen stays static so the first screen never flashes. The rest are
// lazy-loaded to keep them out of the initial bundle (faster cold start).
const LobbyScreen    = lazy(() => import('@/screens/LobbyScreen').then((m) => ({ default: m.LobbyScreen })));
const GameScreen     = lazy(() => import('@/screens/GameScreen').then((m) => ({ default: m.GameScreen })));
const EndScreen      = lazy(() => import('@/screens/EndScreen').then((m) => ({ default: m.EndScreen })));
const TrainingScreen = lazy(() => import('@/screens/TrainingScreen').then((m) => ({ default: m.TrainingScreen })));
const TutorialScreen = lazy(() => import('@/screens/TutorialScreen').then((m) => ({ default: m.TutorialScreen })));
// Admin card editor — separate route, NOT linked from the game menu.
const AdminScreen = lazy(() => import('@/screens/AdminScreen').then((m) => ({ default: m.AdminScreen })));

// Full-screen fallback in the app style: brand bg + a small bouncing ball
// (matching the splash), no text, so there's no white flash while chunks load.
function LazyFallback() {
  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center">
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
  const room = useGameStore((s) => s.room);
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
  return (
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
      <Route path="/admin"     element={<AdminScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  );
}
