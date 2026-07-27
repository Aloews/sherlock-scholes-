import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import { IconSearch, IconSearchOff, IconAlertTriangle, IconX } from '@tabler/icons-react';
import { Button } from '@/shared/ui/Button';
import { PlayerCard } from '@/shared/ui/PlayerCard';
import { CategoryIcon, CATEGORY_COLOR, CATEGORY_FALLBACK_COLOR } from '@/shared/ui/CategoryIcon';
import { cardDisplayName } from '@/shared/lib/cardName';
import { tierCardStyle } from '@/shared/lib/tier';
import { useDesign } from '@/shared/design/useDesign';
import { trackEvent } from '@/shared/lib/analytics';
import { hapticImpact } from '@/shared/lib/telegram';
import { fetchCollection, type CollectionCard } from '@/features/collection/collectionApi';
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
      className="ds-panel min-h-[150px] rounded-2xl bg-brand-surface border border-brand-border
                 p-3 flex flex-col items-center justify-center gap-2 text-center"
      style={tierCardStyle(card.tier, design)}
    >
      <CategoryIcon category={card.category} color={color} size={22} />
      <p className="ds-display text-[13px] font-bold text-white leading-tight line-clamp-2">
        {cardDisplayName(card, i18n.language)}
      </p>
      {card.tier ? (
        <span
          className="text-[9px] uppercase tracking-[0.14em] font-semibold"
          style={{ color: TIER_COLOR[card.tier] }}
        >
          {tierLabel(card.tier, i18n.language)}
        </span>
      ) : (
        <span className="text-[9px] uppercase tracking-[0.14em] text-brand-muted/70">
          {label}
        </span>
      )}
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

  const [cards,   setCards]   = useState<CollectionCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [paging,  setPaging]  = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [catFilter,   setCatFilter]   = useState<Filter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  // Debounced mirror of searchQuery — the value the query actually runs with.
  const [term, setTerm] = useState('');
  // Bumped by the retry button to re-run the current query.
  const [reloadKey, setReloadKey] = useState(0);
  const [openCard, setOpenCard] = useState<CollectionCard | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setTerm(searchQuery), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [searchQuery]);

  // First page — re-runs whenever the filter, the debounced term or the retry
  // key changes. Later pages are appended by loadMore().
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCollection({ category: catFilter, query: term, offset: 0, lang: i18n.language })
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
  }, [catFilter, term, reloadKey, i18n.language]);

  const loadMore = useCallback(() => {
    if (paging) return;
    setPaging(true);
    fetchCollection({ category: catFilter, query: term, offset: cards.length, lang: i18n.language })
      .then(({ cards: page, hasMore: more }) => {
        setCards((prev) => [...prev, ...page]);
        setHasMore(more);
      })
      .catch(() => setHasMore(false))
      .finally(() => setPaging(false));
  }, [paging, catFilter, term, cards.length, i18n.language]);

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
            onClick={() => { hapticImpact('light'); navigate('/'); }}
            aria-label={t('home.back')}
            className="w-9 h-9 shrink-0 flex items-center justify-center rounded-xl bg-brand-surface
                       border border-brand-border text-brand-muted hover:text-white transition-colors"
          >
            <IconX size={16} stroke={2} />
          </button>
          <h1 className="ds-display text-xl font-bold text-white">{t('collection.title')}</h1>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
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
                    setOpenCard(card);
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

      {/* Card detail — centred sheet over the repo's usual backdrop. */}
      <AnimatePresence>
        {openCard && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setOpenCard(null)}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6"
          >
            <motion.div
              initial={{ y: 18, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 18, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm"
            >
              <PlayerCard card={openCard} mode="explainer" />
              <Button
                fullWidth
                variant="ghost"
                className="mt-3"
                onClick={() => setOpenCard(null)}
              >
                {t('home.back')}
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
