import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconX, IconExternalLink } from '@tabler/icons-react';
import { goBack } from '@/shared/lib/goBack';
import { hapticImpact } from '@/shared/lib/telegram';
import { fetchContentSources, type ContentSource } from '@/features/rights/rightsApi';

/**
 * ОТКУДА В ПРИЛОЖЕНИИ ВЗЯТ КОНТЕНТ.
 *
 * ⚠️ ЭТОТ ЭКРАН — НЕ «О ПРОЕКТЕ», А ВЫПОЛНЕНИЕ ЛИЦЕНЗИЙ. Тексты описаний и
 * таблицы карьеры взяты из Википедии (CC BY-SA 4.0), имена и даты — из
 * Викиданных (CC0), эмблемы части клубов — из TheSportsDB (CC BY-SA 4.0).
 * Первая и третья разрешают использование, включая коммерческое, при одном
 * условии: источник должен быть НАЗВАН. Названного места в приложении не
 * было ни одного — теперь оно здесь.
 *
 * ⚠️ СПИСОК ЧИТАЕТСЯ ИЗ БАЗЫ, А НЕ ВПИСАН В КОД. Источник добавляется
 * сборщиком, и вписанный руками список разошёлся бы с правдой молча — ровно
 * как «семь Edge-функций» при девяти. Здесь показывается ровно то, на что
 * ссылаются данные.
 *
 * ⚠️ НАЗВАНИЯ И ЛИЦЕНЗИИ НЕ ПЕРЕВОДЯТСЯ: «CC BY-SA 4.0» и «Wikimedia
 * Commons» — это то, что требует назвать лицензия, а не текст интерфейса.
 * Переводится вокруг них всё остальное.
 */
export function SourcesScreen() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [rows, setRows] = useState<ContentSource[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetchContentSources().then((s) => {
      if (!alive) return;
      if (s.status === 'ok') setRows(s.data);
      else setFailed(true);
    });
    return () => { alive = false; };
  }, []);

  const attrLabel = (a: string) =>
    a === 'per_record' ? t('rights.attr_per_record')
      : a === 'source' ? t('rights.attr_source')
        : t('rights.attr_none');

  return (
    <div className="min-h-screen bg-brand-bg ds-screen flex flex-col">
      <div className="px-4 pt-8 pb-4 border-b border-brand-border">
        <div className="max-w-sm mx-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => { hapticImpact('light'); goBack(navigate); }}
            aria-label={t('home.back')}
            className="w-9 h-9 shrink-0 flex items-center justify-center rounded-xl bg-brand-surface
                       border border-brand-border text-brand-muted hover:text-white transition-colors"
          >
            <IconX size={16} stroke={2} />
          </button>
          <h1 className="ds-display text-xl font-bold text-white">{t('rights.title')}</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-sm mx-auto px-4 py-4 space-y-3">
          <p className="text-xs leading-relaxed text-brand-muted">{t('rights.intro')}</p>

          {rows === null && !failed && (
            <div className="space-y-3" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-20 rounded-2xl bg-brand-border/30 animate-pulse" />
              ))}
            </div>
          )}

          {failed && (
            <p className="text-xs text-brand-muted">{t('rights.load_failed')}</p>
          )}

          {rows?.map((s) => (
            <div
              key={s.key}
              className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-4"
            >
              <div className="flex items-center gap-2">
                <p className="ds-display text-sm font-bold text-white flex-1 min-w-0 truncate">
                  {s.title}
                </p>
                {s.homepage && (
                  <a
                    href={s.homepage}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t('rights.site')}
                    className="text-brand-muted hover:text-brand-accent transition-colors shrink-0"
                  >
                    <IconExternalLink size={14} stroke={2} />
                  </a>
                )}
              </div>
              <p className="text-[11px] text-brand-muted mt-1.5">
                {t('rights.license')}:{' '}
                {s.license_url ? (
                  <a
                    href={s.license_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-accent hover:underline"
                  >
                    {s.license}
                  </a>
                ) : (
                  <span className="text-white/80">{s.license}</span>
                )}
              </p>
              <p className="text-[11px] text-brand-muted mt-0.5">
                {t('rights.attribution')}: <span className="text-white/80">{attrLabel(s.attribution)}</span>
              </p>
              {s.terms_url && (
                <a
                  href={s.terms_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-[11px] text-brand-accent hover:underline mt-1"
                >
                  {t('rights.terms')}
                </a>
              )}
            </div>
          ))}

          {/* ⚠️ БЕЗ ПРОЗРАЧНОСТИ, И ЭТО ЗАМЕР, А НЕ ВКУС. `text-brand-muted/70`
              на 10.5 пикселях даёт 3.28 на бумаге и 4.24 на тёмном — ниже AA
              в обоих. Это строка про то, как с нами связаться правообладателю:
              нечитаемая, она обессмысливает весь экран. */}
          <p className="text-[10.5px] leading-relaxed text-brand-muted pt-1">
            {t('rights.contact')}
          </p>
        </div>
      </div>
    </div>
  );
}
