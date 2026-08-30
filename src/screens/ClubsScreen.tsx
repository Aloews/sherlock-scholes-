import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft, IconSearch, IconShieldHalf } from '@tabler/icons-react';
import { fetchClubDirectory, type ClubDirectoryRow } from '@/features/clubs/clubsApi';
import { LOADING, type LoadState } from '@/shared/lib/loadState';

/**
 * Список команд — вход на экран команды.
 *
 * ⚠️ ПОРЯДОК ЗАДАЁТ СЕРВЕР, И ОН НЕ АЛФАВИТНЫЙ. Сверху те, у кого есть что
 * показать: сначала по размеру состава, потом по числу матчей. Клуб, у
 * которого нет ни того ни другого, — строка, ведущая на пустой экран, и
 * алфавит поставил бы такие вперемешку с настоящими.
 *
 * ⚠️ ПОИСК ИДЁТ НА СЕРВЕР, А НЕ ФИЛЬТРУЕТ ЗАГРУЖЕННОЕ. В справочнике полторы
 * тысячи команд, а на экран приходит шестьдесят: фильтрация на клиенте искала
 * бы по первым шестидесяти и уверенно отвечала «не найдено» на всё остальное.
 */
export function ClubsScreen() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<LoadState<ClubDirectoryRow[]>>(LOADING);

  // Запрос откладывается, пока идёт набор: иначе каждая буква — поход в базу.
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(id);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setRows(LOADING);
    void fetchClubDirectory(i18n.language, debounced || null).then((r) => {
      if (!cancelled) setRows(r);
    });
    return () => { cancelled = true; };
  }, [i18n.language, debounced]);

  const list = useMemo(() => (rows.status === 'ok' ? rows.data : []), [rows]);

  return (
    <div className="min-h-screen bg-brand-bg pb-24 ds-screen">
      <div className="max-w-md mx-auto px-4 pt-4 space-y-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="text-brand-muted hover:text-white transition-colors"
            aria-label={t('home.back')}
          >
            <IconArrowLeft size={22} stroke={1.5} />
          </button>
          <h1 className="ds-display text-white text-lg font-bold">{t('clubs.title')}</h1>
        </div>

        <div className="relative">
          <IconSearch
            size={16}
            stroke={1.5}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-muted pointer-events-none"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('clubs.search')}
            className="w-full bg-brand-surface border border-brand-border rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-brand-muted/70 outline-none focus:border-brand-accent/60"
          />
        </div>

        {rows.status === 'loading' && (
          <p className="text-brand-muted text-sm text-center py-8">{t('clubs.loading')}</p>
        )}

        {rows.status === 'error' && (
          <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-1">
            <p className="text-brand-muted text-sm">{t('clubs.failed')}</p>
            <p className="text-brand-muted/50 text-[10px] font-mono">{rows.code}</p>
          </div>
        )}

        {rows.status === 'ok' && list.length === 0 && (
          <p className="text-brand-muted text-sm text-center py-8">{t('clubs.empty')}</p>
        )}

        <div className="space-y-1.5">
          {list.map((c) => (
            <button
              key={c.club_key}
              onClick={() => navigate(`/club/${encodeURIComponent(c.club_key)}`)}
              className="w-full ds-panel bg-brand-surface border border-brand-border rounded-xl px-3 py-2.5 flex items-center gap-3 text-left active:opacity-70 transition-opacity"
            >
              {c.crest_url ? (
                <img
                  src={c.crest_url}
                  alt=""
                  className="w-9 h-9 rounded-lg object-contain bg-brand-bg shrink-0"
                  loading="lazy"
                />
              ) : (
                <span className="w-9 h-9 rounded-lg bg-brand-bg shrink-0 grid place-items-center">
                  <IconShieldHalf size={18} stroke={1.5} className="text-brand-muted" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-white text-sm truncate">{c.name}</p>
                <p className="text-brand-muted text-[10.5px] truncate">
                  {[c.country, c.league].filter(Boolean).join(' · ')}
                </p>
              </div>
              {/* Что есть у команды — чтобы не заходить наугад. */}
              <div className="text-right shrink-0">
                <p className="text-brand-muted text-[10.5px] tabular-nums">
                  {t('clubs.players', { count: c.squad })}
                </p>
                <p className="text-brand-muted/70 text-[10px] tabular-nums">
                  {t('clubs.matches', { count: c.matches })}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
