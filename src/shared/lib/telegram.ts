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
        openTelegramLink(url: string): void;
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
  tg.setBackgroundColor('#0A0E1A');
  tg.setHeaderColor('#0A0E1A');
}

export function getTelegramUser(): TelegramUser | null {
  const user = tg?.initDataUnsafe?.user;
  if (user) return user;
  // Allow dev mode without Telegram
  if (import.meta.env.DEV) return DEV_USER;
  return null;
}

// Raw, signed initData string for SERVER-SIDE validation (get_user_status).
// Empty outside Telegram (dev / plain browser) — the server then can't verify
// a user, so Pro stays off, which is the safe default.
export function getRawInitData(): string {
  return tg?.initData ?? '';
}

// Telegram's HapticFeedback only works inside the Telegram mobile app. In a
// plain mobile browser (and in dev) we fall back to the Vibration API, so
// buttons still buzz. iOS Safari has no vibration API at all — silently a
// no-op there, nothing we can do.
function fallbackVibrate(pattern: number | number[]): void {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // unsupported / blocked — stay silent
  }
}

const IMPACT_MS: Record<'light' | 'medium' | 'heavy', number> = {
  light: 10,
  medium: 25,
  heavy: 45,
};

export function hapticImpact(style: 'light' | 'medium' | 'heavy' = 'medium'): void {
  if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred(style);
  else fallbackVibrate(IMPACT_MS[style]);
}

export function hapticSuccess(): void {
  if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
  else fallbackVibrate([15, 60, 25]);
}

export function hapticError(): void {
  if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
  else fallbackVibrate([45, 60, 45]);
}

export function hapticWarning(): void {
  if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('warning');
  else fallbackVibrate([30, 50, 30]);
}

export function hapticSelection(): void {
  if (tg?.HapticFeedback) tg.HapticFeedback.selectionChanged();
  else fallbackVibrate(5);
}

export function isInsideTelegram(): boolean {
  return !!tg;
}
