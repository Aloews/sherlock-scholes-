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

type Membership = { room_id: string; team_id: string | null };
type RoundRow = { id: string; room_id: string; team_id: string };
type RoundCardRow = { round_id: string; card_id: string };
type CardRow = { id: string; name: string; category_ru: string | null; photo_url: string | null };

/**
 * Estimate the cards this player struggled to guess: skipped cards in finished
 * rounds where they were a member of the explaining team but were not the
 * explainer. The schema records round outcomes, not per-guess events, so this
 * is a team-context proxy, not a claim that we know who personally said what.
 */
export function HardCardsPanel({ playerId }: { playerId: number | null }) {
  const [cards, setCards] = useState<HardCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (playerId === null) {
        setCards([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      setFailed(false);
      try {
        const { data: memberships, error: membershipError } = await supabase
          .from('room_players')
          .select('room_id, team_id')
          .eq('player_id', playerId)
          .not('team_id', 'is', null);
        if (membershipError) throw membershipError;

        const teams = (memberships ?? []) as Membership[];
        const pairs = new Set(teams.map((m) => `${m.room_id}:${m.team_id}`));
        const roomIds = [...new Set(teams.map((m) => m.room_id))];
        const teamIds = [...new Set(teams.map((m) => m.team_id).filter((id): id is string => Boolean(id)))];
        if (!pairs.size || !roomIds.length || !teamIds.length) {
          if (!cancelled) setCards([]);
          return;
        }

        const { data: roundRows, error: roundsError } = await supabase
          .from('rounds')
          .select('id, room_id, team_id')
          .in('room_id', roomIds)
          .in('team_id', teamIds)
          .neq('explainer_id', playerId)
          .not('ended_at', 'is', null);
        if (roundsError) throw roundsError;

        const relevantRounds = ((roundRows ?? []) as RoundRow[])
          .filter((round) => pairs.has(`${round.room_id}:${round.team_id}`));
        const roundIds = relevantRounds.map((round) => round.id);
        if (!roundIds.length) {
          if (!cancelled) setCards([]);
          return;
        }

        const { data: roundCards, error: roundCardsError } = await supabase
          .from('round_cards')
          .select('round_id, card_id')
          .eq('status', 'skipped')
          .in('round_id', roundIds)
          .limit(1000);
        if (roundCardsError) throw roundCardsError;

        const skipped = (roundCards ?? []) as RoundCardRow[];
        const cardIds = [...new Set(skipped.map((row) => row.card_id))];
        if (!cardIds.length) {
          if (!cancelled) setCards([]);
          return;
        }

        const { data: cardRows, error: cardsError } = await supabase
          .from('cards')
          .select('id, name, category_ru, photo_url')
          .in('id', cardIds);
        if (cardsError) throw cardsError;

        const cardById = new Map(((cardRows ?? []) as CardRow[]).map((card) => [card.id, card]));
        const counts = new Map<string, HardCard>();
        for (const row of skipped) {
          const card = cardById.get(row.card_id);
          if (!card) continue;
          const existing = counts.get(row.card_id);
          if (existing) existing.misses += 1;
          else counts.set(row.card_id, {
            card_id: row.card_id,
            name: card.name,
            category_ru: card.category_ru,
            photo_url: card.photo_url,
            misses: 1,
          });
        }
        if (!cancelled) {
          setCards([...counts.values()].sort((a, b) => b.misses - a.misses || a.name.localeCompare(b.name)).slice(0, 5));
        }
      } catch (error) {
        console.error('[profile] hard cards failed:', error);
        if (!cancelled) {
          setFailed(true);
          setCards([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [playerId]);

  return (
    <section className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">
      <div>
        <h2 className="text-white text-sm font-semibold">Самые сложные карточки</h2>
        <p className="text-brand-muted text-[11px] mt-1">Чаще всего пропускались в ваших командных раундах, когда вы угадывали</p>
      </div>
      {loading && <p className="text-brand-muted text-sm">Загружаем статистику…</p>}
      {!loading && failed && <p className="text-red-400/80 text-sm">Не удалось загрузить карточки</p>}
      {!loading && !failed && cards.length === 0 && (
        <p className="text-brand-muted text-sm">Пока нет пропущенных карточек в завершённых командных раундах</p>
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
