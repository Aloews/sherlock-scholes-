// Telegram Mini App analytics (tganalytics.xyz / @telegram-apps/analytics).
//
// Anonymous, GDPR-friendly, built for Mini Apps (plain GA behaves poorly in
// the Telegram WebView). Launch/visibility events are captured automatically
// by the SDK after init(); we add a few custom events for key flows.
//
// Graceful by design: with no VITE_TGA_TOKEN / VITE_TGA_APP_NAME the SDK is
// never loaded and every call is a silent no-op, so the build runs fine
// without a token. Get the token from @DataChief_bot in Telegram and put it
// in .env (VITE_TGA_TOKEN, VITE_TGA_APP_NAME).
//
// Privacy: we pass ONLY anonymous, aggregate parameters (scores, mode, lang).
// Never pass Telegram user id / name / username.

interface TelegramAnalytics {
  init(opts: { token: string; appName: string }): void | Promise<void>;
  // Custom-event API. The SDK supports a "custom-event" but does not document
  // the exact method name, so the call is optional-chained and wrapped — if a
  // given SDK version lacks it, custom events are a silent no-op while the
  // automatic launch events keep working.
  track?: (event: string, params?: Record<string, unknown>) => void;
}

declare global {
  interface Window {
    telegramAnalytics?: TelegramAnalytics;
  }
}

const SDK_URL = 'https://tganalytics.xyz/index.js';

/** Load and init the SDK before the app renders. No token -> disabled. */
export function initAnalytics(): void {
  const token = import.meta.env.VITE_TGA_TOKEN as string | undefined;
  const appName = import.meta.env.VITE_TGA_APP_NAME as string | undefined;
  if (!token || !appName) {
    if (import.meta.env.DEV) {
      console.info('[analytics] disabled — set VITE_TGA_TOKEN and VITE_TGA_APP_NAME');
    }
    return;
  }
  const script = document.createElement('script');
  script.async = true;
  script.src = SDK_URL;
  script.onload = () => {
    try {
      window.telegramAnalytics?.init({ token, appName });
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[analytics] init failed', err);
    }
  };
  document.head.appendChild(script);
}

/** Fire a custom analytics event. Anonymous params only; never throws. */
export function trackEvent(event: string, params?: Record<string, unknown>): void {
  try {
    window.telegramAnalytics?.track?.(event, params);
  } catch {
    /* analytics must never break the UX */
  }
}
