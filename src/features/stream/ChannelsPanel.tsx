import { useEffect, useMemo, useState } from 'react';
import { Chip } from '@/shared/ui/Chip';
import { catalogue, groupCounts, type CatalogueChannel } from './playlist';

// Тот же адрес, что у экрана игрока: каталог здесь смотрят ровно затем, чтобы
// понять, что игрок из него получит.
const PLAYLIST_URL = import.meta.env.VITE_STREAM_URL as string | undefined;

// Сколько строк рисуем разом. В каталоге 4081 запись, и React честно построит
// все 4081 DOM-узел — экран замирает секундами. Оператору столько и не нужно:
// он приходит с вопросом про КОНКРЕТНЫЙ канал, а не листать весь файл.
const PAGE = 100;

type Filter = 'all' | 'shown' | 'hidden';

/**
 * Полный каталог каналов — «остальное», которого нет в плеере игрока.
 *
 * ⚠️ ЖИВЁТ ЗА ПАРОЛЕМ, И ЭТО ЕДИНСТВЕННОЕ МЕСТО, ГДЕ ЕМУ МОЖНО. В каталоге
 * 4081 запись: больше 1400 фильмов и группа `♥18+` на 126 записей. На экране
 * игрока их быть не может (см. `isShown` в ./playlist.ts), но оператору
 * нужно видеть, ПОЧЕМУ канала нет в приложении, — иначе на каждое «а где
 * Матч ТВ» ответить нечем. Кабинет проверяет пароль через `staffVerify`
 * на сервере, так что это не «скрытый роут», а настоящая дверь.
 *
 * ⚠️ БЕЗ КЭША, В ОТЛИЧИЕ ОТ ЭКРАНА ИГРОКА. `useChannels` показывает вчерашний
 * разбор сразу, чтобы ТВ не молчало 17 секунд на 3G. Здесь наоборот: приходят
 * узнать, что в каталоге СЕЙЧАС, и вчерашний ответ на этот вопрос — ложь.
 */
export function ChannelsPanel() {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [limit, setLimit] = useState(PAGE);

  useEffect(() => {
    if (!PLAYLIST_URL) return;
    const abort = new AbortController();
    fetch(PLAYLIST_URL, { signal: abort.signal })
      .then((res) => { if (!res.ok) throw new Error(`http_${res.status}`); return res.text(); })
      .then(setText)
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(err instanceof Error ? err.message : 'unknown');
      });
    return () => abort.abort();
  }, []);

  const all = useMemo(() => (text ? catalogue(text) : []), [text]);
  const groups = useMemo(() => groupCounts(all), [all]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((c) => {
      if (filter === 'shown' && !c.shown) return false;
      if (filter === 'hidden' && c.shown) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.group.toLowerCase().includes(q);
    });
  }, [all, query, filter]);

  // Новый запрос — снова с первой сотни: иначе «показать ещё» из прошлого
  // поиска тянется в следующий и выдаёт лишнее без спроса.
  useEffect(() => { setLimit(PAGE); }, [query, filter]);

  if (!PLAYLIST_URL) {
    return <p className="text-brand-muted text-sm">VITE_STREAM_URL не задан — каталога нет.</p>;
  }
  if (error) {
    return <p className="text-brand-muted text-sm">Каталог не загрузился: {error}</p>;
  }
  if (!text) {
    return <p className="text-brand-muted text-sm">Загружаем каталог…</p>;
  }

  const shownTotal = all.filter((c) => c.shown).length;

  return (
    <div className="space-y-3">
      <p className="text-brand-muted text-xs">
        Всего <span className="tabular-nums text-white">{all.length}</span>,
        {' '}в плеере у игрока <span className="tabular-nums text-white">{shownTotal}</span>.
        {' '}Остальное отсечено: не спорт или не отдаётся по https.
      </p>

      <div className="flex gap-2 flex-wrap">
        {([['all', 'Все'], ['shown', 'В плеере'], ['hidden', 'Отсечённые']] as const).map(([id, label]) => (
          <Chip key={id} label={label} selected={filter === id} onClick={() => setFilter(id)} />
        ))}
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Канал или группа"
        aria-label="Поиск по каталогу"
        className="w-full bg-brand-surface border border-brand-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-accent"
      />

      {/* Группы — первое, что спрашивают у каталога: «что там вообще есть». */}
      <details className="rounded-lg border border-brand-border">
        <summary className="px-3 py-2 text-sm cursor-pointer">
          Группы <span className="tabular-nums text-brand-muted">{groups.length}</span>
        </summary>
        <div className="px-3 pb-2 space-y-1">
          {groups.map((g) => (
            <button
              key={g.group}
              type="button"
              onClick={() => setQuery(g.group)}
              className="w-full flex items-center gap-2 text-left text-xs py-0.5"
            >
              <span className="flex-1 truncate">{g.group}</span>
              <span className="tabular-nums text-brand-muted">{g.total}</span>
              <span className="tabular-nums text-brand-accent w-8 text-right">
                {g.shown || ''}
              </span>
            </button>
          ))}
        </div>
      </details>

      <p className="text-brand-muted text-xs">
        Найдено <span className="tabular-nums text-white">{list.length}</span>
      </p>

      <div className="space-y-1">
        {list.slice(0, limit).map((c) => <Row key={c.url} channel={c} />)}
      </div>

      {list.length > limit && (
        <button
          type="button"
          onClick={() => setLimit((n) => n + PAGE)}
          className="w-full py-2 text-sm text-brand-accent"
        >
          Показать ещё {Math.min(PAGE, list.length - limit)}
        </button>
      )}
    </div>
  );
}

function Row({ channel }: { channel: CatalogueChannel }) {
  // Причина, а не просто «нет»: «не спорт» и «http» чинятся по-разному —
  // первое правкой группы в плейлисте, второе ничем на нашей стороне.
  const reason = channel.shown
    ? null
    : !channel.playable ? 'http' : 'не спорт';

  return (
    <div className="flex items-center gap-2 text-xs py-1 border-b border-brand-border/40">
      <span className={`flex-1 min-w-0 truncate ${channel.shown ? 'text-white' : 'text-brand-muted'}`}>
        {channel.name}
      </span>
      <span className="text-brand-muted truncate max-w-[30%]">{channel.group}</span>
      {reason
        ? <span className="text-brand-muted shrink-0">{reason}</span>
        : <span className="text-brand-accent shrink-0">в плеере</span>}
    </div>
  );
}
