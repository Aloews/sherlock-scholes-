import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ru from './locales/ru.json';
import en from './locales/en.json';
import { trackEvent } from '@/shared/lib/analytics';

const LANG_KEY = 'ss_lang';

// Languages offered in the selector. The INTERFACE has resources only for
// ru/en (139 keys — not worth translating); the other languages fall back to
// English interface texts while CARD NAMES come translated from
// card_translations (see shared/lib/cardName.ts).
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
  },
  lng: detectLang(),
  // Russian stays the default; every non-ru language without its own
  // interface resources (es/pt/fr/zh/ja/ko/ar) reads the English texts.
  fallbackLng: (code?: string) => (!code || code.startsWith('ru') ? ['ru'] : ['en', 'ru']),
  interpolation: { escapeValue: false },
});

export function setLanguage(lang: AppLang): void {
  localStorage.setItem(LANG_KEY, lang);
  void i18n.changeLanguage(lang);
  trackEvent('language_select', { lang });
}

export default i18n;
