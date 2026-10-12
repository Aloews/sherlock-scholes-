import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconCards, IconCheck, IconX, IconLoader2, IconSend } from '@tabler/icons-react';
import { supabase } from '@/shared/lib/supabase';
import { getRawInitData, hapticError, hapticImpact, hapticSuccess } from '@/shared/lib/telegram';
import { cardDisplayName } from '@/shared/lib/cardName';
import { useDesign } from '@/shared/design/useDesign';
import { tierCardStyle } from '@/shared/lib/tier';
import { PlayerPhoto } from '@/shared/ui/PlayerPhoto';
import { TIER_COLOR, TIER_LABEL_EN, TIER_LABEL_RU, type CardCategory, type Tier } from '@/shared/types/database';

interface OwnedCard {
  collectible_id: string;
  card_id: string;
  name: string;
  name_en: string | null;
  category: CardCategory;
  category_ru: string | null;
  photo_url: string | null;
  tier: Tier | null;
}

interface FriendCard {
  card_id: string;
  name: string;
  name_en: string | null;
  category: CardCategory;
  category_ru: string | null;
  photo_url: string | null;
  tier: Tier | null;
}

interface TradeFriend {
  player_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
}

interface TradeRow {
  trade_id: string;
  direction: 'incoming' | 'outgoing';
  other_player_id: number;
  other_player_name: string;
  offered_card_id: string;
  offered_card_name: string;
  offered_card_name_en: string | null;
  offered_photo_url: string | null;
  offered_tier: Tier | null;
  requested_card_id: string;
  requested_card_name: string;
  requested_card_name_en: string | null;
  requested_photo_url: string | null;
  requested_tier: Tier | null;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
  created_at: string;
  expires_at: string;
}

export function CollectibleTradingPanel({ playerId }: { playerId: number | null }) {
  const { t, i18n } = useTranslation();
  const design = useDesign();
  const [friends, setFriends] = useState<TradeFriend[]>([]);
  const [owned, setOwned] = useState<OwnedCard[]>([]);
  const [friendCards, setFriendCards] = useState<FriendCard[]>([]);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [friendId, setFriendId] = useState('');
  const [offeredId, setOfferedId] = useState('');
  const [requestedId, setRequestedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [notice, setNotice] = useState('');

  const isRu = i18n.language.startsWith('ru');

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    const initData = getRawInitData();
    if (playerId == null || !initData) {
      setFriends([]);
      setOwned([]);
      setTrades([]);
      setLoading(false);
      setFailed(playerId != null);
      return;
    }
    try {
      const [friendsResult, ownedResult, tradesResult] = await Promise.all([
        supabase.rpc('friends_with_rating', { p_player_id: playerId }),
        supabase.rpc('my_card_tradeable_collectibles' as never, { p_init_data: initData } as never),
        supabase.rpc('my_player_card_trades' as never, { p_init_data: initData } as never),
      ]);
      if (friendsResult.error || ownedResult.error || tradesResult.error) throw new Error('trade_load_failed');
      setFriends((friendsResult.data ?? []) as unknown as TradeFriend[]);
      setOwned((ownedResult.data ?? []) as unknown as OwnedCard[]);
      setTrades((tradesResult.data ?? []) as unknown as TradeRow[]);
    } catch {
      setFailed(true);
      setFriends([]);
      setOwned([]);
      setTrades([]);
    } finally {
      setLoading(false);
    }
  }, [playerId]);

  useEffect(() => { void load(); }, [load]);

  const chooseFriend = async (nextId: string) => {
    setFriendId(nextId);
    setFriendCards([]);
    setRequestedId('');
    setNotice('');
    if (!nextId) return;
    const initData = getRawInitData();
    if (!initData) { setFailed(true); return; }
    const { data, error } = await supabase.rpc('friend_collectible_inventory' as never, {
      p_init_data: initData,
      p_friend_id: Number(nextId),
    } as never);
    if (error) {
      setNotice(t('profile.trade_error'));
      setFriendCards([]);
      return;
    }
    setFriendCards((data ?? []) as unknown as FriendCard[]);
  };

  const propose = async () => {
    const initData = getRawInitData();
    if (!initData || !friendId || !offeredId || !requestedId) return;
    setWorking(true);
    setNotice('');
    try {
      const { error } = await supabase.rpc('create_player_card_trade' as never, {
        p_init_data: initData,
        p_to_player_id: Number(friendId),
        p_offered_collectible_id: offeredId,
        p_requested_card_id: requestedId,
      } as never);
      if (error) throw error;
      hapticSuccess();
      setNotice(t('profile.trade_proposed'));
      setFriendId('');
      setFriendCards([]);
      setOfferedId('');
      setRequestedId('');
      await load();
    } catch {
      hapticError();
      setNotice(t('profile.trade_error'));
    } finally {
      setWorking(false);
    }
  };

  const respond = async (trade: TradeRow, accept: boolean) => {
    const initData = getRawInitData();
    if (!initData) return;
    setWorking(true);
    setNotice('');
    try {
      const { data, error } = await supabase.rpc('respond_player_card_trade' as never, {
        p_init_data: initData,
        p_trade_id: trade.trade_id,
        p_accept: accept,
      } as never);
      if (error || data !== true) throw error ?? new Error('trade_response_failed');
      if (accept) hapticSuccess(); else hapticImpact('light');
      setNotice(accept ? t('profile.trade_accepted_notice') : t('profile.trade_declined_notice'));
      await load();
    } catch {
      hapticError();
      setNotice(t('profile.trade_error'));
    } finally {
      setWorking(false);
    }
  };

  const cancel = async (trade: TradeRow) => {
    const initData = getRawInitData();
    if (!initData) return;
    setWorking(true);
    setNotice('');
    try {
      const { error } = await supabase.rpc('cancel_player_card_trade' as never, {
        p_init_data: initData,
        p_trade_id: trade.trade_id,
      } as never);
      if (error) throw error;
      hapticImpact('light');
      setNotice(t('profile.trade_cancelled_notice'));
      await load();
    } catch {
      hapticError();
      setNotice(t('profile.trade_error'));
    } finally {
      setWorking(false);
    }
  };

  const nameOf = (card: { name: string; name_en: string | null; category: CardCategory; category_ru: string | null }) =>
    cardDisplayName(card, i18n.language);

  return (
    <section className="ds-panel rounded-2xl border border-brand-border bg-brand-surface p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-brand-accent"><IconCards size={19} stroke={1.8} /></span>
        <div className="flex-1 min-w-0">
          <h2 className="ds-display text-base font-bold text-white">{t('profile.trades_title')}</h2>
          <p className="text-[11px] text-brand-muted mt-0.5">{t('profile.trades_hint')}</p>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-brand-muted">{t('app.loading')}</p>
      ) : failed ? (
        <p role="status" className="text-xs text-brand-muted">{t('profile.trade_load_error')}</p>
      ) : (
        <>
          <div className="space-y-2 rounded-xl border border-brand-border p-3">
            <label className="block text-xs text-brand-muted">
              {t('profile.trade_friend')}
              <select value={friendId} onChange={(e) => void chooseFriend(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-brand-border bg-brand-bg px-3 py-2.5 text-sm text-white">
                <option value="">{t('profile.trade_friend_placeholder')}</option>
                {friends.map((friend) => (
                  <option key={friend.player_id} value={friend.player_id}>
                    {`${friend.first_name} ${friend.last_name ?? ''}`.trim()}
                  </option>
                ))}
              </select>
            </label>
            {friends.length === 0 && <p className="text-[11px] text-brand-muted">{t('profile.trade_no_friends')}</p>}
            <label className="block text-xs text-brand-muted">
              {t('profile.trade_offer')}
              <select value={offeredId} onChange={(e) => setOfferedId(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-brand-border bg-brand-bg px-3 py-2.5 text-sm text-white">
                <option value="">{t('profile.trade_card_placeholder')}</option>
                {owned.map((card) => <option key={card.collectible_id} value={card.collectible_id}>{nameOf(card)}</option>)}
              </select>
            </label>
            <label className="block text-xs text-brand-muted">
              {t('profile.trade_request')}
              <select value={requestedId} onChange={(e) => setRequestedId(e.target.value)}
                disabled={!friendId || friendCards.length === 0}
                className="mt-1.5 w-full rounded-lg border border-brand-border bg-brand-bg px-3 py-2.5 text-sm text-white disabled:opacity-50">
                <option value="">{t('profile.trade_card_placeholder')}</option>
                {friendCards.map((card) => <option key={card.card_id} value={card.card_id}>{nameOf(card)}</option>)}
              </select>
            </label>
            {friendId && friendCards.length === 0 && <p className="text-[11px] text-brand-muted">{t('profile.trade_friend_empty')}</p>}
            {owned.length === 0 && <p className="text-[11px] text-brand-muted">{t('profile.trade_own_empty')}</p>}
            <button type="button" disabled={working || !friendId || !offeredId || !requestedId || owned.find(c => c.collectible_id === offeredId)?.card_id === requestedId}
              onClick={() => void propose()}
              className="w-full rounded-xl bg-brand-accent px-3 py-2.5 text-sm font-bold text-brand-bg disabled:opacity-40">
              {working ? <IconLoader2 className="inline animate-spin mr-1" size={16} /> : <IconSend className="inline mr-1" size={16} />}
              {t('profile.trade_propose')}
            </button>
          </div>

          {notice && <p role="status" className="text-xs text-brand-muted">{notice}</p>}

          <div className="space-y-2">
            <p className="text-xs font-semibold text-white">{t('profile.trade_offers_title')}</p>
            {trades.length === 0 ? (
              <p className="text-xs text-brand-muted">{t('profile.trade_no_offers')}</p>
            ) : trades.map((trade) => (
              <div key={trade.trade_id} className="rounded-xl border border-brand-border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-white">
                    {trade.direction === 'incoming' ? t('profile.trade_incoming') : t('profile.trade_outgoing')} · {trade.other_player_name}
                  </p>
                  <span className="text-[10px] text-brand-muted">{t(`profile.trade_status_${trade.status}`)}</span>
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <TradeCard name={isRu || !trade.offered_card_name_en ? trade.offered_card_name : trade.offered_card_name_en} photo={trade.offered_photo_url} tier={trade.offered_tier} design={design} />
                  <span className="text-brand-accent">↔</span>
                  <TradeCard name={isRu || !trade.requested_card_name_en ? trade.requested_card_name : trade.requested_card_name_en} photo={trade.requested_photo_url} tier={trade.requested_tier} design={design} />
                </div>
                {trade.status === 'pending' && trade.direction === 'incoming' && (
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" disabled={working} onClick={() => void respond(trade, true)}
                      className="rounded-lg bg-brand-accent/15 px-2 py-2 text-xs font-semibold text-brand-accent disabled:opacity-40">
                      <IconCheck className="inline mr-1" size={14} />{t('profile.trade_accept')}
                    </button>
                    <button type="button" disabled={working} onClick={() => void respond(trade, false)}
                      className="rounded-lg border border-brand-border px-2 py-2 text-xs font-semibold text-white disabled:opacity-40">
                      <IconX className="inline mr-1" size={14} />{t('profile.trade_decline')}
                    </button>
                  </div>
                )}
                {trade.status === 'pending' && trade.direction === 'outgoing' && (
                  <button type="button" disabled={working} onClick={() => void cancel(trade)}
                    className="rounded-lg border border-brand-border px-2 py-2 text-xs font-semibold text-white disabled:opacity-40">
                    {t('profile.trade_cancel')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function TradeCard({ name, photo, tier, design }: {
  name: string;
  photo: string | null;
  tier: Tier | null;
  design: ReturnType<typeof useDesign>;
}) {
  const { t, i18n } = useTranslation();
  const labels = i18n.language.startsWith('ru') ? TIER_LABEL_RU : TIER_LABEL_EN;
  return (
    <div className="relative min-h-[88px] overflow-hidden rounded-lg border border-brand-border bg-brand-bg flex flex-col justify-end"
      style={tierCardStyle(tier, design)}>
      {photo && <PlayerPhoto src={photo} category="player" shape="free" aria-hidden className="absolute inset-0 h-full w-full" />}
      <div className="absolute inset-x-0 bottom-0 h-3/4 pointer-events-none"
        style={{ background: 'linear-gradient(to top, rgba(8,10,18,0.97), rgba(8,10,18,0.45), transparent)' }} />
      <div className="relative p-1.5">
        <p className="text-[10px] font-bold leading-tight text-white line-clamp-2">{name}</p>
        <p className="mt-0.5 text-[8px] font-semibold uppercase" style={{ color: tier ? TIER_COLOR[tier] : '#AAB2C0' }}>
          {tier ? labels[tier] : t('profile.collectibles_owned')}
        </p>
      </div>
    </div>
  );
}
