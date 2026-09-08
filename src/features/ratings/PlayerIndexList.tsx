import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconBallFootball } from '@tabler/icons-react';
import { ScopeFilter } from '@/shared/ui/ScopeFilter';
import type { CollectionFilter } from '@/features/collection/collectionApi';
import { LOADING, type LoadState } from '@/shared/lib/loadState';
import { hapticImpact } from '@/shared/lib/telegram';
import { PlayerPhoto } from '@/shared/ui/PlayerPhoto';
import { Chip } from '@/shared/ui/Chip';
import { formatSortValue } from './indexSortValue';
import {
  fetchPlayerIndex, fetchPlayerIndexCount,
  CONTINENTS, INDEX_SORTS,
  type Continent, type IndexSort, type PlayerIndexRow,
} from './ratingsApi';

/**
 * Общий рейтинг игроков и сортировки по каждому показателю.
 *
 * Владелец: «интересно было видеть общую систему рейтинга игроков по
 * активности в сетях или просмотрам страницы игрока в Википедии
 * (популярности), по стоимости, по статистике и новостям».
 *
 * ⚠️ ЭТО НЕ ЗАМЕНА RatingsList, А ВТОРОЙ, ДРУГОЙ СПИСОК. Тот отвечает на
 * вопрос «кто играл лучше за неделю» — голы и пасы в окне. Этот — «кто вообще
 * значительнее», и окна у него нет. Слить их в один значило бы складывать
 * форму за семь дней с карьерой за пятнадцать лет.
 *
 * ⚠️ «АКТИВНОСТИ В СЕТЯХ» У НАС НЕТ. Ни одного источника соцсетей в проекте не
 * подключено, и опора «популярность» — это просмотры страницы в Википедии,
 * ровно то, что владелец назвал вторым вариантом. Подпись говорит именно так,
 * а не «популярность» вообще: иначе число обещало бы то, чего не измеряло.
 */
export function PlayerIndexList({ limit }: { limit?: number }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  // ⚠️ ПО УМОЛЧАНИЮ — СТОИМОСТЬ, А НЕ СВОДНЫЙ ИНДЕКС. Владелец: «сделай
  // основным мерилом игрока стоимость, она лучше отражает рейтинг игрока».
  // Сводный индекс никуда не делся — он первой кнопкой рядом, — но открывается
  // список тем, чему владелец доверяет как мере. Заодно у стоимости есть
  // разрешение там, где у перцентиля его нет: индекс на верхушке упирался в
  // сотню у слишком многих.
  const [sort, setSort] = useState<IndexSort>('value');
  // Тот же отбор, что в коллекции и в рейтинге, и тем же компонентом.
  const [filter, setFilter] = useState<CollectionFilter>({});
  // Континент — отдельным рядом, а не внутри ScopeFilter: тот собран из
  // клубов, лиг и стран одной таблицей фактов, а континент это ОДНО из пяти
  // значений и вопрос другого масштаба. Смешать их в один ряд значит утопить
  // пять кнопок в списке из сотен клубов.
  const [continent, setContinent] = useState<Continent | null>(null);
  const [rows, setRows] = useState<LoadState<PlayerIndexRow[]>>(LOADING);
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRows(LOADING);
    void fetchPlayerIndex(sort, { ...filter, continent }, i18n.language).then((r) => {
      if (!cancelled) setRows(r);
    });
    return () => { cancelled = true; };
  }, [sort, filter, continent, i18n.language]);

  // ⚠️ ОТДЕЛЬНЫМ ЗАПРОСОМ, А НЕ PROMISE.ALL. Знаменатель «из скольких» нужен
  // подписи, а не списку; экран, ждущий по самому медленному из двух, уже
  // стоил этому проекту разбора (DigestScreen, docs/MAP.md §9).
  useEffect(() => {
    let cancelled = false;
    setTotal(null);
    void fetchPlayerIndexCount(sort, { ...filter, continent }).then((r) => {
      if (!cancelled && r.status === 'ok') setTotal(r.data);
    });
    return () => { cancelled = true; };
  }, [sort, filter, continent]);

  const all = rows.status === 'ok' ? rows.data : [];
  const shown = limit == null ? all : all.slice(0, limit);

  return (
    <div className="space-y-4">
      <ScopeFilter value={filter} onChange={setFilter} />

      {/* Континенты. «Все» — не отдельное значение, а снятый выбор: кнопка
          «все континенты» рядом с пятью континентами читалась бы как шестой. */}
      <div className="-mx-4 px-4 overflow-x-auto">
        <div className="flex gap-1.5 w-max pb-0.5">
          <Chip
            label={t('index.continent_all')}
            selected={continent === null}
            onClick={() => { hapticImpact('light'); setContinent(null); }}
          />
          {CONTINENTS.map((c) => (
            <Chip
              key={c}
              label={t(`index.continent.${c}`)}
              selected={continent === c}
              onClick={() => { hapticImpact('light'); setContinent(c); }}
            />
          ))}
        </div>
      </div>

      <div className="-mx-4 px-4 overflow-x-auto">
        <div className="flex gap-1.5 w-max pb-0.5">
          {INDEX_SORTS.map((s) => (
            <Chip
              key={s}
              label={t(`index.sort_${s}`)}
              selected={sort === s}
              onClick={() => { hapticImpact('light'); setSort(s); }}
            />
          ))}
        </div>
      </div>

      {/* Из чего складывается общий счёт. Рейтинг, который нельзя объяснить,
          читается как выдуманный — а он и правда выдуман, если его никто не
          может проверить. Здесь же названо, что «популярность» это Википедия. */}
      <p className="text-brand-muted/70 text-[11px]">
        {sort === 'index' ? t('index.formula') : t('index.formula_single')}
      </p>

      {rows.status === 'loading' && (
        <p className="text-brand-muted text-sm text-center py-8">{t('ratings.loading')}</p>
      )}

      {rows.status === 'error' && (
        <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-1">
          <p className="text-brand-muted text-sm">{t('ratings.failed')}</p>
          <p className="text-brand-muted/50 text-[10px] font-mono">{rows.code}</p>
        </div>
      )}

      {rows.status === 'ok' && all.length === 0 && (
        <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-6 text-center space-y-2">
          <IconBallFootball size={28} stroke={1.5} className="mx-auto text-brand-muted" />
          {/* ⚠️ ПУСТОТА ЗДЕСЬ УТВЕРЖДАЕТ. «В этой лиге никого» и «этот
              показатель у них не собран» выглядят одинаково, а значат разное. */}
          <p className="text-brand-muted text-sm">{t('index.empty')}</p>
        </div>
      )}

      {shown.map((row) => (
        <button
          key={row.card_id}
          type="button"
          onClick={() => { hapticImpact('light'); navigate(`/collection?card=${row.card_id}`); }}
          className="w-full text-left ds-panel bg-brand-surface border border-brand-border rounded-2xl p-3 flex items-center gap-3 active:opacity-70 transition-opacity"
        >
          <span className="ds-display text-brand-muted text-sm font-bold tabular-nums w-7 text-right shrink-0">
            {row.place}
          </span>

          {row.photo_url ? (
            <PlayerPhoto src={row.photo_url} className="w-9 h-9 rounded-full shrink-0 bg-brand-bg" />
          ) : (
            <span className="w-9 h-9 rounded-full bg-brand-bg shrink-0" />
          )}

          <div className="flex-1 min-w-0">
            <p className="text-white text-sm truncate">{row.name}</p>
            <p className="text-brand-muted text-[11px] truncate">
              {[row.club, row.league].filter(Boolean).join(' · ')}
            </p>
          </div>

          <div className="text-right shrink-0">
            <p className="ds-display text-white text-sm font-bold tabular-nums">
              {formatSortValue(sort, row.sort_value, i18n.language, t)}
            </p>
            {/* ⚠️ СКОЛЬКО ОПОР СЛОЖИЛИ СЧЁТ — РЯДОМ С НИМ. Счёт по одной опоре
                и счёт по четырём выглядят одинаково, а стоят разного: без этой
                подписи игрок, про которого известно одно упоминание в
                новостях, читался бы наравне с измеренным по всем четырём. */}
            {sort === 'index' && row.parts != null && (
              <p className="text-brand-muted/70 text-[10px] tabular-nums">
                {t('index.parts', { count: row.parts })}
              </p>
            )}
          </div>
        </button>
      ))}

      {/* «Из скольких» — под списком: пока список читают, вопрос не возникает. */}
      {rows.status === 'ok' && all.length > 0 && total != null && (
        <p className="text-brand-muted/60 text-[11px] text-center pt-1">
          {t('index.of_total', { shown: shown.length, total })}
        </p>
      )}
    </div>
  );
}
