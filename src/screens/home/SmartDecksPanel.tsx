import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { IconArrowUpRight, IconBolt, IconCalendarEvent, IconCrown, IconX, IconCheck, IconLoader2 } from '@tabler/icons-react';
import { supabase } from '@/shared/lib/supabase';
import { getRawInitData, openLink } from '@/shared/lib/telegram';
import { PlayerPhoto } from '@/shared/ui/PlayerPhoto';
import type { DeckFilter } from '@/shared/types/deck';
import { ALL_CATEGORIES, type CardCategory } from '@/shared/types/database';
import { buildGoldenEra, matchNewsToPlayers, type CanonicalPlayer, type NewsHeadline, type NewsCardMatch, type GoldenEra } from '@/features/decks/smartDecks';

interface RatingCandidate { card_id: string; name: string; name_en: string | null; photo_url: string | null; matches: number; goals: number; assists: number }
interface SmartDeck {
  id: string; family: 'form' | 'form-news' | 'news' | 'golden-era';
  eyebrow: string; title: string;
  icon: 'bolt' | 'calendar' | 'crown' | 'era'; image: string | null;
  names: string[]; filter: DeckFilter;
  evidence?: Array<{ card_id: string; title: string; url: string; source: string; published_at: string }>;
  era?: { club: string; startYear: number; endYear: number };
  stats?: Array<{ card_id: string; matches: number; goals: number; assists: number }>;
}
interface DeckPlayerRow { id: string; name: string; name_en: string | null; photo_url: string | null; category: string }
interface DeckChatMessage { role: 'user' | 'assistant'; content: string }
interface Props { onStart: (filter: DeckFilter, presetId: string) => void }
const NEWS_WINDOW_HOURS = 72;
const TARGET_DECK_SIZE = 20;
const MIN_PUBLISHABLE_DECK_SIZE = 8;

export function SmartDecksPanel({ onStart }: Props) {
  const { i18n } = useTranslation();
  const ru = i18n.language.startsWith('ru');
  const lang = i18n.language.slice(0, 2);
  const [news, setNews] = useState<NewsHeadline[]>([]);
  const [newsMatches, setNewsMatches] = useState<NewsCardMatch[]>([]);
  const [form, setForm] = useState<RatingCandidate[]>([]);
  const [legends, setLegends] = useState<CanonicalPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [activeDeck, setActiveDeck] = useState<SmartDeck | null>(null);
  const [deckPlayers, setDeckPlayers] = useState<DeckPlayerRow[]>([]);
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([]);
  const [loadingDeckPlayers, setLoadingDeckPlayers] = useState(false);
  const [deckLoadError, setDeckLoadError] = useState(false);
  const [chatMessages, setChatMessages] = useState<DeckChatMessage[]>([]);
  const [deckPrompt, setDeckPrompt] = useState('');
  const [buildingWithAI, setBuildingWithAI] = useState(false);
  const [aiBuildError, setAiBuildError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true); setFailed(false);
      try {
    const since = new Date(Date.now() - NEWS_WINDOW_HOURS * 3600_000).toISOString();
    const [newsRes, formRes, legendRes, playersRes] = await Promise.all([
      supabase.from('news_items').select('title,url,source,published_at,description,summary_short').gte('published_at', since).order('published_at', { ascending: false }).limit(500),
      supabase.rpc('player_ratings', { p_days: 30, p_limit: 40, p_club_key: null, p_league: null, p_country: null }),
      supabase.from('cards').select('id,name,name_en,photo_url,country,position_ru,fame,legend_career').eq('active', true).eq('category', 'player').not('legend_career', 'is', null).order('fame', { ascending: false, nullsFirst: false }).limit(1000),
      supabase.from('cards').select('id,name,name_en,photo_url,country,position_ru,fame').eq('active', true).eq('category', 'player').order('fame', { ascending: false, nullsFirst: false }).limit(1000),
    ]);
    if (cancelled) return;
    const hasError = !!(newsRes.error || formRes.error || legendRes.error || playersRes.error);
    setFailed(hasError);
    const headlines = (newsRes.data ?? []) as NewsHeadline[];
    const formRows = (formRes.data ?? []) as RatingCandidate[];
    const legendRows = (legendRes.data ?? []) as CanonicalPlayer[];
    const playerPool = (playersRes.data ?? []) as CanonicalPlayer[];
    setNews(headlines.slice(0, 4));
    setForm(formRows.filter((p) => p.card_id && p.matches > 0).slice(0, TARGET_DECK_SIZE));
    setLegends(legendRows);
    setNewsMatches(matchNewsToPlayers(headlines, playerPool, TARGET_DECK_SIZE));
      setLoading(false);
      } catch {
        if (cancelled) return;
        setFailed(true);
        setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const decks = useMemo<SmartDeck[]>(() => {
    const result: SmartDeck[] = [];
    const goldenEra: GoldenEra | null = buildGoldenEra(legends, TARGET_DECK_SIZE);
    const formIds = new Set(form.map((p) => p.card_id));
    const formAndNews = newsMatches.filter((p) => formIds.has(p.id));
    if (form.length >= MIN_PUBLISHABLE_DECK_SIZE) result.push({
      id:'smart-current-form', family:'form', eyebrow:ru?'ФОРМА · 30 ДНЕЙ':'FORM · 30 DAYS',
      title:ru?'Сейчас на пике':'In form now',
      icon:'bolt', image:form[0]?.photo_url ?? null, names:form.slice(0,5).map(p=>p.name),
      filter:{ categories:['player'], card_ids:form.map(p=>p.card_id), lang },
      stats:form.map(p=>({ card_id:p.card_id, matches:p.matches, goals:p.goals, assists:p.assists })),
    });
    if (formAndNews.length >= MIN_PUBLISHABLE_DECK_SIZE) result.push({
      id:'smart-form-meets-headlines', family:'form-news', eyebrow:ru?'ФАКТЫ ВСТРЕЧАЮТСЯ С ХАЙПОМ':'FORM MEETS THE HEADLINES',
      title:ru?'Форма и новости':'Form & headlines',
      icon:'bolt', image:formAndNews[0]?.photo_url ?? null, names:formAndNews.slice(0,5).map(p=>p.name),
      filter:{ categories:['player'], card_ids:formAndNews.map(p=>p.id), lang },
      evidence:formAndNews.map(p=>({ card_id:p.id, title:p.matchedHeadline.title, url:p.matchedHeadline.url, source:p.matchedHeadline.source, published_at:p.matchedHeadline.published_at })),
      stats:form.filter(p=>formAndNews.some(m=>m.id===p.card_id)).map(p=>({ card_id:p.card_id, matches:p.matches, goals:p.goals, assists:p.assists })),
    });
    if (newsMatches.length >= MIN_PUBLISHABLE_DECK_SIZE) result.push({
      id:'smart-news-pulse', family:'news', eyebrow:ru?'СВЕЖИЕ НОВОСТИ · 72 ЧАСА':'NEWS PULSE · 72 HOURS',
      title:ru?'В центре новостей':'In the headlines',
      icon:'calendar', image:newsMatches[0]?.photo_url ?? null, names:newsMatches.slice(0,5).map(p=>p.name),
      filter:{ categories:['player'], card_ids:newsMatches.map(p=>p.id), lang },
      evidence:newsMatches.map(p=>({ card_id:p.id, title:p.matchedHeadline.title, url:p.matchedHeadline.url, source:p.matchedHeadline.source, published_at:p.matchedHeadline.published_at })),
    });
    if (goldenEra && goldenEra.players.length >= MIN_PUBLISHABLE_DECK_SIZE) result.push({
      id:'smart-golden-era', family:'golden-era', eyebrow:ru?'ЗОЛОТАЯ ЭПОХА · ПО КАРЬЕРАМ':'GOLDEN ERA · CAREER OVERLAP',
      title:ru?`Золотая эпоха: ${goldenEra.club}`:`Golden era: ${goldenEra.club}`,
      icon:'era', image:goldenEra.players[0]?.photo_url ?? null,
      names:goldenEra.players.slice(0,5).map(p=>p.name),
      filter:{ categories:['player'], card_ids:goldenEra.players.map(p=>p.id), lang },
      era:{ club:goldenEra.club, startYear:goldenEra.startYear, endYear:goldenEra.endYear },
    });
    return result;
  }, [form, legends, newsMatches, lang, ru]);

  const orderedDecks = decks;

  const sendDeckPrompt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = deckPrompt.trim();
    if (!prompt || buildingWithAI || !activeDeck) return;
    setBuildingWithAI(true);
    setAiBuildError('');
    setChatMessages((current) => [...current, { role: 'user', content: prompt }]);
    setDeckPrompt('');
    try {
      const initData = getRawInitData();
      if (!initData) throw new Error('auth');
      const { data, error } = await supabase.functions.invoke('smart-deck-builder', {
        body: {
          prompt,
          language: ru ? 'ru' : 'en',
          init_data: initData,
          current_card_ids: selectedCardIds,
        },
      });
      if (error || !data || data.error) throw new Error(String(data?.error ?? 'request_failed'));
      const result = data as { message?: string; title?: string; cards?: DeckPlayerRow[] };
      const cards = Array.isArray(result.cards) ? result.cards.filter((card) =>
        typeof card.id === 'string' && typeof card.name === 'string' && ALL_CATEGORIES.includes(card.category as CardCategory)
      ) : [];
      if (cards.length < 3) throw new Error('not_enough_cards');
      const ids = [...new Set(cards.map((card) => card.id))];
      const selectedCards = cards.filter((card) => ids.includes(card.id));
      setDeckPlayers(selectedCards);
      setSelectedCardIds(ids);
      const selectedCategories = [...new Set(selectedCards.map((card) => card.category as CardCategory))];
      setActiveDeck((current) => current ? {
        ...current,
        title: result.title || current.title,
        names: selectedCards.slice(0, 5).map((card) => ru || !card.name_en ? card.name : card.name_en),
        filter: { ...current.filter, categories: selectedCategories, card_ids: ids, lang },
      } : current);
      setChatMessages((current) => [...current, {
        role: 'assistant',
        content: result.message || (ru ? `Готово: ${ids.length} карточек добавлено в колоду.` : `Done: ${ids.length} cards added to the deck.`),
      }]);
    } catch (error) {
      const message = error instanceof Error && error.message === 'auth'
        ? (ru ? 'Открой приложение через Telegram и повтори запрос.' : 'Open the app in Telegram and try again.')
        : error instanceof Error && error.message === 'not_enough_cards'
          ? (ru ? 'Не удалось собрать минимум 3 подтверждённые карточки. Уточни запрос.' : 'Could not find at least 3 verified cards. Refine your request.')
          : (ru ? 'ИИ сейчас не смог собрать колоду. Попробуй переформулировать запрос.' : 'The AI could not build this deck. Try rephrasing your request.');
      setAiBuildError(message);
      setChatMessages((current) => [...current, { role: 'assistant', content: message }]);
    } finally {
      setBuildingWithAI(false);
    }
  };


  return <section className="w-full max-w-sm space-y-3" aria-labelledby="smart-decks-title">
    <div>
      <h2 id="smart-decks-title" className="ds-display text-xl font-extrabold text-white">{ru?'Умные колоды':'Smart decks'}</h2>
    </div>
    {loading && <div className="rounded-2xl border border-brand-border bg-brand-surface p-4 text-sm text-brand-muted">{ru?'Собираем подборки из свежих данных…':'Building decks from fresh data…'}</div>}
    {!loading && failed && decks.length===0 && <div className="rounded-2xl border border-brand-border bg-brand-surface p-4 text-sm text-brand-muted">{ru?'Не удалось проверить все источники. Попробуй позже.':'Could not verify sources. Try again later.'}</div>}
    {!loading && !failed && decks.length===0 && <div className="rounded-2xl border border-brand-border bg-brand-surface p-4 text-sm text-brand-muted">{ru?'Пока недостаточно подтверждённых данных для тематической колоды.':'Not enough verified data for a themed deck yet.'}</div>}
    {orderedDecks.map(deck => {
      const Icon = deck.icon==='bolt'?IconBolt:deck.icon==='calendar'||deck.icon==='era'?IconCalendarEvent:IconCrown;
      return <article key={deck.id} className="relative overflow-hidden rounded-2xl border border-brand-border bg-brand-surface">
        <div className="absolute inset-0 opacity-20 pointer-events-none">{deck.image && <img src={deck.image} alt="" className="w-full h-full object-cover blur-sm scale-110"/>}<div className="absolute inset-0 bg-gradient-to-r from-brand-bg via-brand-bg/85 to-transparent"/></div>
        <div className="relative p-4 space-y-3">
          <div className="flex items-center gap-2 text-brand-accent"><Icon size={14}/><span className="text-[9px] font-bold tracking-[0.13em] uppercase">{deck.eyebrow}</span></div>
          <h3 className="ds-display text-lg font-extrabold text-white">{deck.title}</h3>
          <div className="flex flex-wrap gap-1.5">{deck.names.map(name=><span key={name} className="rounded-full bg-brand-bg/80 border border-brand-border px-2 py-1 text-[10px] text-white/90">{name}</span>)}<span className="rounded-full bg-brand-bg/80 border border-brand-border px-2 py-1 text-[10px] text-brand-muted">{deck.filter.card_ids?.length ?? 0} {ru?'карточек':'cards'}</span></div>
          <button type="button" onClick={() => {
            setActiveDeck(deck);
            setDeckPlayers([]);
            setSelectedCardIds([...(deck.filter.card_ids ?? [])]);
            setDeckLoadError(false);
            setChatMessages([]);
            setDeckPrompt('');
            setAiBuildError('');
            setBuildingWithAI(false);
            setLoadingDeckPlayers(true);
            void Promise.resolve(supabase.from('cards').select('id,name,name_en,photo_url,category')
              .in('id', deck.filter.card_ids ?? []))
              .then(({ data, error }) => {
                if (error || !data) { setDeckLoadError(true); setDeckPlayers([]); }
                else {
                  const rows = data as DeckPlayerRow[];
                  const byId = new Map(rows.map((row) => [row.id, row]));
                  setDeckPlayers((deck.filter.card_ids ?? []).flatMap((id) => {
                    const row = byId.get(id);
                    return row ? [row] : [];
                  }));
                }
              })
              .catch(() => setDeckLoadError(true))
              .finally(() => setLoadingDeckPlayers(false));
          }} className="w-full flex items-center justify-between rounded-xl bg-brand-accent text-brand-bg font-bold text-sm px-4 py-3 active:scale-[0.99] transition-transform"><span>{ru?'Собрать колоду':'Build deck'}</span><IconArrowUpRight size={18}/></button>
        </div>
      </article>;
    })}
    {activeDeck && <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/75 backdrop-blur-sm p-0 sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setActiveDeck(null); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="smart-deck-builder-title" className="w-full max-w-lg max-h-[92dvh] overflow-hidden rounded-t-3xl sm:rounded-3xl border border-brand-border bg-brand-bg shadow-2xl flex flex-col">
        <header className="flex items-start gap-3 p-4 border-b border-brand-border">
          <div className="min-w-0 flex-1">
            <p className="text-[9px] uppercase tracking-[0.16em] font-bold text-brand-accent">{ru?'КОНСТРУКТОР КОЛОДЫ':'DECK BUILDER'}</p>
            <h2 id="smart-deck-builder-title" className="ds-display text-xl font-extrabold text-white">{activeDeck.title}</h2>
          </div>
          <button type="button" aria-label={ru?'Закрыть':'Close'} onClick={() => setActiveDeck(null)} className="shrink-0 w-9 h-9 rounded-xl border border-brand-border text-brand-muted flex items-center justify-center"><IconX size={18}/></button>
        </header>
        <div className="px-4 pt-3 space-y-2">
          <div className="max-h-36 overflow-y-auto space-y-2" aria-live="polite">
            {chatMessages.map((message, index) => <div key={index} className={`max-w-[92%] rounded-2xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${message.role === 'user' ? 'ml-auto bg-brand-accent text-brand-bg' : 'mr-auto bg-brand-surface border border-brand-border text-white'}`}>{message.content}</div>)}
          </div>
          <form onSubmit={sendDeckPrompt} className="flex items-end gap-2">
            <textarea
              aria-label={ru ? 'Запрос для ИИ' : 'AI deck request'}
              value={deckPrompt}
              onChange={(event) => setDeckPrompt(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }}
              rows={2}
              maxLength={1000}
              placeholder={ru ? 'Какую колоду собрать?' : 'What deck should I build?'}
              className="min-w-0 flex-1 resize-none rounded-xl border border-brand-border bg-brand-surface px-3 py-2.5 text-sm text-white placeholder:text-brand-muted focus:outline-none focus:border-brand-accent"
            />
            <button type="submit" aria-label={ru ? 'Собрать с ИИ' : 'Build with AI'} disabled={!deckPrompt.trim() || buildingWithAI} className="h-10 shrink-0 rounded-xl bg-brand-accent px-3 text-sm font-bold text-brand-bg disabled:opacity-40">
              {buildingWithAI ? <IconLoader2 size={18} className="animate-spin"/> : <IconArrowUpRight size={18}/>}
            </button>
          </form>
          {aiBuildError && <p role="alert" className="text-[11px] text-red-300">{aiBuildError}</p>}
        </div>
        <div className="px-4 py-3 border-b border-brand-border flex items-center justify-between gap-3">
          <p className="text-sm font-bold text-white">{ru?'Карточки':'Cards'}</p>
          <div className="text-right shrink-0"><p className="text-lg font-extrabold text-brand-accent tabular-nums">{selectedCardIds.length}</p><p className="text-[9px] text-brand-muted">{ru?'в колоде':'in deck'}</p></div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {loadingDeckPlayers && <div className="flex items-center justify-center gap-2 py-8 text-sm text-brand-muted"><IconLoader2 size={18} className="animate-spin"/>{ru?'Загружаем карточки…':'Loading player cards…'}</div>}
          {!loadingDeckPlayers && deckLoadError && <div className="rounded-xl border border-red-400/30 p-3 text-sm text-red-200">{ru?'Не удалось загрузить карточки. Закрой окно и попробуй ещё раз.':'Could not load cards. Close this window and try again.'}</div>}
          {!loadingDeckPlayers && !deckLoadError && deckPlayers.map((player) => {
            const checked = selectedCardIds.includes(player.id);
            const playerName = lang === 'ru' || !player.name_en ? player.name : player.name_en;
            return <label key={player.id} className={`flex items-center gap-3 rounded-xl border p-2.5 cursor-pointer transition-colors ${checked ? 'border-brand-accent/60 bg-brand-accent/10' : 'border-brand-border bg-brand-surface'}`}>
              <input type="checkbox" checked={checked} onChange={() => setSelectedCardIds((current) => checked ? current.filter((id) => id !== player.id) : [...current, player.id])} className="accent-brand-accent w-4 h-4 shrink-0"/>
              {player.photo_url ? <PlayerPhoto src={player.photo_url} alt="" className="w-10 h-10 rounded-lg object-cover bg-brand-border shrink-0"/> : <div className="w-10 h-10 rounded-lg bg-brand-border shrink-0 flex items-center justify-center text-xs text-brand-muted">{playerName.slice(0,1)}</div>}
              <span className="flex-1 min-w-0 text-sm font-semibold text-white truncate">{playerName}</span>
              {checked && <IconCheck size={16} className="text-brand-accent shrink-0"/>}
            </label>;
          })}
          {!loadingDeckPlayers && !deckLoadError && deckPlayers.length === 0 && <p className="py-6 text-sm text-brand-muted text-center">{ru?'В этой подборке нет доступных карточек.':'No available cards in this deck.'}</p>}
        </div>
        <footer className="p-4 border-t border-brand-border bg-brand-surface/80 space-y-2">
          <button type="button" disabled={loadingDeckPlayers || deckLoadError || selectedCardIds.length === 0} onClick={() => {
            const filter = { ...activeDeck.filter, card_ids: selectedCardIds };
            const presetId = activeDeck.id;
            setActiveDeck(null);
            onStart(filter, presetId);
          }} className="w-full flex items-center justify-center gap-2 rounded-xl bg-brand-accent text-brand-bg font-extrabold text-sm px-4 py-3 disabled:opacity-40 disabled:cursor-not-allowed">
            {ru?'Собрать колоду и играть':'Build deck & play'}<IconArrowUpRight size={18}/>
          </button>
          <button type="button" onClick={() => setSelectedCardIds(deckPlayers.map((player) => player.id))} disabled={loadingDeckPlayers || deckPlayers.length === 0} className="w-full rounded-xl border border-brand-border text-brand-muted text-xs font-semibold px-4 py-2.5 disabled:opacity-40">{ru?'Выбрать всех игроков':'Select all players'}</button>
        </footer>
      </section>
    </div>}
    {news.length>0 && <div className="rounded-2xl border border-brand-border bg-brand-surface p-3 space-y-2">
      <div className="flex items-center gap-2 text-brand-muted"><IconCalendarEvent size={14}/><span className="text-[10px] uppercase tracking-wider font-bold">{ru?'В центре внимания':'In the headlines'}</span></div>
      {news.slice(0,3).map(item=><button key={item.url} type="button" onClick={()=>openLink(item.url)} className="w-full flex items-start gap-2 text-left"><span className="flex-1 text-[11px] leading-snug text-white/90">{item.title}</span><span className="shrink-0 text-[9px] text-brand-muted">{item.source}<IconArrowUpRight size={10} className="inline ml-1"/></span></button>)}
    </div>}
  </section>;
}
