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

function detectLang(): string {
  const saved = localStorage.getItem(LANG_KEY);
  if (isAppLang(saved)) return saved;
  const tgLang = window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
  if (isAppLang(tgLang)) return tgLang;
  return 'ru';
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
  localStorage.setItem(LANG_KEY, lang);
  void i18n.changeLanguage(lang);
  // Which card/UI language players switch to (anonymous).
  trackEvent('language_switched', { lang });
}

export default i18n;
