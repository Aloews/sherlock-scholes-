// Telegram WebApp adapter — wraps window.Telegram.WebApp
// Gracefully degrades when running outside Telegram (dev mode)

export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
}

interface TelegramHaptic {
  impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
  notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  selectionChanged(): void;
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe: { user?: TelegramUser; [key: string]: unknown };
        ready(): void;
        expand(): void;
        close(): void;
        colorScheme: 'light' | 'dark';
        themeParams: Record<string, string>;
        HapticFeedback: TelegramHaptic;
        MainButton: {
          text: string;
          color: string;
          isVisible: boolean;
          isActive: boolean;
          show(): void;
          hide(): void;
          enable(): void;
          disable(): void;
          onClick(fn: () => void): void;
          offClick(fn: () => void): void;
        };
        BackButton: {
          isVisible: boolean;
          show(): void;
          hide(): void;
          onClick(fn: () => void): void;
          offClick(fn: () => void): void;
        };
        setHeaderColor(color: string): void;
        setBackgroundColor(color: string): void;
      };
    };
  }
}

// Dev fallback user — only used outside Telegram
const DEV_USER: TelegramUser = {
  id: 99999999,
  first_name: 'Dev',
  last_name: 'Player',
  username: 'dev_player',
};

const tg = typeof window !== 'undefined' ? window.Telegram?.WebApp : undefined;

export function initTelegram(): void {
  if (!tg) return;
  tg.ready();
  tg.expand();
  tg.setBackgroundColor('#09090b');
  tg.setHeaderColor('#09090b');
}

export function getTelegramUser(): TelegramUser | null {
  const user = tg?.initDataUnsafe?.user;
  if (user) return user;
  // Allow dev mode without Telegram
  if (import.meta.env.DEV) return DEV_USER;
  return null;
}

export function hapticImpact(style: 'light' | 'medium' | 'heavy' = 'medium'): void {
  tg?.HapticFeedback?.impactOccurred(style);
}

export function hapticSuccess(): void {
  tg?.HapticFeedback?.notificationOccurred('success');
}

export function hapticError(): void {
  tg?.HapticFeedback?.notificationOccurred('error');
}

export function hapticWarning(): void {
  tg?.HapticFeedback?.notificationOccurred('warning');
}

export function hapticSelection(): void {
  tg?.HapticFeedback?.selectionChanged();
}

export function isInsideTelegram(): boolean {
  return !!tg;
}
