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

// Result of Telegram.WebApp.openInvoice — 'paid' is the success case.
export type InvoiceStatus = 'paid' | 'cancelled' | 'failed' | 'pending';

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
          // Documented setters. `text` is readable but Telegram only repaints
          // on setText/setParams, so assigning the property is not enough.
          // Optional because old clients predate them.
          setText?(text: string): void;
          setParams?(params: {
            text?: string; color?: string; text_color?: string;
            is_active?: boolean; is_visible?: boolean;
          }): void;
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
        // Geometry. `viewportHeight` shrinks when the on-screen keyboard opens;
        // `viewportStableHeight` keeps the last stable value, so the difference
        // between them is how we know the keyboard is up.
        viewportHeight?: number;
        viewportStableHeight?: number;
        onEvent?(event: 'viewportChanged', fn: () => void): void;
        offEvent?(event: 'viewportChanged', fn: () => void): void;
        // Bot API 7.7. Optional because older clients predate them, and on
        // those clients a downward drag closes the Mini App — see
        // setVerticalSwipes below.
        disableVerticalSwipes?(): void;
        enableVerticalSwipes?(): void;
        openTelegramLink(url: string): void;
        openLink(url: string, options?: { try_instant_view?: boolean }): void;
        openInvoice(url: string, callback?: (status: InvoiceStatus) => void): void;
        CloudStorage?: {
          getItem(key: string, cb: (err: string | null, value?: string) => void): void;
          setItem(key: string, value: string, cb?: (err: string | null, ok?: boolean) => void): void;
        };
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

/**
 * Разрешить или запретить закрытие мини-приложения свайпом вниз.
 *
 * ЭТО НУЖНО ЛЮБОМУ ЭКРАНУ, ГДЕ ПАЛЕЦ ТЯНУТ ВНИЗ. По умолчанию Telegram на
 * Android понимает такое движение как «свернуть приложение»: на арене джойстик
 * тянут вниз каждые несколько секунд, и без запрета игра сворачивается сама.
 *
 * Метод появился в Bot API 7.7, поэтому необязательный: на старом клиенте
 * запретить нечего, и вызов просто ничего не делает. Экран обязан вернуть всё
 * как было при уходе — запрет глобальный, а не для одного экрана.
 */
export function setVerticalSwipes(enabled: boolean): void {
  if (!tg) return;
  if (enabled) tg.enableVerticalSwipes?.();
  else tg.disableVerticalSwipes?.();
}

// Open the Telegram Stars payment sheet for an invoice link (from tg-pay).
// The callback fires with the final status ('paid' on success). Returns false
// when openInvoice is unavailable (outside Telegram / old client) so the caller
// can surface a fallback instead of silently doing nothing.
export function openInvoice(link: string, cb: (status: InvoiceStatus) => void): boolean {
  if (!tg?.openInvoice) return false;
  tg.openInvoice(link, cb);
  return true;
}

// Opens a t.me link with the Telegram client's own handler, which keeps the
// user inside the app (window.open would bounce them to a browser tab and
// often gets blocked). Returns false outside Telegram so the caller can fall
// back — EndScreen's share does exactly that.
export function openTelegramLink(url: string): boolean {
  if (!tg?.openTelegramLink) return false;
  tg.openTelegramLink(url);
  return true;
}

/**
 * Opens an ORDINARY web link outside the Mini App.
 *
 * Different method from openTelegramLink, and the difference matters: that one
 * is for t.me addresses and hands them to the Telegram client, this one is for
 * everything else and hands them to the system browser. Loading a news site
 * inside the WebView instead would replace the game with a page that has no
 * way back to it.
 *
 * Falls back to window.open outside Telegram — the app runs in a plain browser
 * during development, and a link that silently does nothing there is a link
 * nobody can test.
 */
export function openLink(url: string): void {
  if (tg?.openLink) { tg.openLink(url); return; }
  window.open(url, '_blank', 'noopener,noreferrer');
}

// The `startapp=` payload of the deep link the app was opened with. Telegram
// puts it in initDataUnsafe.start_param; it is UNVERIFIED (hence "unsafe"),
// so treat it as untrusted input — here it is only ever a room code, which is
// validated before use and gives no privilege on its own.
export function getStartParam(): string {
  const raw = tg?.initDataUnsafe?.start_param;
  return typeof raw === 'string' ? raw : '';
}

/**
 * Код комнаты, которым нас открыли — из обеих форм приглашения.
 *
 * ДВА МЕСТА, ПОТОМУ ЧТО TELEGRAM ДОСТАВЛЯЕТ ИХ ПО-РАЗНОМУ, и ни одно из них не
 * покрывает другое:
 *
 *   ссылка `?startapp=КОД`  → initDataUnsafe.start_param
 *   кнопка web_app с URL    → обычный location.search приложения
 *
 * Вторая форма появилась потому, что первая требует включённого Main Mini App,
 * а без него Android отвечает `BOT_INVALID`. Бот на `/start КОД` присылает
 * кнопку, ведущую на `…/?room=КОД`, и код приезжает уже в адресе страницы.
 *
 * start_param читается первым: если пришли обе формы сразу, та, что от
 * Telegram, ближе к истине, чем строка адреса, которую можно набрать руками.
 * Значение в любом случае НЕПРОВЕРЕННОЕ — это код комнаты, и он проверяется
 * перед использованием.
 */
export function getInviteCode(): string {
  const fromStartParam = getStartParam();
  if (fromStartParam) return fromStartParam;
  try {
    return new URLSearchParams(window.location.search).get('room') ?? '';
  } catch {
    return '';
  }
}

export interface Viewport {
  /** Visible height right now — the keyboard eats into this one. */
  height: number;
  /** The last stable height, unaffected by the keyboard opening. */
  stableHeight: number;
}

/** Current geometry, or null outside Telegram (or on a client too old to report it). */
export function getViewport(): Viewport | null {
  const h = tg?.viewportHeight;
  const s = tg?.viewportStableHeight;
  if (typeof h !== 'number' || typeof s !== 'number') return null;
  return { height: h, stableHeight: s };
}

/**
 * Subscribes to Telegram's `viewportChanged`, which fires when the keyboard
 * opens or closes (among other things). Returns a cleanup function; no-op
 * outside Telegram.
 */
export function onViewportChanged(fn: () => void): () => void {
  if (!tg?.onEvent || !tg.offEvent) return () => {};
  tg.onEvent('viewportChanged', fn);
  return () => tg.offEvent?.('viewportChanged', fn);
}

export interface MainButtonOptions {
  text: string;
  active: boolean;
  onClick: () => void;
}

/**
 * Telegram's own bottom button. It is drawn by the client ABOVE the on-screen
 * keyboard, which is the whole reason it exists here: a submit button in the
 * page flow disappears under the keyboard on a phone (docs/LOBBY_AND_VOICE_FIXES.md §2).
 *
 * Returns a cleanup function that unhooks the handler and hides the button —
 * always call it, or the next screen inherits a button that does the previous
 * screen's job. No-op outside Telegram.
 */
export function showMainButton({ text, active, onClick }: MainButtonOptions): () => void {
  const mb = tg?.MainButton;
  if (!mb) return () => {};
  if (mb.setParams) mb.setParams({ text, is_active: active, is_visible: true });
  else {
    if (mb.setText) mb.setText(text);
    if (active) mb.enable(); else mb.disable();
    mb.show();
  }
  mb.onClick(onClick);
  return () => {
    mb.offClick(onClick);
    mb.hide();
  };
}

// Telegram CloudStorage — per-user key/value synced by Telegram. Used for the
// anonymous onboarding games counter (localStorage is banned in the Mini App
// artifact). Promisified; resolves to a fallback when CloudStorage is absent
// (outside Telegram / old client). Best-effort, never throws.
export function cloudGet(key: string): Promise<string | null> {
  const cs = tg?.CloudStorage;
  if (!cs) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      cs.getItem(key, (err, value) => resolve(err ? null : value ?? null));
    } catch {
      resolve(null);
    }
  });
}

export function cloudSet(key: string, value: string): Promise<void> {
  const cs = tg?.CloudStorage;
  if (!cs) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      cs.setItem(key, value, () => resolve());
    } catch {
      resolve();
    }
  });
}
