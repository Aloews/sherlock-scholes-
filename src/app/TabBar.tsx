import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import { IconHome2, IconCards, IconUser, IconCrown, IconLock } from '@tabler/icons-react';
import { hapticImpact } from '@/shared/lib/telegram';
import { useProStore } from '@/shared/store/proStore';
import { requiresPro } from '@/shared/lib/proGate';

// Bottom tab navigation — part of the master design's app shell (the classic
// design has no tab bar and navigates from Home). Translucent over the page
// with a blur, matching the prototype.
//
// Only routes that actually exist are tabs. The prototype also has Рейтинг
// (leaderboard); it lands in a later phase of
// docs/PROGRESSION_FEATURES_HANDOFF.md, ahead of Профиль to match the
// prototype's nav order (Главная · Карты · Рейтинг · Профиль).

export const TAB_ROUTES = ['/', '/collection', '/profile', '/pro'] as const;

const TABS = [
  { to: '/',           icon: IconHome2, labelKey: 'tabs.home' },
  { to: '/collection', icon: IconCards, labelKey: 'tabs.collection' },
  { to: '/profile',    icon: IconUser,  labelKey: 'tabs.profile' },
  { to: '/pro',        icon: IconCrown, labelKey: 'tabs.pro' },
] as const;

export function TabBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // ⚠️ ЗАКРЫТАЯ ВКЛАДКА ОСТАЁТСЯ НА МЕСТЕ С ЗАМКОМ. Убрать её — значит сломать
  // раскладку из четырёх кнопок и спрятать от игрока то, за что он платит;
  // нажатие всё равно приведёт на витрину (ворота стоят в роутере). Замок
  // рисуется только когда статус УЖЕ известен — иначе он мигнёт подписчику.
  const isPro     = useProStore((s) => s.isPro);
  const proLoaded = useProStore((s) => s.loaded);

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-brand-border backdrop-blur-[10px]"
      style={{
        background: 'rgb(var(--brand-bg) / 0.92)',
        paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 6px)',
        paddingTop: '8px',
      }}
    >
      {TABS.map(({ to, icon: Icon, labelKey }) => {
        const active = pathname === to;
        const locked = proLoaded && !isPro && requiresPro(to);
        return (
          <button
            key={to}
            type="button"
            onClick={() => { hapticImpact('light'); navigate(to); }}
            aria-current={active ? 'page' : undefined}
            className={`flex-1 flex flex-col items-center gap-1 py-1.5 transition-colors ${
              active ? 'text-brand-accent' : 'text-brand-muted'
            }`}
          >
            <span className="relative flex items-center justify-center">
              <Icon size={21} stroke={1.75} />
              {locked && (
                <IconLock
                  size={11}
                  stroke={2.2}
                  className="absolute -right-2 -top-0.5 text-brand-accent"
                />
              )}
            </span>
            <span className="text-[9.5px] font-semibold">{t(labelKey)}</span>
          </button>
        );
      })}
    </nav>
  );
}
