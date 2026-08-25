import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ru from './locales/ru.json';
import { trackEvent } from '@/shared/lib/analytics';

// ⚠️ ГРУЗИМ ОДИН ЯЗЫК, А НЕ ДЕВЯТЬ — И ЭТО САМАЯ БОЛЬШАЯ ЭКОНОМИЯ В ПРОЕКТЕ.
// Раньше здесь стояло девять статических `import` локалей, и все девять
// попадали в ГЛАВНЫЙ бандл — тот, который ждёт каждый экран перед первым
// кадром. Замер: `src/shared/i18n/locales/` весит 352 КБ, при том что
// `index.js` весил 933 КБ. Больше трети главного бандла — это восемь языков,
// на которых играющий не читает.
//
// Теперь статически лежит только `ru`: он же язык по умолчанию, он же
// последний запасной в цепочке `fallbackLng`, то есть нужен всегда. Остальные
// восемь — динамический `import()`, и Vite раскладывает их по отдельным
// файлам: игрок скачивает ровно свой.
//
// ⚠️ ЯЗЫК ДОГРУЖАЕТСЯ ДО ПЕРВОГО КАДРА, а не после. Иначе испанец увидел бы
// вспышку русского текста и только потом свой — «мигание непереведённым»
// заметнее, чем лишние сто миллисекунд на загрузочном экране, который и так
// показывается. Поэтому `initI18n()` асинхронна, и `main.tsx` её ждёт.

const LANG_KEY = 'ss_lang';

// Languages offered in the selector. Every language has full interface
// resources; CARD NAMES additionally come translated from card_translations
// (see shared/lib/cardName.ts). Missing keys fall back to en, then ru.
export const APP_LANGS = ['ru', 'en', 'es', 'pt', 'fr', 'zh', 'ja', 'ko', 'ar'] as const;
export type AppLang = (typeof APP_LANGS)[number];

/**
 * Загрузчики остальных восьми.
 *
 * ⚠️ КАРТА ЛИТЕРАЛОВ, А НЕ `import(\`./locales/${lang}.json\`)`. Шаблонная
 * строка заставила бы Vite втянуть В СБОРКУ ВСЮ ПАПКУ — он не может знать,
 * какие значения подставятся, и на всякий случай берёт все. Экономия
 * исчезла бы целиком, причём молча: сборка прошла бы, а бандл остался прежним.
 */
const LOADERS: Record<Exclude<AppLang, 'ru'>, () => Promise<{ default: object }>> = {
  en: () => import('./locales/en.json'),
  es: () => import('./locales/es.json'),
  pt: () => import('./locales/pt.json'),
  fr: () => import('./locales/fr.json'),
  zh: () => import('./locales/zh.json'),
  ja: () => import('./locales/ja.json'),
  ko: () => import('./locales/ko.json'),
  ar: () => import('./locales/ar.json'),
};

function isAppLang(lang: string | null | undefined): lang is AppLang {
  return !!lang && (APP_LANGS as readonly string[]).includes(lang);
}

function detectLang(): AppLang {
  const saved = localStorage.getItem(LANG_KEY);
  if (isAppLang(saved)) return saved;
  const tgLang = window.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
  if (isAppLang(tgLang)) return tgLang;
  return 'ru';
}

/**
 * Догрузить локаль, если её ещё нет.
 *
 * Отказ загрузки НЕ бросает: сеть могла отвалиться на полпути, и упасть
 * целиком ради одного языка — худший из возможных исходов. Игрок увидит
 * запасной язык, а не белый экран, и это тот самый случай, ради которого
 * `fallbackLng` вообще существует.
 */
async function loadLang(lang: AppLang): Promise<void> {
  if (lang === 'ru' || i18n.hasResourceBundle(lang, 'translation')) return;
  try {
    const mod = await LOADERS[lang]();
    i18n.addResourceBundle(lang, 'translation', mod.default, true, true);
  } catch (err) {
    console.error('[i18n] locale load failed:', lang, err);
  }
}

/** Готов ли i18next. Второй вызов `initI18n()` не должен инициализировать заново. */
let started: Promise<void> | null = null;

export function initI18n(): Promise<void> {
  if (started) return started;
  const lng = detectLang();

  started = (async () => {
    await i18n.use(initReactI18next).init({
      resources: { ru: { translation: ru } },
      lng,
      // Russian stays the default; any key missing from a translated locale
      // falls back to the English text, then Russian.
      fallbackLng: (code?: string) => (!code || code.startsWith('ru') ? ['ru'] : ['en', 'ru']),
      interpolation: { escapeValue: false },
    });
    await loadLang(lng);
  })();

  return started;
}

export function setLanguage(lang: AppLang): void {
  localStorage.setItem(LANG_KEY, lang);
  // Сначала ДОГРУЗИТЬ, потом переключить: обратный порядок показал бы пустой
  // или запасной текст на то время, пока летит запрос.
  void loadLang(lang).then(() => i18n.changeLanguage(lang));
  // Which card/UI language players switch to (anonymous).
  trackEvent('language_switched', { lang });
}

export default i18n;
