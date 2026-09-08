import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { goBack } from '@/shared/lib/goBack';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { IconSearch, IconSearchOff, IconAlertTriangle, IconX, IconCrown } from '@tabler/icons-react';
import { Button } from '@/shared/ui/Button';
import { CategoryIcon, CATEGORY_COLOR, CATEGORY_FALLBACK_COLOR } from '@/shared/ui/CategoryIcon';
import { PlayerPhoto } from '@/shared/ui/PlayerPhoto';
import { cardDisplayName } from '@/shared/lib/cardName';
import { tierCardStyle } from '@/shared/lib/tier';
import { useDesign } from '@/shared/design/useDesign';
import { trackEvent } from '@/shared/lib/analytics';
import { hapticImpact } from '@/shared/lib/telegram';
import { useProStore } from '@/shared/store/proStore';
import {
  fetchCollection, fetchCard,
  type CollectionCard, type CollectionFilter,
} from '@/features/collection/collectionApi';
import { CardDossier } from '@/screens/collection/CardDossier';
import { Chip } from '@/shared/ui/Chip';
import { ClubsPane } from './collection/ClubsPane';
import { StatsPane } from './collection/StatsPane';
import { ScopeFilter } from '@/shared/ui/ScopeFilter';
import type { Card } from '@/shared/types/database';
import {
  ALL_CATEGORIES, TIER_COLOR, TIER_LABEL_RU, TIER_LABEL_EN,
  type CardCategory, type Tier,
} from '@/shared/types/database';

// Search runs in Postgres (see collectionApi) — debounce the keystrokes so a
// fast typist fires one query, not eight.
const SEARCH_DEBOUNCE_MS = 250;

const DANGER = '#EF4444';

type Filter = CardCategory | 'all';

const tierLabel = (tier: Tier, lang: string) =>
  (lang.startsWith('ru') ? TIER_LABEL_RU : TIER_LABEL_EN)[tier];

/** One grid cell: category icon, name, rarity label, tier-coloured frame. */
function CollectionCell({ card, onOpen }: {
  card: CollectionCard;
  onOpen: () => void;
}) {
  const { t, i18n } = useTranslation();
  const design = useDesign();
  const color = CATEGORY_COLOR[card.category] ?? CATEGORY_FALLBACK_COLOR;
  const label = i18n.language.startsWith('ru') && card.category_ru
    ? card.category_ru
    : t(`category.${card.category}`);

  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.94 }}
      transition={{ duration: 0.1 }}
      onClick={onOpen}
      aria-label={cardDisplayName(card, i18n.language)}
      className="ds-panel relative min-h-[150px] rounded-2xl bg-brand-surface border border-brand-border
                 overflow-hidden flex flex-col justify-end text-left"
      style={tierCardStyle(card.tier, design)}
    >
      {/* The photo IS the cell. Crests keep their own padding via
          photoFitClass, so a shield is shown whole while a headshot fills the
          frame — the same rule the card watermark follows. */}
      {/* No photo means no picture — the frame, the name and the rarity row
          carry the cell on their own. A category glyph blown up to fill the
          middle read as artwork the card does not have. */}
      {card.photo_url && (
        <PlayerPhoto
          src={card.photo_url}
          category={card.category}
          shape="free"
          aria-hidden
          className="absolute inset-0 w-full h-full"
        />
      )}

      {/* Scrim: the name sits on a photo whose brightness we do not control,
          so it gets its own gradient rather than relying on the image being
          dark enough. Opaque at the bottom, clear by the middle. */}
      <div
        className="absolute inset-x-0 bottom-0 h-3/5 pointer-events-none"
        style={{ background: 'linear-gradient(to top, rgba(8,10,18,0.94) 15%, rgba(8,10,18,0.72) 45%, transparent)' }}
      />

      <div className="relative p-2.5 pt-6">
        <p className="ds-display text-[13px] font-bold text-white leading-tight line-clamp-2">
          {cardDisplayName(card, i18n.language)}
        </p>
        <div className="flex items-center gap-1.5 mt-1">
          <CategoryIcon category={card.category} color={color} size={12} />
          {card.tier ? (
            <span
              className="text-[9px] uppercase tracking-[0.14em] font-semibold"
              style={{ color: TIER_COLOR[card.tier] }}
            >
              {tierLabel(card.tier, i18n.language)}
            </span>
          ) : (
            <span className="text-[9px] uppercase tracking-[0.14em] text-brand-muted">
              {label}
            </span>
          )}
        </div>
      </div>
    </motion.button>
  );
}

/** Centred icon + heading + one line of body copy. Shared by the empty-search
 * and error states, which differ only in icon, colour and copy. */
function StateBlock({ icon, title, body, children }: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-14 px-5 text-center">
      {icon}
      <p className="ds-display text-base text-white">{title}</p>
      <p className="text-xs text-brand-muted leading-relaxed">{body}</p>
      {children}
    </div>
  );
}

export function CollectionScreen() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  // The catalog is a Pro feature: ~2.1k cards is a heavy read for the free
  // tier, and browsing the whole deck is exactly the kind of depth Pro is for.
  const isPro = useProStore((s) => s.isPro);

  const [cards,   setCards]   = useState<CollectionCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [paging,  setPaging]  = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [catFilter,   setCatFilter]   = useState<Filter>('all');
  // Клуб, лига и страна — отбор на СТОРОНЕ БАЗЫ. См. collectionApi:
  // на клиенте он работал бы по первой тысяче из 25 509 карточек.
  const [filter, setFilter] = useState<CollectionFilter>({});
  const [searchQuery, setSearchQuery] = useState('');
  // Debounced mirror of searchQuery — the value the query actually runs with.
  const [term, setTerm] = useState('');
  // Bumped by the retry button to re-run the current query.
  const [reloadKey, setReloadKey] = useState(0);
  // Tapping a cell opens the dossier, which needs the full row — the grid only
  // fetched display columns. `openId` drives the fetch; `openCard` holds it.
  const [openId,   setOpenId]   = useState<string | null>(null);
  const [openCard, setOpenCard] = useState<Card | null>(null);

  // ⚠️ ДОСЬЕ ОТКРЫВАЕТСЯ ПО АДРЕСУ, И ЭТО ЕДИНСТВЕННЫЙ СПОСОБ ПРИЙТИ СЮДА
  // ИЗВНЕ. Рейтинг, фэнтези и состав команды показывают тех же футболистов,
  // что лежат в коллекции, и до сих пор ни одна из этих строк никуда не
  // вела: игрок видел имя и не мог узнать о нём ничего. Заводить на каждом
  // экране свою копию досье значило бы завести три места, где оно однажды
  // разойдётся.
  //
  // ⚠️ И ЭТА ДВЕРЬ НЕ ЗА PRO-ЗАМКОМ, намеренно. Pro закрывает КАТАЛОГ —
  // 2.1 тыс. карточек, тяжёлое чтение, и просмотр всей колоды это и есть та
  // глубина, за которую платят. Одна карточка, на которую пришли по ссылке из
  // рейтинга, — это одна строка и не просмотр каталога; упереть строку
  // рейтинга в предложение купить подписку значит наказать за интерес.
  const [params, setParams] = useSearchParams();
  const cardParam = params.get('card');

  // ⚠️ ТРИ РАЗДЕЛА НА ОДНОМ ЭКРАНЕ, А НЕ ТРИ ЭКРАНА. Владелец: «объедини
  // экран команды и статистика с коллекциями с навигацией и назад».
  // Карточки, команды и статистика — это один и тот же собранный футбол,
  // разрезанный по-разному: карточка игрока, карточка команды, числа. Тремя
  // соседними строками на главной они читались как три раздела приложения,
  // хотя это одна полка — ровно тот же разбор, что уже сделан для арены и
  // мини-игр (docs/MAP.md §2).
  //
  // Раздел живёт В АДРЕСЕ, а не только в состоянии: иначе «назад» из команды
  // возвращало бы в карточки, а разосланная ссылка открывала бы не то.
  const viewParam = params.get('view');
  const view: 'cards' | 'clubs' | 'stats' =
    viewParam === 'clubs' || viewParam === 'stats' ? viewParam : 'cards';
  const setView = (next: 'cards' | 'clubs' | 'stats') => {
    hapticImpact('light');
    const p = new URLSearchParams(params);
    if (next === 'cards') p.delete('view'); else p.set('view', next);
    p.delete('card');
    // ⚠️ REPLACE, А НЕ PUSH, И ЭТО ПОЧИНКА ЗАВИСАНИЯ. Раздел — не страница:
    // «назад» обязано уводить С ЭКРАНА, а не отменять нажатие вкладки. С push
    // каждое переключение клало запись в историю, и десяток нажатий
    // превращал одну кнопку «назад» в десять — а вместе с ними в память
    // ложилось десять состояний экрана, каждое со своими списками.
    // Владелец: «из-за того что теперь сохраняется история просмотренных
    // страничек… приложение начинает зависать».
    setParams(p, { replace: true });
  };

  // ⚠️ РАЗДЕЛ, КОТОРЫЙ УЖЕ ОТКРЫВАЛИ, БОЛЬШЕ НЕ РАЗМОНТИРУЕТСЯ — ОН ПРЯЧЕТСЯ.
  // Прежде переключение вкладки уносило пару-тройку тяжёлых чтений в мусор и
  // при возврате повторяло их заново: каталог 28 тысяч карточек, рейтинг на
  // 25 508 игроков и справочник команд. Пять переключений — пятнадцать
  // запросов вместо трёх, и это и есть «перегружается».
  //
  // ⚠️ ref, А НЕ state: набор пополняется ВО ВРЕМЯ отрисовки, чтобы только
  // что выбранный раздел появился тем же кадром. Через эффект он опоздал бы
  // на кадр, и вкладка мигала бы пустотой. Лишней перерисовки не нужно —
  // смена `view` её и так вызывает.
  const visited = useRef<Set<'cards' | 'clubs' | 'stats'>>(new Set());
  visited.current.add(view);
  const seen = (v: 'cards' | 'clubs' | 'stats') => visited.current.has(v);
  // Класс раздела: показанный занимает экран, спрятанный исчезает из вёрстки
  // (`display: none`), сохраняя своё состояние и место прокрутки.
  const pane = (v: 'cards' | 'clubs' | 'stats', shown: string) =>
    (view === v ? shown : 'hidden');

  useEffect(() => {
    if (cardParam) setOpenId(cardParam);
  }, [cardParam]);

  /** Закрыть досье и убрать его из адреса, чтобы «назад» не открыло снова. */
  const closeDossier = () => {
    setOpenId(null);
    if (cardParam) {
      const next = new URLSearchParams(params);
      next.delete('card');
      setParams(next, { replace: true });
    }
  };

  useEffect(() => {
    if (!openId) { setOpenCard(null); return; }
    let cancelled = false;
    fetchCard(openId)
      .then((full) => { if (!cancelled) setOpenCard(full); })
      .catch(() => { if (!cancelled) setOpenId(null); });
    return () => { cancelled = true; };
  }, [openId]);

  useEffect(() => {
    const id = setTimeout(() => setTerm(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchQuery]);


  // First page — re-runs whenever the filter, the debounced term or the retry
  // key changes. Later pages are appended by loadMore().
  //
  // ⚠️ ТОЛЬКО ЕСЛИ В КАРТОЧКИ УЖЕ ЗАХОДИЛИ, И ЭТО ПОЧИНКА ПАДЕНИЯ, А НЕ
  // ЭКОНОМИЯ. Владелец: «приложение начало выключаться при открытии
  // „коллекций“ и „рейтинга футболистов“». Оба этих экрана — ОДИН компонент с
  // тех пор, как разделы свели вместе, и эффект без проверки раздела запускал
  // чтение каталога 28 тысяч карточек ДАЖЕ когда открыт рейтинг: три тяжёлых
  // запроса разом (каталог, фасеты, сам рейтинг) вместо одного. На телефоне
  // по мобильной сети это и есть «выключается».
  //
  // ⚠️ УСЛОВИЕ ИМЕННО «ЗАХОДИЛИ», А НЕ «ОТКРЫТ СЕЙЧАС»: `cardsSeen` один раз
  // становится true и больше не меняется, поэтому возврат на вкладку карточек
  // НЕ перезапрашивает каталог. С `view` в зависимостях каждое переключение
  // туда-обратно стоило бы полного чтения заново — того самого, из-за
  // которого экран и вставал.
  const cardsSeen = seen('cards');
  useEffect(() => {
    if (!cardsSeen) return;
    if (!isPro) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCollection({ category: catFilter, query: term, offset: 0, lang: i18n.language, filter })
      .then(({ cards: page, hasMore: more }) => {
        if (cancelled) return;
        setCards(page);
        setHasMore(more);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setCards([]);
        setHasMore(false);
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [cardsSeen, catFilter, term, reloadKey, i18n.language, isPro, filter]);

  const loadMore = useCallback(() => {
    if (paging) return;
    setPaging(true);
    fetchCollection({
      category: catFilter, query: term, offset: cards.length,
      lang: i18n.language, filter,
    })
      .then(({ cards: page, hasMore: more }) => {
        setCards((prev) => [...prev, ...page]);
        setHasMore(more);
      })
      .catch(() => setHasMore(false))
      .finally(() => setPaging(false));
  }, [paging, catFilter, term, cards.length, i18n.language, filter]);

  const pickCategory = (next: Filter) => {
    hapticImpact('light');
    setCatFilter(next);
    if (next !== 'all') trackEvent('collection_filtered', { category: next });
  };

  const filters: Filter[] = ['all', ...ALL_CATEGORIES];

  return (
    <div className="min-h-screen bg-brand-bg ds-screen flex flex-col">
      {/* Header */}
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
          <h1 className="ds-display text-xl font-bold text-white">
            {view === 'clubs' ? t('clubs.title')
              : view === 'stats' ? t('ratings.title')
              : t('collection.title')}
          </h1>
        </div>

        {/* Переключатель разделов. Выбор выражается Chip — единственным
            способом, каким он выражается в этом проекте. */}
        <div className="max-w-sm mx-auto flex gap-1.5 mt-3 overflow-x-auto pb-0.5">
          <Chip label={t('collection.view_cards')} selected={view === 'cards'}
                onClick={() => setView('cards')} />
          <Chip label={t('collection.view_clubs')} selected={view === 'clubs'}
                onClick={() => setView('clubs')} />
          <Chip label={t('collection.view_stats')} selected={view === 'stats'}
                onClick={() => setView('stats')} />
        </div>
      </div>

      {/* ⚠️ КОМАНДЫ И СТАТИСТИКА — БЕЗ PRO-ЗАМКА, И ЭТО НЕ НЕДОСМОТР. Pro
          закрывает КАТАЛОГ карточек: тяжёлое чтение всей колоды и есть та
          глубина, за которую платят. Списки команд и рейтинги были открыты
          всем на своих прежних адресах, и переезд в общий экран не повод их
          закрыть — это было бы отъёмом того, что уже отдано. */}
      {seen('clubs') && (
        <div className={pane('clubs', 'flex-1 overflow-y-auto')}>
          <div className="max-w-sm mx-auto px-4 pt-4 pb-24"><ClubsPane /></div>
        </div>
      )}
      {seen('stats') && (
        <div className={pane('stats', 'flex-1 overflow-y-auto')}>
          <div className="max-w-sm mx-auto px-4 pt-4 pb-24"><StatsPane /></div>
        </div>
      )}

      {/* Free users get the upsell instead of the catalog — and no query is
          issued at all, so the deck read stays a Pro-only cost. */}
      {seen('cards') && (!isPro ? (
        <div className={pane('cards', 'flex-1 flex items-center justify-center px-6')}>
          <div className="max-w-sm w-full flex flex-col items-center gap-4 text-center">
            <span
              className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ backgroundColor: 'rgb(var(--brand-accent) / 0.1)' }}
            >
              <IconCrown size={30} stroke={1.75} className="text-brand-accent" />
            </span>
            <p className="ds-display text-lg font-bold text-white">{t('collection.pro_title')}</p>
            <p className="text-sm text-brand-muted leading-relaxed">{t('collection.pro_body')}</p>
            <Button fullWidth size="lg" onClick={() => { hapticImpact('light'); navigate('/pro'); }}>
              {t('collection.pro_cta')}
            </Button>
          </div>
        </div>
      ) : (
      <div className={pane('cards', 'flex-1 overflow-y-auto')}>
        <div className="max-w-sm mx-auto px-4 py-4 space-y-3">
          {/* Search */}
          <div className="relative">
            <IconSearch
              size={16}
              stroke={1.75}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-muted pointer-events-none"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('collection.search_placeholder')}
              className="w-full h-11 rounded-2xl bg-brand-surface border border-brand-border
                         pl-10 pr-4 text-[13px] text-white placeholder-brand-muted/70
                         focus:outline-none focus:border-brand-accent transition-colors"
            />
          </div>

          {/* Category pills */}
          <div className="flex gap-2 overflow-x-auto pb-0.5 -mx-4 px-4">
            {filters.map((f) => {
              const active = catFilter === f;
              const color = f === 'all'
                ? CATEGORY_FALLBACK_COLOR
                : (CATEGORY_COLOR[f] ?? CATEGORY_FALLBACK_COLOR);
              return (
                <motion.button
                  key={f}
                  type="button"
                  whileTap={{ scale: 0.94 }}
                  transition={{ duration: 0.1 }}
                  onClick={() => pickCategory(f)}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full border
                              text-[11.5px] font-semibold transition-colors ${
                    active
                      ? 'bg-brand-accent/10 border-brand-accent/50 text-brand-accent'
                      : 'bg-transparent border-brand-border text-brand-muted'
                  }`}
                >
                  {f !== 'all' && (
                    <CategoryIcon category={f} color={active ? 'currentColor' : color} />
                  )}
                  {f === 'all' ? t('collection.filter_all') : t(`category.${f}`)}
                </motion.button>
              );
            })}
          </div>

          {/* Клуб, лига, страна — общий компонент, см. ScopeFilter. */}
          <ScopeFilter
            value={filter}
            onChange={setFilter}
            category={catFilter === 'all' ? 'all' : (catFilter as 'player' | 'club')}
          />

          {/* Body: loading → error → empty → grid */}
          {loading ? (
            <div className="grid grid-cols-2 gap-3" aria-busy>
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="min-h-[150px] rounded-2xl bg-brand-border/40 animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <StateBlock
              icon={<IconAlertTriangle size={34} stroke={1.5} style={{ color: DANGER }} />}
              title={t('collection.error_title')}
              body={error}
            >
              <Button variant="secondary" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
                {t('collection.retry')}
              </Button>
            </StateBlock>
          ) : cards.length === 0 ? (
            <StateBlock
              icon={<IconSearchOff size={34} stroke={1.5} className="text-brand-muted" />}
              title={t('collection.empty_title')}
              body={t('collection.empty_body')}
            />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                {cards.map((card) => (
                  <CollectionCell key={card.id} card={card} onOpen={() => {
                    hapticImpact('light');
                    setOpenId(card.id);
                    trackEvent('collection_card_opened', { tier: card.tier ?? 'none' });
                  }} />
                ))}
              </div>
              {/* Paged rather than "all of it": the catalog is ~2k cards and
                  PostgREST caps a select at 1000 rows. */}
              {hasMore && (
                <Button
                  fullWidth
                  variant="secondary"
                  loading={paging}
                  onClick={() => { hapticImpact('light'); loadMore(); }}
                >
                  {t('collection.load_more')}
                </Button>
              )}
              <p className="text-center text-[11px] text-brand-muted/70 pb-2">
                {t('collection.count', { n: cards.length })}
                {hasMore ? '+' : ''}
              </p>
            </>
          )}

          {/* TODO(collection-v2): with a `player_cards` table this is where the
              locked/unlocked split goes — locked cells render greyed with a
              lock icon and `???` for the name (PlayerCard's mode="hidden"
              treatment) and are not tappable. The grid/empty-state code above
              is identical either way; only the source of truth changes. */}
        </div>
      </div>
      ))}

      {/* Card detail — the full-screen dossier (screens/collection/CardDossier). */}
      <AnimatePresence>
        {openCard && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <CardDossier card={openCard} onClose={closeDossier} />
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}
