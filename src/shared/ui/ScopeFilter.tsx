import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchCollectionFacets, type CollectionFacet, type CollectionFilter,
} from '@/features/collection/collectionApi';

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
  const { t } = useTranslation();
  const [facets, setFacets] = useState<CollectionFacet[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchCollectionFacets(category).then((f) => { if (!cancelled) setFacets(f); });
    return () => { cancelled = true; };
  }, [category]);

  if (facets.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-0.5 -mx-4 px-4">
      {(['club', 'league', 'country'] as const).map((kind) => {
        const list = facets.filter((f) => f.kind === kind);
        if (list.length === 0) return null;
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
            {list.map((f) => (
              <option key={f.value} value={f.value}>{f.label} · {f.n}</option>
            ))}
          </select>
        );
      })}
    </div>
  );
}
