// The language question, asked ONCE, before anything else.
//
// Until now the language was guessed and never mentioned: detectLang() reads
// a stored choice, else Telegram's language_code, else Russian. The guess is
// usually right, and when it is wrong the player has no idea a choice exists
// — they just meet an app in the wrong language and a deck ranked for
// somebody else's country.
//
// "Has this player chosen?" needs no new flag: setLanguage() writes ss_lang,
// and detectLang() reads it. A missing key means nobody ever picked, which is
// exactly when to ask. So a player who has already chosen (on any earlier
// build) is never asked again.
//
// The options are NOT translated. A language list is the one screen where
// each entry must be readable by the person who needs it, so every language
// is written in itself — a Korean speaker looks for 한국어, not "Korean".

import { useTranslation } from 'react-i18next';
import { APP_LANGS, setLanguage, type AppLang } from '@/shared/i18n';
import { hapticImpact } from '@/shared/lib/telegram';
import { trackEvent } from '@/shared/lib/analytics';

/** Endonyms — each language in its own script. Never run through t(). */
export const LANG_ENDONYMS: Record<AppLang, string> = {
  ru: 'Русский',
  en: 'English',
  es: 'Español',
  pt: 'Português',
  fr: 'Français',
  zh: '中文',
  ja: '日本語',
  ko: '한국어',
  ar: 'العربية',
};

interface Props {
  onDone: () => void;
}

export function FirstRunLanguage({ onDone }: Props) {
  const { t } = useTranslation();

  const choose = (lang: AppLang) => {
    hapticImpact('light');
    setLanguage(lang);            // writes ss_lang -> never asked again
    trackEvent('language_first_run', { lang });
    onDone();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center
                 bg-brand-bg px-6 py-10 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={t('lang.first_run_title')}
    >
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          {/* A globe rather than a headline in one language: the title below
              is rendered in the GUESSED language, which is exactly the guess
              the player may be here to correct. */}
          <div className="text-5xl" aria-hidden="true">🌍</div>
          <h1 className="text-white text-xl font-bold">{t('lang.first_run_title')}</h1>
          <p className="text-brand-muted text-sm">{t('lang.first_run_hint')}</p>
        </div>

        <ul className="space-y-2">
          {APP_LANGS.map((lang) => (
            <li key={lang}>
              <button
                type="button"
                lang={lang}
                dir={lang === 'ar' ? 'rtl' : 'ltr'}
                className="w-full rounded-2xl bg-brand-surface border border-brand-border
                           px-4 py-3 text-white text-lg font-medium text-start
                           hover:bg-brand-border/60 active:scale-[0.99] transition"
                onClick={() => choose(lang)}
              >
                {LANG_ENDONYMS[lang]}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
