import { Routes, Route, Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useGameStore } from '@/shared/store/gameStore';
import { HomeScreen }     from '@/screens/HomeScreen';
import { LobbyScreen }    from '@/screens/LobbyScreen';
import { GameScreen }     from '@/screens/GameScreen';
import { EndScreen }      from '@/screens/EndScreen';
import { TrainingScreen } from '@/screens/TrainingScreen';

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
      <Route path="/training" element={<PageTransition><TrainingScreen /></PageTransition>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
