import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconSearch,
  IconSearchOff,
  IconX,
} from '@tabler/icons-react';
import { supabase } from '@/shared/lib/supabase';
import { cardDisplayName } from '@/shared/lib/cardName';
import { asTier, tierCardStyle } from '@/shared/lib/tier';
import { hapticImpact } from '@/shared/lib/telegram';
import { Button } from '@/shared/ui/Button';
import { PlayerCard } from '@/shared/ui/PlayerCard';
import { CategoryIcon, CATEGORY_COLOR } from '@/shared/ui/CategoryIcon';
import {
  ALL_CATEGORIES,
  TIER_COLOR,
  TIER_LABEL_EN,
  TIER_LABEL_RU,
  type Card,
  type CardCategory,
} from '@/shared/types/database';

// Danger colour for the error state — same red the report sheet uses.
const DANGER = '#EF4444';

// Skeleton cells shown while the first fetch is in flight (two grid columns → 5 rows).
const SKELETON_COUNT = 10;

// PostgREST caps every response at its max-rows setting (1000 here), so the
// ~2.1k-card catalog has to be pulled page by page — a single select() would
// silently drop half the deck and make search miss it. Same cap useTraining
// batches around.
const PAGE = 1000;
// Stops a misbehaving backend from looping forever; 50 pages is ~25x the
// current catalog, so it can only ever fire on a bug, never in normal use.
const MAX_PAGES = 50;

// Keyboard-focusable descendants of the dialog, for the Tab trap.
const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

type CatFilter = CardCategory | 'all';

/** The whole active catalog, most-known first. Throws on the first failed page. */
async function fetchCatalog(): Promise<Card[]> {
  const all: Card[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await supabase
      .from('cards')
      .select('*')
      .eq('active', true)
      // Most-known cards first; cards without pageviews sink to the bottom.
      // id breaks ties so paging stays deterministic — without it the rows
      // that share a pageviews value (every NULL one) can repeat or vanish
      // between pages.
      .order('pageviews', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      // Offset by what actually arrived rather than by i * PAGE: a project
      // whose db.max_rows is below PAGE returns a short page that is NOT the
      // end of the catalog, and stepping by PAGE would skip the remainder.
      .range(all.length, all.length + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as Card[];
    all.push(...page);
    if (page.length === 0) break;
  }
  return all;
}

/** Card dossier over a dimmed backdrop: focus moves in, Tab stays in, Esc closes. */
function CardDialog({ card, onClose }: { card: Card; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      const items = ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!items?.length) { e.preventDefault(); return; }
      const first = items[0];
      const last  = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    // Hold the grid still behind the overlay.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus();
    };
  }, [onClose]);

  return (
    <motion.div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={cardDisplayName(card, i18n.language)}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6 focus:outline-none"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
    >
      <motion.div
        className="w-full max-w-sm"
        initial={{ scale: 0.92, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 12 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        onClick={(e) => e.stopPropagation()}
      >
        <PlayerCard card={card} mode="explainer" />
      </motion.div>
      <button
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
        aria-label={t('collection.close')}
        onClick={onClose}
      >
        <IconX size={22} stroke={2} />
      </button>
    </motion.div>
  );
}

/** Centred icon + heading + one muted line — shared by the empty and error states. */
function StateBlock({ icon, title, desc, action }: {
  icon: React.ReactNode;
  title: string;
  desc?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-5 py-14 text-center">
      {icon}
      <p className="text-white text-base font-medium">{title}</p>
      {desc && <p className="text-brand-muted text-xs leading-relaxed">{desc}</p>}
      {action}
    </div>
  );
}

export function CollectionScreen() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const [cards,       setCards]       = useState<Card[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [catFilter,   setCatFilter]   = useState<CatFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  // Card opened in the dossier modal, or null when closed.
  const [opened, setOpened] = useState<Card | null>(null);
  // Bumped by the retry button to re-run the fetch effect.
  const [reloadKey, setReloadKey] = useState(0);

  // v1: the collection IS the active catalog — every card is browsable, there's
  // no per-player unlocked set yet.
  // TODO(collection-v2): gate each cell on a player_cards lookup here — locked
  // cards render greyed with a lock icon and `???` instead of the name.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCatalog()
      .then((all) => {
        if (cancelled) return;
        setCards(all);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setCards([]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const closeDialog = useCallback(() => setOpened(null), []);

  const tierLabel = i18n.language.startsWith('ru') ? TIER_LABEL_RU : TIER_LABEL_EN;

  // Client-side filter — the catalog is a few thousand rows at most and is
  // already in memory, so there's nothing to debounce or re-query.
  const visible = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return cards.filter((card) => {
      if (catFilter !== 'all' && card.category !== catFilter) return false;
      if (!q) return true;
      // Match the displayed name plus both raw names, so a search works
      // whatever the interface language is set to.
      return [cardDisplayName(card, i18n.language), card.name, card.name_en]
        .some((n) => n?.toLowerCase().includes(q));
    });
  }, [cards, catFilter, searchQuery, i18n.language]);

  const pills: Array<{ key: CatFilter; label: string; category?: CardCategory }> = [
    { key: 'all', label: t('collection.all_categories') },
    ...ALL_CATEGORIES.map((c) => ({ key: c as CatFilter, label: t(`category.${c}`), category: c })),
  ];

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col">
      {/* Header — the rule spans the viewport (as on every other screen); only
          its content is capped to the phone-width column. */}
      <div className="border-b border-brand-border">
        <div className="w-full max-w-sm mx-auto flex items-center gap-2 px-4 pt-8 pb-3">
          <button
            aria-label={t('home.back')}
            className="text-brand-muted hover:text-white transition-colors p-1 -ml-1 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
            onClick={() => { hapticImpact('light'); navigate('/'); }}
          >
            <IconArrowLeft size={20} stroke={2} />
          </button>
          <h1 className="font-display text-xl font-bold text-white">{t('collection.title')}</h1>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 w-full max-w-sm mx-auto px-4 pt-4 pb-8 safe-bottom overflow-y-auto space-y-3">
        {/* Search */}
        <div className="relative">
          <IconSearch
            size={16}
            stroke={1.75}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-muted pointer-events-none"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('collection.search_placeholder')}
            aria-label={t('collection.search_placeholder')}
            className="w-full h-11 bg-brand-surface border border-brand-border rounded-2xl pl-10 pr-4 text-white text-sm placeholder-brand-muted/70 focus:outline-none focus:border-brand-accent transition-colors"
          />
        </div>

        {/* Category filter pills */}
        <div className="flex gap-2 overflow-x-auto pb-0.5">
          {pills.map((pill) => {
            const active = catFilter === pill.key;
            return (
              <motion.button
                key={pill.key}
                whileTap={{ scale: 0.94 }}
                transition={{ duration: 0.1 }}
                aria-pressed={active}
                onClick={() => { hapticImpact('light'); setCatFilter(pill.key); }}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-full border text-[11.5px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent ${
                  active
                    ? 'bg-brand-accent/10 border-brand-accent/50 text-brand-accent'
                    : 'bg-transparent border-brand-border text-brand-muted hover:text-white'
                }`}
              >
                {pill.category && (
                  <CategoryIcon
                    category={pill.category}
                    color={active ? '#FF6300' : '#7A8499'}
                  />
                )}
                {pill.label}
              </motion.button>
            );
          })}
        </div>

        {/* Grid / states */}
        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
              <div key={i} className="min-h-[150px] rounded-2xl bg-brand-border/40 animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <StateBlock
            icon={<IconAlertTriangle size={34} stroke={1.5} style={{ color: DANGER }} />}
            title={t('collection.error_title')}
            action={
              <Button
                variant="secondary"
                size="sm"
                className="mt-1"
                onClick={() => { hapticImpact('light'); setReloadKey((k) => k + 1); }}
              >
                {t('collection.retry')}
              </Button>
            }
          />
        ) : visible.length === 0 ? (
          <StateBlock
            icon={<IconSearchOff size={34} stroke={1.5} className="text-brand-muted" />}
            title={t('collection.empty_title')}
            desc={t('collection.empty_desc')}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {visible.map((card) => {
              const catColor = CATEGORY_COLOR[card.category] ?? '#7A8499';
              const tier     = asTier(card.tier);
              return (
                <motion.button
                  key={card.id}
                  whileTap={{ scale: 0.94 }}
                  transition={{ duration: 0.1 }}
                  onClick={() => { hapticImpact('light'); setOpened(card); }}
                  className="min-h-[150px] rounded-2xl bg-brand-surface border border-brand-border px-2.5 py-3.5 flex flex-col items-center justify-center gap-2 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
                  // Rarity tier: coloured frame + glow (common/unknown → none).
                  style={tierCardStyle(card.tier)}
                >
                  <span
                    className="w-[34px] h-[34px] rounded-xl bg-white/5 border flex items-center justify-center"
                    style={{ borderColor: `${catColor}66` }}
                  >
                    <CategoryIcon category={card.category} color={catColor} size={16} />
                  </span>
                  <span className="font-display text-[13px] font-bold text-white leading-tight line-clamp-2">
                    {cardDisplayName(card, i18n.language)}
                  </span>
                  {tier && (
                    <span
                      className="text-[9px] font-bold uppercase tracking-[0.1em]"
                      style={{ color: TIER_COLOR[tier] }}
                    >
                      {tierLabel[tier]}
                    </span>
                  )}
                </motion.button>
              );
            })}
          </div>
        )}
      </div>

      {/* Card dossier — the same PlayerCard the explainer sees, on a dimmed backdrop. */}
      <AnimatePresence>
        {opened && <CardDialog card={opened} onClose={closeDialog} />}
      </AnimatePresence>
    </div>
  );
}
