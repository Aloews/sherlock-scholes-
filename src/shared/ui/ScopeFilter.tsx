import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchCollectionFacets, type CollectionFacet, type CollectionFilter,
} from '@/features/collection/collectionApi';
import { countryName } from '@/shared/lib/countryName';
import { readFacets, writeFacets } from '@/shared/lib/facetCache';
import { filterByQuery } from '@/shared/lib/facetSearch';

/**
 * Отбор по КЛУБУ, ЛИГЕ и СТРАНЕ — один на все экраны, где есть игроки.
 *
 * Владелец: «добавь сортировку по клубам, лигам и странам в коллекции,
 * прогнозы, рейтинг, фентези и статистику».
 *
 * ⚠️ СПИСКИ ПРИХОДЯТ ИЗ БАЗЫ (`collection_facets`), А НЕ СОБИРАЮТСЯ ИЗ
 * ЗАГРУЖЕННЫХ КАРТОЧЕК. На экране их полсотни, а в базе 25 509, и PostgREST
 * режет ответ по `db-max-rows` = 1000: список, собранный по видимому, показал
 * бы малую часть и выглядел бы полным. Этот проект так уже ошибался — экран
 * колоды показывал 88 стран из 116.
 *
 * ⚠️ ОДИН КОМПОНЕНТ НА ВСЕ ЭКРАНЫ намеренно: три копии выпадающих разъехались
 * бы в том, что считать «любым» и как называть значения, и пользователь
 * увидел бы в рейтинге не тот набор клубов, что в коллекции.
 */
export function ScopeFilter({ value, onChange, category = 'player' }: {
  value: CollectionFilter;
  onChange: (next: CollectionFilter) => void;
  category?: 'player' | 'club' | 'all';
}) {
  const { t, i18n } = useTranslation();
  // ⚠️ СНАЧАЛА КЭШ, ПОТОМ СЕТЬ — приём из sherlock-tv (channelCache.ts).
  // Владелец: «коллекции теперь стали очень медленно грузиться». Замер на
  // бою: этот запрос отвечал 700–1200 мс и отдавал 74 655 байт, и экран ждал
  // его на КАЖДОМ открытии. Теперь списки показываются мгновенно из
  // localStorage, а сеть догоняет и молча обновляет.
  const [facets, setFacets] = useState<CollectionFacet[]>(
    () => readFacets(category) ?? []);
  // ⚠️ ПОИСК ОДИН НА ТРИ СПИСКА, А НЕ ТРИ ПОЛЯ. Владелец: «добавь поиск во все
  // категории большие». Клубов триста, стран 153, лиг 59 — крутить их на
  // телефоне вслепую дольше, чем набрать. Три поля рядом заняли бы всю ширину
  // и заставили бы человека угадывать, в котором из них искать «Аль-Хиляль».
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    setFacets(readFacets(category) ?? []);
    void fetchCollectionFacets(category).then((f) => {
      if (cancelled || f.length === 0) return;
      setFacets(f);
      writeFacets(category, f);
    });
    return () => { cancelled = true; };
  }, [category]);

  if (facets.length === 0) return null;

  /**
   * ⚠️ СТРАНА ПОКАЗЫВАЕТСЯ ИМЕНЕМ, А НЕ КОДОМ, И ЭТО ИСПРАВЛЕННАЯ ОШИБКА.
   * `collection_facets` отдаёт в `label` то же, что в `value` — код ISO, — и в
   * списке стояли «GB · 1507», «GB-ENG · 157». Владелец: «в категориях
   * коллекциях нет страны ENG» — она там была, но называлась «GB-ENG», а это
   * не название страны ни на одном языке. Имена уже лежат в countryName,
   * включая подразделения Британии: Англия, Шотландия, Уэльс.
   */
  const labelOf = (kind: 'club' | 'league' | 'country', f: CollectionFacet) =>
    kind === 'country' ? (countryName(f.value, i18n.language) ?? f.label) : f.label;

  const found = useMemo(
    () => (query ? filterByQuery(facets, query, (f) => labelOf(f.kind, f)).length : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- labelOf зависит
    // только от языка, и он же в зависимостях через i18n.language.
    [facets, query, i18n.language],
  );

  return (
    <div className="space-y-2">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('collection.search_scope')}
        className="w-full h-9 rounded-full border border-brand-border bg-brand-surface
                   px-3.5 text-[12px] text-white placeholder:text-brand-muted
                   focus:outline-none focus:border-brand-accent/50"
      />
      {/* ⚠️ «НИЧЕГО НЕ НАЙДЕНО» ГОВОРИТСЯ ВСЛУХ. Три пустых выпадающих списка
          выглядят как сломанный экран, а не как «по такому запросу пусто». */}
      {found === 0 && (
        <p className="text-brand-muted text-[11px]">{t('collection.search_empty')}</p>
      )}
    <div className="flex gap-2 overflow-x-auto pb-0.5 -mx-4 px-4">
      {(['club', 'league', 'country'] as const).map((kind) => {
        const all = facets.filter((f) => f.kind === kind);
        const list = filterByQuery(all, query, (f) => labelOf(kind, f));
        if (all.length === 0) return null;
        const key = kind === 'club' ? 'clubKey' : kind;
        const current = (value as Record<string, string | null | undefined>)[key] ?? '';
        return (
          <select
            key={kind}
            value={current}
            onChange={(e) => onChange({ ...value, [key]: e.target.value || null })}
            className={`shrink-0 h-9 max-w-[46vw] rounded-full border px-3 text-[11.5px]
                        bg-brand-surface focus:outline-none transition-colors ${
              current ? 'border-brand-accent/50 text-brand-accent'
                      : 'border-brand-border text-brand-muted'
            }`}
          >
            <option value="">{t(`collection.any_${kind}`)}</option>
            {/* ⚠️ ВЫБРАННОЕ ПОКАЗЫВАЕТСЯ ВСЕГДА, даже если поиск его отсеял.
                Иначе набор в поле молча сбрасывал бы подпись выбранного
                клуба на «любой», хотя отбор по нему остался бы в силе. */}
            {current && !list.some((f) => f.value === current)
              && (() => {
                const picked = all.find((f) => f.value === current);
                return picked ? (
                  <option value={picked.value}>{labelOf(kind, picked)} · {picked.n}</option>
                ) : null;
              })()}
            {list.map((f) => (
              <option key={f.value} value={f.value}>{labelOf(kind, f)} · {f.n}</option>
            ))}
          </select>
        );
      })}
    </div>
    </div>
  );
}
