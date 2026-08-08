import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ru from './locales/ru.json';
import en from './locales/en.json';
import es from './locales/es.json';
import pt from './locales/pt.json';
import fr from './locales/fr.json';
import zh from './locales/zh.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import ar from './locales/ar.json';
import { trackEvent } from '@/shared/lib/analytics';

const LANG_KEY = 'ss_lang';

// Languages offered in the selector. Every language has full interface
// resources; CARD NAMES additionally come translated from card_translations
// (see shared/lib/cardName.ts). Missing keys fall back to en, then ru.
export const APP_LANGS = ['ru', 'en', 'es', 'pt', 'fr', 'zh', 'ja', 'ko', 'ar'] as const;
export type AppLang = (typeof APP_LANGS)[number];

function isAppLang(lang: string | null | undefined): lang is AppLang {
  return !!lang && (APP_LANGS as readonly string[]).includes(lang);
}

// Storage is read at MODULE LOAD, so it has to survive not having any:
// a locked-down webview throws on access, and the Node test environment has
// no localStorage at all — importing anything that transitively reaches i18n
// would otherwise fail to collect rather than fail an assertion.
function storedLang(): string | null {
  try {
    return localStorage.getItem(LANG_KEY);
  } catch {
    return null;
  }
}

function detectLang(): string {
  const saved = storedLang();
  if (isAppLang(saved)) return saved;
  // `window` itself is absent under Node, not merely Telegram-less.
  const tgLang = typeof window === 'undefined'
    ? undefined
    : window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
  if (isAppLang(tgLang)) return tgLang;
  return 'ru';
}

/**
 * Has the player ever CHOSEN a language, as opposed to being guessed at?
 *
 * Only setLanguage() writes LANG_KEY, so its presence is the choice itself —
 * the first-run picker (screens/FirstRunLanguage.tsx) needs no separate flag,
 * and anyone who picked on an earlier build is never asked again.
 *
 * Storage can throw in a locked-down webview; treat that as "already chosen"
 * so a player is never trapped behind a picker whose answer cannot be saved.
 */
export function hasChosenLanguage(): boolean {
  try {
    // Deliberately NOT storedLang(): that swallows a storage failure into
    // `null`, which reads as "never chose" and would re-ask on every single
    // launch while being unable to remember the answer. If we cannot store
    // the choice, we do not ask for it — the guess stands and the player can
    // still change it in settings.
    return isAppLang(localStorage.getItem(LANG_KEY));
  } catch {
    return true;
  }
}

i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: ru },
    en: { translation: en },
    es: { translation: es },
    pt: { translation: pt },
    fr: { translation: fr },
    zh: { translation: zh },
    ja: { translation: ja },
    ko: { translation: ko },
    ar: { translation: ar },
  },
  lng: detectLang(),
  // Russian stays the default; any key missing from a translated locale
  // falls back to the English text, then Russian.
  fallbackLng: (code?: string) => (!code || code.startsWith('ru') ? ['ru'] : ['en', 'ru']),
  interpolation: { escapeValue: false },
});

export function setLanguage(lang: AppLang): void {
  // Persisting is best-effort; SWITCHING is not. If storage throws, the
  // player still gets the language they asked for — the first-run picker
  // calls this and would otherwise leave them staring at it.
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch { /* private mode / locked-down webview */ }
  void i18n.changeLanguage(lang);
  // Which card/UI language players switch to (anonymous).
  trackEvent('language_switched', { lang });
}

export default i18n;
