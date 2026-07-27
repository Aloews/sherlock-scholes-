import { useTranslation } from 'react-i18next';
import { useNavigate, useLocation } from 'react-router-dom';
import { IconHome2, IconCards, IconCrown } from '@tabler/icons-react';
import { hapticImpact } from '@/shared/lib/telegram';

// Bottom tab navigation — part of the master design's app shell (the classic
// design has no tab bar and navigates from Home). Translucent over the page
// with a blur, matching the prototype.
//
// Only routes that actually exist are tabs. The prototype also has Рейтинг and
// Профиль; those need tables the schema doesn't have — see
// docs/PROGRESSION_FEATURES_HANDOFF.md. Add them here when they land.

export const TAB_ROUTES = ['/', '/collection', '/pro'] as const;

const TABS = [
  { to: '/',           icon: IconHome2, labelKey: 'tabs.home' },
  { to: '/collection', icon: IconCards, labelKey: 'tabs.collection' },
  { to: '/pro',        icon: IconCrown, labelKey: 'tabs.pro' },
] as const;

export function TabBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname } = useLocation();

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
            <Icon size={21} stroke={1.75} />
            <span className="text-[9.5px] font-semibold">{t(labelKey)}</span>
          </button>
        );
      })}
    </nav>
  );
}
