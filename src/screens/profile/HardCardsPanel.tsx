import { useEffect, useState } from 'react';
import { supabase } from '@/shared/lib/supabase';
import { PlayerPhoto } from '@/shared/ui/PlayerPhoto';

interface HardCard {
  card_id: string;
  name: string;
  category_ru: string | null;
  photo_url: string | null;
  misses: number;
}

interface JoinedRow {
  card_id: string;
  cards: { name: string; category_ru: string | null; photo_url: string | null } | null;
}

/**
 * Cards skipped in rounds the player explained. Alias currently records the
 * outcome at round/team level, not the identity of each guesser, so the UI
 * deliberately describes these as difficult cards from the player's rounds
 * rather than claiming that this is an individual guessing-error rate.
 */
export function HardCardsPanel({ playerId }: { playerId: number | null }) {
  const [cards, setCards] = useState<HardCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (playerId === null) {
      setCards([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setFailed(false);
    void supabase
      .from('round_cards')
      .select('card_id, cards!inner(name, category_ru, photo_url), rounds!inner(explainer_id)')
      .eq('rounds.explainer_id', playerId)
      .eq('status', 'skipped')
      .not('rounds.ended_at', 'is', null)
      .limit(1000)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setFailed(true);
          setCards([]);
          return;
        }
        const counts = new Map<string, HardCard>();
        for (const row of (data ?? []) as unknown as JoinedRow[]) {
          if (!row.cards) continue;
          const existing = counts.get(row.card_id);
          if (existing) existing.misses += 1;
          else counts.set(row.card_id, {
            card_id: row.card_id,
            name: row.cards.name,
            category_ru: row.cards.category_ru,
            photo_url: row.cards.photo_url,
            misses: 1,
          });
        }
        setCards([...counts.values()].sort((a, b) => b.misses - a.misses || a.name.localeCompare(b.name)).slice(0, 5));
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [playerId]);

  return (
    <section className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">
      <div>
        <h2 className="text-white text-sm font-semibold">Самые сложные карточки</h2>
        <p className="text-brand-muted text-[11px] mt-1">Чаще всего пропускали в раундах, которые вы объясняли</p>
      </div>
      {loading && <p className="text-brand-muted text-sm">Загружаем статистику…</p>}
      {!loading && failed && <p className="text-red-400/80 text-sm">Не удалось загрузить карточки</p>}
      {!loading && !failed && cards.length === 0 && (
        <p className="text-brand-muted text-sm">Пока нет пропущенных карточек в завершённых раундах</p>
      )}
      {!loading && !failed && cards.length > 0 && (
        <ol className="space-y-2">
          {cards.map((card) => (
            <li key={card.card_id} className="flex items-center gap-3 rounded-xl bg-brand-bg border border-brand-border px-3 py-2">
              {card.photo_url ? (
                <PlayerPhoto src={card.photo_url} alt={card.name} className="w-10 h-10 shrink-0 rounded-full" />
              ) : (
                <div aria-hidden="true" className="w-10 h-10 shrink-0 rounded-full bg-brand-surface border border-brand-border flex items-center justify-center text-brand-muted text-xs">⚽</div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-white text-sm font-medium truncate">{card.name}</p>
                {card.category_ru && <p className="text-brand-muted text-[10px]">{card.category_ru}</p>}
              </div>
              <span className="text-brand-accent text-xs font-semibold tabular-nums">×{card.misses}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
