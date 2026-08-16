import { useTranslation } from 'react-i18next';

/**
 * «Входим…» — весь экран, пока идёт вход по ссылке или приглашению.
 *
 * ⚠️ ЗДЕСЬ НЕТ ПОЛЯ ВВОДА, И ЭТО ЕДИНСТВЕННАЯ ПРИЧИНА, ПО КОТОРОЙ ЭТОТ ЭКРАН
 * существует отдельно от формы кода. Форма забирает фокус, а приглашённому
 * набирать нечего: код уже известен. Показать ему форму значило бы бросить
 * клавиатуру поверх заполненного поля и попросить подтвердить то, на что он
 * уже нажал.
 *
 * Код всё же показан — крупно и неизменяемо: человек видит, в какую комнату
 * его ведут, и это единственное, что ему тут нужно знать.
 */
export function HomeJoining({ code }: { code: string }) {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-brand-bg ds-screen flex flex-col items-center justify-center px-6 gap-4">
      <img src="/logo-white-clean.png" alt="" className="w-[132px] max-w-full h-auto" />
      <span
        className="w-[30px] h-[30px] rounded-full animate-spin"
        style={{
          border: '2.5px solid rgb(var(--brand-accent) / 0.2)',
          borderTopColor: 'rgb(var(--brand-accent))',
          animationDuration: '0.9s',
        }}
        aria-hidden
      />
      <p className="text-white text-sm" aria-live="polite">{t('home.joining')}</p>
      <p className="ds-display text-2xl font-black text-white tracking-widest">{code}</p>
    </div>
  );
}
