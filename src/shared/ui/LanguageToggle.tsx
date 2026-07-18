import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { setLanguage, APP_LANGS, type AppLang } from '@/shared/i18n';
import { hapticImpact } from '@/shared/lib/telegram';

interface LanguageToggleProps {
  className?: string;
}

// Native names keep the selector self-explanatory in any interface language.
const LANG_LABEL: Record<AppLang, string> = {
  ru: 'RU',
  en: 'EN',
  es: 'ES',
  pt: 'PT',
  fr: 'FR',
  zh: '中文',
  ja: '日本語',
  ko: '한국어',
  ar: 'العربية',
};

/** Language selector: every language has full interface resources, and card
 * names follow the chosen language via card_translations. */
export function LanguageToggle({ className }: LanguageToggleProps) {
  const { i18n } = useTranslation();
  const current = (APP_LANGS as readonly string[]).includes(i18n.language)
    ? (i18n.language as AppLang)
    : 'ru';

  return (
    <select
      value={current}
      aria-label="Language"
      onChange={(e) => { hapticImpact('light'); setLanguage(e.target.value as AppLang); }}
      className={clsx(
        'bg-brand-surface rounded-xl px-2.5 py-1.5 appearance-none',
        'border border-brand-border text-xs font-bold select-none text-white',
        'hover:border-brand-muted/50 transition-colors focus:outline-none',
        'focus:border-brand-accent cursor-pointer',
        className,
      )}
    >
      {APP_LANGS.map((lang) => (
        <option key={lang} value={lang} className="bg-brand-surface text-white">
          {LANG_LABEL[lang]}
        </option>
      ))}
    </select>
  );
}
