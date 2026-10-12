import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconCards, IconLock } from '@tabler/icons-react';
import { supabase } from '@/shared/lib/supabase';
import { getRawInitData } from '@/shared/lib/telegram';
import { cardDisplayName } from '@/shared/lib/cardName';
import { PlayerPhoto } from '@/shared/ui/PlayerPhoto';
import { useDesign } from '@/shared/design/useDesign';
import { tierCardStyle } from '@/shared/lib/tier';
import { TIER_COLOR, TIER_LABEL_EN, TIER_LABEL_RU, type CardCategory, type Tier } from '@/shared/types/database';

interface CollectibleCard {
  card_id: string;
  name: string;
  name_en: string | null;
  category: CardCategory;
  category_ru: string | null;
  photo_url: string | null;
  tier: Tier | null;
  correct_guesses: number;
  acquired_at: string;
}

type ProgressCard = Omit<CollectibleCard, 'acquired_at'>;

export function CollectibleCardsPanel({ playerId }: { playerId: number | null }) {
  const { t, i18n } = useTranslation();
  const design = useDesign();
  const [cards, setCards] = useState<CollectibleCard[]>([]);
  const [progressCards, setProgressCards] = useState<ProgressCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    if (playerId == null) {
      setCards([]);
      setProgressCards([]);
      setLoading(false);
      return;
    }
    const initData = getRawInitData();
    if (!initData) {
      setCards([]);
      setProgressCards([]);
      setFailed(true);
      setLoading(false);
      return;
    }
    Promise.all([
      supabase.rpc('my_card_collectibles' as never, { p_init_data: initData } as never),
      supabase.rpc('my_card_collectible_progress' as never, { p_init_data: initData } as never),
    ])
      .then(([ownedResult, progressResult]) => {
        if (cancelled) return;
        if (ownedResult.error || progressResult.error) {
          setFailed(true);
          setCards([]);
          setProgressCards([]);
          return;
        }
        setCards((ownedResult.data ?? []) as unknown as CollectibleCard[]);
        setProgressCards((progressResult.data ?? []) as unknown as ProgressCard[]);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          setCards([]);
          setProgressCards([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [playerId]);

  const isRu = i18n.language.startsWith('ru');
  const tierLabels = isRu ? TIER_LABEL_RU : TIER_LABEL_EN;

  return (
    <section className="ds-panel rounded-2xl border border-brand-border bg-brand-surface p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-brand-accent"><IconCards size={19} stroke={1.8} /></span>
        <div className="flex-1 min-w-0">
          <h2 className="ds-display text-base font-bold text-white">{t('profile.collectibles_title')}</h2>
          <p className="text-[11px] text-brand-muted mt-0.5">{t('profile.collectibles_count')} · {cards.length}</p>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-brand-muted">{t('profile.collectibles_hint')}</p>
      {loading ? (
        <div className="grid grid-cols-3 gap-2" aria-label={t('app.loading')}>
          {[0, 1, 2].map((n) => <div key={n} className="h-28 rounded-xl bg-brand-border/40 animate-pulse" />)}
        </div>
      ) : failed ? (
        <p role="status" className="text-xs text-brand-muted">{t('profile.collectibles_error')}</p>
      ) : (
        <>
          {cards.length === 0 ? (
            <div className="rounded-xl border border-dashed border-brand-border px-3 py-5 text-center">
              <IconLock size={20} className="mx-auto text-brand-muted mb-2" stroke={1.6} />
              <p className="text-xs text-brand-muted">{t('profile.collectibles_empty')}</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {cards.map((card) => (
                <div key={card.card_id}
                  className="relative min-h-[120px] overflow-hidden rounded-xl border border-brand-border bg-brand-bg flex flex-col justify-end"
                  style={tierCardStyle(card.tier, design)}
                  title={`${t('profile.collectibles_guesses')}: ${card.correct_guesses}`}>
                  {card.photo_url && <PlayerPhoto src={card.photo_url} category={card.category} shape="free" aria-hidden className="absolute inset-0 h-full w-full" />}
                  <div className="absolute inset-x-0 bottom-0 h-3/4 pointer-events-none"
                    style={{ background: 'linear-gradient(to top, rgba(8,10,18,0.97), rgba(8,10,18,0.55) 58%, transparent)' }} />
                  <div className="relative p-2">
                    <p className="text-[10px] font-bold leading-tight text-white line-clamp-2">{cardDisplayName(card, i18n.language)}</p>
                    <p className="mt-1 text-[8px] font-semibold uppercase tracking-wide"
                      style={{ color: card.tier ? TIER_COLOR[card.tier] : '#AAB2C0' }}>
                      {card.tier ? tierLabels[card.tier] : t('profile.collectibles_owned')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {progressCards.length > 0 && (
            <div className="space-y-2 pt-1">
              <p className="text-xs font-semibold text-white">{t('profile.collectibles_progress_title')}</p>
              {progressCards.map((card) => {
                const pct = Math.min(100, Math.round((card.correct_guesses / 100) * 100));
                return (
                  <div key={card.card_id} className="rounded-xl border border-brand-border p-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-xs text-white">{cardDisplayName(card, i18n.language)}</span>
                      <span className="shrink-0 text-[10px] tabular-nums text-brand-muted">{card.correct_guesses}/100</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-brand-border">
                      <div className="h-full rounded-full bg-brand-accent transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="mt-1 text-[10px] text-brand-muted">
                      {`${t('profile.collectibles_progress_remaining')}: ${100 - card.correct_guesses}`}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}
