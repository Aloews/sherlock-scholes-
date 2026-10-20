import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useGameStore } from '@/shared/store/gameStore';
import { useSessionRestore } from '@/features/room/useSessionRestore';
import { usePresence } from '@/features/social/usePresence';
import { VoiceProvider } from '@/features/voice/VoiceProvider';
import { staffVerify } from '@/features/admin/adminApi';
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
const SourcesScreen  = lazy(() => import('@/screens/SourcesScreen').then((m) => ({ default: m.SourcesScreen })));
const MatchesScreen  = lazy(() => import('@/screens/MatchesScreen').then((m) => ({ default: m.MatchesScreen })));
const FantasyScreen  = lazy(() => import('@/screens/FantasyScreen').then((m) => ({ default: m.FantasyScreen })));
const MinigamesScreen = lazy(() => import('@/screens/MinigamesScreen').then((m) => ({ default: m.MinigamesScreen })));
const ChessScreen    = lazy(() => import('@/screens/ChessScreen').then((m) => ({ default: m.ChessScreen })));
const DigestScreen   = lazy(() => import('@/screens/DigestScreen').then((m) => ({ default: m.DigestScreen })));
const NewsScreen     = lazy(() => import('@/screens/NewsScreen').then((m) => ({ default: m.NewsScreen })));
const ArenaScreen    = lazy(() => import('@/screens/ArenaScreen').then((m) => ({ default: m.ArenaScreen })));
const ClubScreen     = lazy(() => import('@/screens/ClubScreen').then((m) => ({ default: m.ClubScreen })));
const LeagueTableScreen = lazy(() => import('@/screens/LeagueTableScreen').then((m) => ({ default: m.LeagueTableScreen })));
const DuelScreen     = lazy(() => import('@/screens/DuelScreen').then((m) => ({ default: m.DuelScreen })));
const SpotlightScreen = lazy(() => import('@/screens/SpotlightScreen').then((m) => ({ default: m.SpotlightScreen })));
const AmateurScreen  = lazy(() => import('@/screens/AmateurScreen').then((m) => ({ default: m.AmateurScreen })));
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
        <circle cx="12" cy="12" r="10" fill="currentColor" />
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

// ⚠️ ВОРОТА ПОДПИСКИ. Владелец: «спрячь все экраны кроме футбольного алиаса в
// подписку pro». Что открыто — в `@/shared/lib/proGate`, белым списком: забытый
// маршрут окажется ЗАКРЫТ, а не тихо открыт (разбор там же).
//
// ⚠️ ПОКА СТАТУС НЕ ЗАГРУЖЕН — НИ ЗАМКА, НИ ЭКРАНА. `isPro` стартует как false,
// и без этой ветки подписчик, открывший закрытый экран по прямой ссылке, на
// долю секунды улетал бы на витрину подписки, которую он уже купил. Держим
// маршрут тем же LazyFallback, что и подгрузку чанка.
//
// ⚠️ `replace`, А НЕ ОБЫЧНЫЙ ПЕРЕХОД: иначе «назад» из витрины возвращает на
// закрытый экран, тот снова отправляет на витрину, и кнопка «назад» перестаёт
// работать вовсе.
function AdminOnly({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'checking' | 'allowed' | 'denied'>('checking');

  useEffect(() => {
    let cancelled = false;
    const password = sessionStorage.getItem('ss_admin_pw');
    if (!password) {
      setStatus('denied');
      return () => { cancelled = true; };
    }
    void staffVerify(password).then((role) => {
      if (!cancelled) setStatus(role ? 'allowed' : 'denied');
    }).catch(() => {
      if (!cancelled) setStatus('denied');
    });
    return () => { cancelled = true; };
  }, []);

  if (status === 'checking') return <LazyFallback />;
  if (status === 'denied') return <Navigate to="/admin" replace />;
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
  // ⚠️ Удар сердца ЖИВЁТ НА РОУТЕРЕ, а не на экране друзей. Присутствие значит
  // «человек в приложении», а не «человек смотрит список друзей»: повесить его
  // на экран значило бы, что онлайн видны только те, кто прямо сейчас открыл
  // именно этот экран, то есть почти никто. Стучится только при видимой
  // вкладке — см. usePresence.
  usePresence();
  // Public navigation is intentionally limited to the football Alias.

  return (
    // VoiceProvider sits ABOVE the routes on purpose: the session must survive
    // lobby -> /game, which unmounts the lobby. See VoiceProvider.tsx.
    <VoiceProvider>
    <div>
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
      <Route path="/collection" element={<AdminOnly><PageTransition><CollectionScreen /></PageTransition></AdminOnly>} />
      <Route path="/profile"   element={<PageTransition><ProfileScreen /></PageTransition>} />
      {/* ⚠️ БЕЗ ProOnly НАМЕРЕННО. Экран источников — это выполнение лицензий
          (CC BY-SA требует НАЗВАТЬ источник), а не возможность подписки:
          спрятать его за подписку значило бы не выполнить условие для тех,
          кто её не купил, — то есть для большинства. */}
      <Route path="/sources"   element={<AdminOnly><PageTransition><SourcesScreen /></PageTransition></AdminOnly>} />
      <Route path="/friends"   element={<AdminOnly><PageTransition><FriendsScreen /></PageTransition></AdminOnly>} />
      <Route path="/matches"   element={<AdminOnly><PageTransition><MatchesScreen /></PageTransition></AdminOnly>} />
      <Route path="/fantasy"   element={<AdminOnly><PageTransition><FantasyScreen /></PageTransition></AdminOnly>} />
      {/* Без PageTransition, как и арена: обёртка анимирует transform родителя,
          и первые касания уезжали бы вместе с ним — а здесь каждое касание
          попадает в конкретную клетку доски. */}
      <Route path="/chess"     element={<AdminOnly><ChessScreen /></AdminOnly>} />
      <Route path="/digest"    element={<AdminOnly><PageTransition><DigestScreen /></PageTransition></AdminOnly>} />
      {/* Без PageTransition: арена рисует canvas, а обёртка анимирует
          transform родителя — первые кадры игры уезжали бы вместе с ним. */}
      <Route path="/news"      element={<AdminOnly><PageTransition><NewsScreen /></PageTransition></AdminOnly>} />
      <Route path="/duel"      element={<AdminOnly><PageTransition><DuelScreen /></PageTransition></AdminOnly>} />
      <Route path="/spotlight" element={<AdminOnly><PageTransition><SpotlightScreen /></PageTransition></AdminOnly>} />
      <Route path="/amateur"   element={<AdminOnly><PageTransition><AmateurScreen /></PageTransition></AdminOnly>} />
      {/* ⚠️ СТАРЫЕ АДРЕСА ВЕДУТ СРАЗУ В СВОЙ РАЗДЕЛ, а не в оглавление
          коллекции: перенаправление в оглавление читалось бы как «ссылка
          сломалась». Не удалены — на них ведут уже разосланные ссылки и
          прежние сборки клиента. Ровно тот же приём, что у /quiz и
          /arena/online. */}
      <Route path="/ratings"   element={<Navigate to="/collection?view=stats" replace />} />
      <Route path="/clubs"     element={<Navigate to="/collection?view=clubs" replace />} />
      {/* Ключ клуба едет в адресе и содержит пробелы («zenit st petersburg»),
          поэтому он закодирован на стороне ссылки, а useParams его раскодирует. */}
      <Route path="/club/:key" element={<AdminOnly><PageTransition><ClubScreen /></PageTransition></AdminOnly>} />
      {/* Таблица: без турнира в адресе открывается самая полная — экран со
          списком лиг и пустотой под ним требовал бы лишнего касания. */}
      <Route path="/table"  element={<AdminOnly><PageTransition><LeagueTableScreen /></PageTransition></AdminOnly>} />
      <Route path="/table/:tournament" element={<AdminOnly><PageTransition><LeagueTableScreen /></PageTransition></AdminOnly>} />
      {/* Без PageTransition, как и локальная арена: обёртка анимирует transform
          родителя, и первые кадры холста уезжали бы вместе с ним. */}
      {/* Старый адрес онлайн-арены: на него ведут ссылки-приглашения, уже
          разосланные игрокам, и просто удалить его значит их сломать. Экран
          теперь один и сам выбирает режим — см. шапку ArenaScreen. */}
      <Route path="/minigames" element={<AdminOnly><MinigamesScreen /></AdminOnly>} />
      {/* Старые адреса мини-игр: ведут в тот же экран, но сразу в свою игру
          (см. `?game=` в шапке MinigamesScreen). Не удалены — на них ведут
          ссылки, уже разосланные игрокам. */}
      <Route path="/quiz"   element={<Navigate to="/minigames?game=quiz" replace />} />
      <Route path="/famous" element={<Navigate to="/minigames?game=famous" replace />} />
      <Route path="/squad"  element={<Navigate to="/minigames?game=squad" replace />} />
      <Route path="/arena/online" element={<Navigate to="/arena" replace />} />
      <Route path="/arena"     element={<AdminOnly><ArenaScreen /></AdminOnly>} />
      <Route path="/pro"       element={<Navigate to="/admin" replace />} />
      <Route path="/admin"     element={<AdminScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
    </div>
    </VoiceProvider>
  );
}
