import { BrowserRouter } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Router } from '@/app/Router';
import { useAuth } from '@/features/auth/useAuth';
import { useGameStore } from '@/shared/store/gameStore';

function AuthGate({ children }: { children: React.ReactNode }) {
  const { initialized } = useAuth();
  const { error } = useGameStore();
  const { t } = useTranslation();

  if (!initialized) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="text-5xl animate-pulse">⚽</div>
          <p className="text-zinc-500 text-sm">{t('app.loading')}</p>
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
  return (
    <BrowserRouter>
      <AuthGate>
        <Router />
      </AuthGate>
    </BrowserRouter>
  );
}
