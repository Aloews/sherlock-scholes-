import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ru from './locales/ru.json';
import en from './locales/en.json';

const LANG_KEY = 'ss_lang';

function detectLang(): string {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved === 'ru' || saved === 'en') return saved;
  const tgLang = window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
  if (tgLang === 'en') return 'en';
  return 'ru';
}

i18n.use(initReactI18next).init({
  resources: {
    ru: { translation: ru },
    en: { translation: en },
  },
  lng: detectLang(),
  fallbackLng: 'ru',
  interpolation: { escapeValue: false },
});

export function setLanguage(lang: 'ru' | 'en'): void {
  localStorage.setItem(LANG_KEY, lang);
  void i18n.changeLanguage(lang);
}

export default i18n;
