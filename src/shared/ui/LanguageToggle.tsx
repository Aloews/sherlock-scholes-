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
        'flex items-center gap-1 bg-zinc-800 rounded-xl px-3 py-1.5',
        'border border-zinc-700 text-xs font-bold select-none',
        'hover:border-zinc-500 transition-colors',
        className,
      )}
      onClick={() => setLanguage(isEn ? 'ru' : 'en')}
    >
      <span className={isEn ? 'text-zinc-500' : 'text-white'}>RU</span>
      <span className="text-zinc-600">|</span>
      <span className={isEn ? 'text-white' : 'text-zinc-500'}>EN</span>
    </button>
  );
}
