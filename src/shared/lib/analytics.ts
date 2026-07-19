// Analytics — Vercel Web Analytics (primary) + optional Telegram Mini App
// analytics (tganalytics.xyz).
//
// Vercel: the script loads from OUR domain (/_vercel/insights), so it works
// inside the Telegram WebView and needs no tokens — just enable Web Analytics
// once in the Vercel dashboard (Project → Analytics → Enable). Page views are
// automatic; trackEvent() forwards the custom game events.
//
// Telegram analytics stays as an optional secondary: with no VITE_TGA_TOKEN /
// VITE_TGA_APP_NAME its SDK is never loaded and every call is a silent no-op.
//
// Privacy: we pass ONLY anonymous, aggregate parameters (scores, mode, lang).
// Never pass Telegram user id / name / username.

import { inject, track } from '@vercel/analytics';

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

/** Init analytics before the app renders. Vercel always; Telegram only with a token. */
export function initAnalytics(): void {
  try {
    inject();
  } catch {
    /* analytics must never break the boot */
  }

  const token = import.meta.env.VITE_TGA_TOKEN as string | undefined;
  const appName = import.meta.env.VITE_TGA_APP_NAME as string | undefined;
  if (!token || !appName) {
    if (import.meta.env.DEV) {
      console.info('[analytics] telegram analytics off — set VITE_TGA_TOKEN and VITE_TGA_APP_NAME');
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
    track(event, params as Record<string, string | number | boolean | null> | undefined);
  } catch {
    /* analytics must never break the UX */
  }
  try {
    window.telegramAnalytics?.track?.(event, params);
  } catch {
    /* analytics must never break the UX */
  }
}
