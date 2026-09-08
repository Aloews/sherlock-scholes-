import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconSearch, IconShieldHalf, IconTable } from '@tabler/icons-react';
import { fetchClubDirectory, type ClubDirectoryRow, type ClubKind } from '@/features/clubs/clubsApi';
import { LOADING, type LoadState } from '@/shared/lib/loadState';
import { Chip } from '@/shared/ui/Chip';
import { hapticImpact } from '@/shared/lib/telegram';
import { formatEur } from '@/shared/lib/money';

/**
 * Список команд — вход на экран команды. Половина раздела «Коллекция».
 *
 * ⚠️ ПОРЯДОК ЗАДАЁТ СЕРВЕР, И ОН НЕ АЛФАВИТНЫЙ. Сверху те, у кого есть что
 * показать: сначала по размеру состава, потом по числу матчей. Клуб, у
 * которого нет ни того ни другого, — строка, ведущая на пустой экран, и
 * алфавит поставил бы такие вперемешку с настоящими.
 *
 * ⚠️ ПОИСК ИДЁТ НА СЕРВЕР, А НЕ ФИЛЬТРУЕТ ЗАГРУЖЕННОЕ. В справочнике полторы
 * тысячи команд, а на экран приходит шестьдесят: фильтрация на клиенте искала
 * бы по первым шестидесяти и уверенно отвечала «не найдено» на всё остальное.
 *
 * Шапки и кнопки «назад» здесь нет намеренно: их держит экран коллекции, в
 * который этот раздел вложен. Две шапки одна под другой — это два разных
 * ответа на вопрос «где я».
 */
export function ClubsPane() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [query, setQuery] = useState('');
  // Клубы или сборные. Владелец: «так же добавь сборные». Два списка, а не
  // один: у сборной нет ни состава в колоде, ни матчей в расписании, и в общем
  // порядке (по размеру состава) все 175 встали бы ровным нулевым хвостом.
  const [kind, setKind] = useState<ClubKind>('club');
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
    void fetchClubDirectory(i18n.language, debounced || null, 60, kind).then((r) => {
      if (!cancelled) setRows(r);
    });
    return () => { cancelled = true; };
  }, [i18n.language, debounced, kind]);

  const list = useMemo(() => (rows.status === 'ok' ? rows.data : []), [rows]);

  return (
    <div className="space-y-3">
      {/* Таблицы — рядом со списком команд: это два взгляда на одно и то же
          собранное, по клубу и по лиге. */}
      <button
        type="button"
        onClick={() => navigate('/table')}
        className="w-full ds-panel bg-brand-surface border border-brand-border rounded-xl px-4 py-3
                   flex items-center gap-3 text-left hover:border-brand-accent/50 transition-colors"
      >
        <IconTable size={18} stroke={1.75} className="text-brand-muted shrink-0" />
        <span className="flex-1 text-white text-sm">{t('table.title')}</span>
        <span aria-hidden="true" className="text-brand-muted text-lg leading-none">›</span>
      </button>

      <div className="flex gap-2">
        <Chip
          label={t('clubs.kind_club')}
          selected={kind === 'club'}
          onClick={() => { hapticImpact('light'); setKind('club'); }}
        />
        <Chip
          label={t('clubs.kind_national')}
          selected={kind === 'national'}
          onClick={() => { hapticImpact('light'); setKind('national'); }}
        />
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
        {list.map((c, i) => (
          <button
            key={c.club_key}
            onClick={() => navigate(`/club/${encodeURIComponent(c.club_key)}`)}
            className="w-full ds-panel bg-brand-surface border border-brand-border rounded-xl px-3 py-2.5 flex items-center gap-3 text-left active:opacity-70 transition-opacity"
          >
            {/* ⚠️ МЕСТО В СПИСКЕ ЧИСЛОМ, И ЭТО ПОЧИНКА ЖАЛОБЫ, А НЕ УКРАШЕНИЕ.
                Владелец: «в рейтинге команд на первом месте оказалась и
                Барселона и Интер». Уровень — перцентиль, округлённый до
                целого, и в сотню упираются семь клубов сразу: семь строк с
                одинаковой сотней читаются как семь первых мест. Порядок при
                этом строгий (сортирует elo, а не округлённый уровень) —
                номер его и показывает. Поиск не меняет смысла: это место в
                том списке, который сейчас на экране. */}
            <span className="w-5 shrink-0 text-brand-muted/60 text-[11px] tabular-nums text-right">
              {i + 1}
            </span>
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
            {/* ⚠️ ПЕРВЫМ ЧИСЛОМ — ТО, ПО ЧЕМУ СПИСОК УПОРЯДОЧЕН. Владелец:
                «рейтинг команд не сортируется от лучшей к самой не
                результативной». Порядок теперь от сильной к слабой, и число,
                которое его задаёт, стоит рядом: иначе порядок читается как
                случайный — ровно та жалоба и была. Уровня нет у четырёх
                пятых клубов, поэтому там показывается стоимость состава,
                по ней они и стоят. */}
            <div className="text-right shrink-0">
              {c.level != null ? (
                <p className="text-brand-accent text-[11px] font-semibold tabular-nums">
                  {c.level}
                </p>
              ) : c.squad_value ? (
                <p className="text-brand-accent text-[10.5px] tabular-nums">
                  {formatEur(c.squad_value, i18n.language)}
                </p>
              ) : null}
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
  );
}
