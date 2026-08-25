import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft, IconFlag, IconStar, IconStarFilled, IconSearch } from '@tabler/icons-react';
import { hapticImpact } from '@/shared/lib/telegram';
import { OptionRow } from '@/shared/ui/OptionRow';
import { Chip } from '@/shared/ui/Chip';
import { StreamPlayer } from '@/features/stream/StreamPlayer';
import { useChannels } from '@/features/stream/useChannels';
import { orderChannels, nextAlive, filterChannels } from '@/features/stream/order';
import { readHealth, markHealth, readFavourites, toggleFavourite } from '@/features/stream/channelCache';
import { buildReportMailto } from '@/features/stream/reportMailto';

// Public by nature, same as VITE_LIVEKIT_URL: the browser has to know where
// to fetch the stream from, so this is not a secret (see .env.example).
//
// ⚠️ ЭТО КАТАЛОГ КАНАЛОВ, А НЕ ПОТОК. Раньше этот адрес уходил прямо в
// StreamPlayer, то есть в hls.loadSource(), и играть там было нечего —
// подробности в шапке features/stream/playlist.ts. Теперь он разбирается, а в
// плеер идёт адрес ВЫБРАННОГО канала.
const PLAYLIST_URL = import.meta.env.VITE_STREAM_URL as string | undefined;

// Rights-holder complaint contact. Unset: no report link is rendered rather
// than a dead mailto:undefined. See docs/ADR/0004 for the takedown process
// this exists for (one verified complaint -> pull VITE_STREAM_URL or set
// VITE_STREAM_HIDDEN, see HomeScreen.tsx).
const ABUSE_CONTACT = import.meta.env.VITE_STREAM_ABUSE_CONTACT as string | undefined;

/**
 * Live TV — a standalone m3u/HLS channel relay, unrelated to the Alias
 * gameplay. Deliberately its own screen off the home game-link list (not the
 * bottom tab bar, which is reserved for the four core tabs) so it never
 * competes with a live round for screen space.
 */
export function StreamScreen() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const channels = useChannels(PLAYLIST_URL);
  const [selected, setSelected] = useState<string | null>(null);
  // Каналы, отказавшие в ЭТОМ сеансе. Список не зашит в код нарочно: три из
  // семи сломанных отдают манифест без CORS, то есть играют на iOS и не играют
  // на Android — статический перечень врал бы половине. Подробности в ./order.ts.
  const [dead, setDead] = useState<ReadonlySet<string>>(() => new Set());

  // Исходы прошлых заходов читаются ОДИН раз: пересортировать список под
  // ногами у игрока, пока он читает, — худшее, что можно сделать.
  const [health] = useState(() => readHealth());
  const [favourites, setFavourites] = useState(() => readFavourites());
  const [query, setQuery] = useState('');
  const [favOnly, setFavOnly] = useState(false);

  const raw = channels.status === 'ok' ? channels.data : [];
  // Порядок считается ОДИН раз по всему списку, отбор — поверх него. Обратный
  // порядок пересортировывал бы результат поиска, и избранное с рабочим
  // оказывались бы не там, где игрок их только что видел.
  const ordered = useMemo(
    () => orderChannels(raw, health, favourites), [raw, health, favourites]);
  const list = useMemo(
    () => filterChannels(ordered, query, favOnly, favourites),
    [ordered, query, favOnly, favourites]);
  // Группа под названием только когда она РАЗЛИЧАЕТ: сегодня плейлист отдаёт
  // все 31 канал из одной `SPORT 🏆`, и подпись превращается в 31 одинаковую
  // строку шума. Появится вторая группа — подпись вернётся сама.
  const showGroup = new Set(list.map((c) => c.group)).size > 1;
  // Первый ЖИВОЙ канал играет сам: экран, который открывается чёрным
  // прямоугольником и ждёт выбора, читается как сломанный — а первым в
  // плейлисте вполне может стоять мёртвый.
  // ⚠️ ИГРАЕТ КАНАЛ ИЗ ПОЛНОГО СПИСКА, А НЕ ИЗ ОТФИЛЬТРОВАННОГО. Иначе набор
  // текста в поиске обрывал бы то, что уже играет, — поиск обязан искать, а
  // не переключать.
  const playing = selected && !dead.has(selected)
    ? selected
    : nextAlive(ordered, null, dead);

  // Отказ канала: помечаем и уходим к следующему живому. Ровно это и чинит
  // «ТВ не работает» — раньше экран замирал на ошибке первого же мёртвого.
  const handleFailed = useCallback((failedUrl: string) => {
    markHealth(failedUrl, 'failed');
    setDead((prev) => {
      if (prev.has(failedUrl)) return prev;
      const next = new Set(prev);
      next.add(failedUrl);
      return next;
    });
    setSelected(nextAlive(ordered, failedUrl, new Set([...dead, failedUrl])));
  }, [ordered, dead]);

  // Канал заиграл — запоминаем, чтобы в следующий раз он был первым.
  const handlePlaying = useCallback((url: string) => markHealth(url, 'played'), []);

  // Живых не осталось — это НЕ «каналов нет», и сказать надо разное.
  const allDead = ordered.length > 0 && playing === null;

  return (
    <div className="min-h-screen bg-brand-bg ds-screen flex flex-col">
      <div className="flex items-center gap-3 px-4 py-4">
        <button
          type="button"
          onClick={() => { hapticImpact('light'); navigate('/'); }}
          className="text-brand-muted hover:text-white transition-colors"
          aria-label={t('home.back')}
        >
          <IconArrowLeft size={22} stroke={2} />
        </button>
        <h1 className="ds-display text-white text-xl font-black flex-1">{t('stream.title')}</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 flex flex-col items-center gap-3">

        {!PLAYLIST_URL ? (
          <p className="text-brand-muted text-[12px] text-center pt-8">{t('stream.not_configured')}</p>
        ) : (
          <>
            {playing && (
              <StreamPlayer
                key={playing}
                url={playing}
                onFailed={handleFailed}
                onPlaying={handlePlaying}
              />
            )}

            {allDead && (
              <p className="text-brand-muted text-[12px] text-center pt-8">{t('stream.all_failed')}</p>
            )}

            {channels.status === 'loading' && (
              <p className="text-brand-muted text-[12px] text-center pt-8">{t('stream.channels_loading')}</p>
            )}
            {channels.status === 'error' && (
              <p className="text-brand-muted text-[12px] text-center pt-8">{t('stream.channels_failed')}</p>
            )}
            {/* Пусто — это НЕ поломка: плейлист живой, но спортивных каналов,
                которые вообще могут проиграться, в нём сегодня нет. */}
            {channels.status === 'ok' && list.length === 0 && (
              <p className="text-brand-muted text-[12px] text-center pt-8">{t('stream.channels_empty')}</p>
            )}

            {ordered.length > 0 && (
              <div className="w-full max-w-sm flex flex-col gap-1.5 pt-1">
                {/* Поиск и «только избранное» — то, чем живёт любой плеер
                    IPTV. Здесь они не украшение: замер прода показал, что
                    играют два канала из пяти, и какие именно — у каждого
                    устройства своё. Звезда даёт сказать это один раз. */}
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <IconSearch
                      size={15} stroke={2}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 text-brand-muted pointer-events-none"
                    />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t('stream.search')}
                      aria-label={t('stream.search')}
                      className="w-full h-11 pl-8 pr-3 rounded-full bg-brand-surface border border-brand-border text-white text-xs placeholder:text-brand-muted focus:outline-none focus:border-brand-accent"
                    />
                  </div>
                  <Chip
                    label={t('stream.favourites')}
                    selected={favOnly}
                    onClick={() => { hapticImpact('light'); setFavOnly((v) => !v); }}
                  />
                </div>

                <p className="text-brand-muted text-[10.5px] uppercase tracking-wide flex items-center gap-1.5">
                  {t('stream.channels_title')}
                  <span className="tabular-nums opacity-70">{list.length}</span>
                </p>
                {/* OptionRow, а не своя строка: «выбранное» в этом проекте
                    выражают только OptionRow и Chip — см. CLAUDE.md. */}
                {/* Пусто после отбора — это НЕ «каналов нет»: список есть,
                    просто под запрос ничего не подошло. */}
                {list.length === 0 && (
                  <p className="text-brand-muted text-[12px] text-center py-6">
                    {t('stream.nothing_found')}
                  </p>
                )}

                {list.map((channel) => {
                  const failed = dead.has(channel.url);
                  const isFav = favourites.includes(channel.url);
                  return (
                    <div key={channel.url} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                    <OptionRow
                      title={channel.name}
                      // Отказавший канал не прячется, а честно подписывается:
                      // исчезнувшая из списка строка читается как баг, а «канал
                      // недоступен» объясняет, почему по ней больше не нажать.
                      description={
                        failed
                          ? t('stream.channel_failed')
                          : showGroup ? channel.group || undefined : undefined
                      }
                      selected={channel.url === playing}
                      disabled={failed}
                      onClick={() => { hapticImpact('light'); setSelected(channel.url); }}
                    />
                    </div>
                    {/* Звезда — СОСЕД OptionRow, а не часть его. «Выбранное» в
                        этом проекте выражают только OptionRow и Chip, и
                        дописывать внутрь строки вторую трактовку нельзя. */}
                    <button
                      type="button"
                      onClick={() => { hapticImpact('light'); setFavourites(toggleFavourite(channel.url)); }}
                      aria-label={t(isFav ? 'stream.unfavourite' : 'stream.favourite')}
                      aria-pressed={isFav}
                      className="w-11 h-11 flex items-center justify-center shrink-0 text-brand-muted hover:text-white transition-colors"
                    >
                      {isFav
                        ? <IconStarFilled size={17} className="text-brand-accent" />
                        : <IconStar size={17} stroke={1.75} />}
                    </button>
                    </div>
                  );
                })}
              </div>
            )}

            {ABUSE_CONTACT && (
              <a
                href={buildReportMailto(
                  ABUSE_CONTACT,
                  t('stream.report_subject'),
                  t('stream.report_body'),
                )}
                onClick={() => hapticImpact('light')}
                className="flex items-center gap-1.5 text-brand-muted text-[10.5px] underline underline-offset-2 pt-1"
              >
                <IconFlag size={13} stroke={1.75} />
                {t('stream.report_link')}
              </a>
            )}
          </>
        )}
      </div>
    </div>
  );
}
