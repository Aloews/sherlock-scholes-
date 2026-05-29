import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import { setLanguage } from '@/shared/i18n';

interface LanguageToggleProps {
  className?: string;
}

export function LanguageToggle({ className }: LanguageToggleProps) {
  const { i18n } = useTranslation();
  const isEn = i18n.language === 'en';

  return (
    <button
      className={clsx(
        'flex items-center gap-1 bg-brand-surface rounded-xl px-3 py-1.5',
        'border border-brand-border text-xs font-bold select-none',
        'hover:border-brand-muted/50 transition-colors',
        className,
      )}
      onClick={() => setLanguage(isEn ? 'ru' : 'en')}
    >
      <span className={isEn ? 'text-brand-muted' : 'text-white'}>RU</span>
      <span className="text-brand-border">|</span>
      <span className={isEn ? 'text-white' : 'text-brand-muted'}>EN</span>
    </button>
  );
}
