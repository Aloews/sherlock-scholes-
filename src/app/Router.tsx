import { Routes, Route, Navigate } from 'react-router-dom';
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

export function Router() {
  return (
    <Routes>
      <Route path="/" element={<HomeScreen />} />
      <Route
        path="/lobby"
        element={
          <RequireRoom>
            <LobbyScreen />
          </RequireRoom>
        }
      />
      <Route
        path="/game"
        element={
          <RequireRoom>
            <GameScreen />
          </RequireRoom>
        }
      />
      <Route
        path="/end"
        element={
          <RequireRoom>
            <EndScreen />
          </RequireRoom>
        }
      />
      <Route path="/training" element={<TrainingScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
