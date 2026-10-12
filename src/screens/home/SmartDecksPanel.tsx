import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconArrowUpRight, IconBolt, IconCalendarEvent, IconCrown } from '@tabler/icons-react';
import { supabase } from '@/shared/lib/supabase';
import { openLink } from '@/shared/lib/telegram';
import type { DeckFilter } from '@/shared/types/deck';
import { buildGoldenEra, buildStatisticalComparisons, matchNewsToPlayers, type CanonicalPlayer, type NewsHeadline, type NewsCardMatch, type GoldenEra } from '@/features/decks/smartDecks';

interface RatingCandidate { card_id: string; name: string; name_en: string | null; photo_url: string | null; matches: number; goals: number; assists: number }
interface SmartDeck {
  id: string; family: 'form' | 'form-news' | 'news' | 'golden-era' | 'comparison';
  eyebrow: string; title: string; description: string;
  icon: 'bolt' | 'calendar' | 'crown' | 'era'; image: string | null;
  names: string[]; filter: DeckFilter;
  evidence?: Array<{ card_id: string; title: string; url: string; source: string; published_at: string }>;
  era?: { club: string; startYear: number; endYear: number };
  stats?: Array<{ card_id: string; matches: number; goals: number; assists: number }>;
  groupBy?: 'league' | 'birth-country';
  groupKey?: string;
  careerTotals?: Array<{ card_id: string; appearances: number; goals: number; assists: number | null }>;
  careerRows?: Array<{ card_id: string; name: string; appearances: number; goals: number; assists: number | null }>;
}
interface SmartDeckEditorial { id: string; title: string; hook: string; why: string; rank: number }
interface Props { onStart: (filter: DeckFilter, presetId: string) => void }
const NEWS_WINDOW_HOURS = 72;

export function SmartDecksPanel({ onStart }: Props) {
  const { i18n } = useTranslation();
  const ru = i18n.language.startsWith('ru');
  const lang = i18n.language.slice(0, 2);
  const [news, setNews] = useState<NewsHeadline[]>([]);
  const [newsMatches, setNewsMatches] = useState<NewsCardMatch[]>([]);
  const [form, setForm] = useState<RatingCandidate[]>([]);
  const [legends, setLegends] = useState<CanonicalPlayer[]>([]);
  const [players, setPlayers] = useState<CanonicalPlayer[]>([]);
  const [requested, setRequested] = useState(false);
  const [generation, setGeneration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editorials, setEditorials] = useState<Record<string, SmartDeckEditorial>>({});
  const [editorialMode, setEditorialMode] = useState<'loading' | 'ai' | 'deterministic'>('deterministic');

  useEffect(() => {
    if (!requested) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true); setFailed(false);
      try {
    const since = new Date(Date.now() - NEWS_WINDOW_HOURS * 3600_000).toISOString();
    const [newsRes, formRes, legendRes, playersRes] = await Promise.all([
      supabase.from('news_items').select('title,url,source,published_at').gte('published_at', since).order('published_at', { ascending: false }).limit(100),
      supabase.rpc('player_ratings', { p_days: 30, p_limit: 200, p_club_key: null, p_league: null, p_country: null }),
      supabase.from('cards').select('id,name,name_en,photo_url,country,position_ru,fame,top_league,career_stats,facts,tags,legend_career').eq('active', true).eq('category', 'player').contains('tags', ['legend']).order('fame', { ascending: false, nullsFirst: false }).limit(200),
      supabase.from('cards').select('id,name,name_en,photo_url,country,position_ru,fame,top_league,career_stats,facts,tags').eq('active', true).eq('category', 'player').order('fame', { ascending: false, nullsFirst: false }).limit(1000),
    ]);
    if (cancelled) return;
    const hasError = !!(newsRes.error || formRes.error || legendRes.error || playersRes.error);
    setFailed(hasError);
    const headlines = (newsRes.data ?? []) as NewsHeadline[];
    const formRows = (formRes.data ?? []) as RatingCandidate[];
    const legendRows = (legendRes.data ?? []) as CanonicalPlayer[];
    const playerPool = (playersRes.data ?? []) as CanonicalPlayer[];
    setNews(headlines.slice(0, 4));
    setForm(formRows.filter((p) => p.card_id && p.matches > 0));
    setLegends(legendRows);
    setPlayers([...new Map([...playerPool, ...legendRows].map((player) => [player.id, player])).values()]);
    setNewsMatches(matchNewsToPlayers(headlines, playerPool, 16));
      setLoading(false);
      } catch {
        if (cancelled) return;
        setFailed(true);
        setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [requested, generation]);

  const decks = useMemo<SmartDeck[]>(() => {
    const result: SmartDeck[] = [];
    const goldenEra: GoldenEra | null = buildGoldenEra(legends, 16);
    const formIds = new Set(form.map((p) => p.card_id));
    const comparisons = buildStatisticalComparisons(players, formIds, 12);
    const formAndNews = newsMatches.filter((p) => formIds.has(p.id));
    const newsSourceCount = new Set(newsMatches.map((p) => p.matchedHeadline.source).filter(Boolean)).size;
    if (form.length >= 3) result.push({
      id:'smart-current-form', family:'form', eyebrow:ru?'ФОРМА · 30 ДНЕЙ':'FORM · 30 DAYS',
      title:ru?'Сейчас на пике':'In form now',
      description:ru?'Не просто громкие имена: эти футболисты набрали реальные матчи и результативные действия в собранной статистике за 30 дней. Проверь, кого ты узнаешь без подсказки.':'Not just famous names: these players recorded actual appearances and contributions in the collected 30-day match data. See who you can recognize without a hint.',
      icon:'bolt', image:form[0]?.photo_url ?? null, names:form.slice(0,3).map(p=>p.name),
      filter:{ categories:['player'], card_ids:form.slice(0,12).map(p=>p.card_id), lang },
      stats:form.slice(0,12).map(p=>({ card_id:p.card_id, matches:p.matches, goals:p.goals, assists:p.assists })),
    });
    if (formAndNews.length >= 3) result.push({
      id:'smart-form-meets-headlines', family:'form-news', eyebrow:ru?'ФАКТЫ ВСТРЕЧАЮТСЯ С ХАЙПОМ':'FORM MEETS THE HEADLINES',
      title:ru?'Шум вокруг них не на пустом месте':'The headlines have a match-day reason',
      description:ru?'Эти игроки одновременно попали в свежие заголовки и в собранную матчевую статистику за последние 30 дней. Здесь новостной интерес пересекается с тем, что действительно происходило на поле.':'These players appear in recent headlines and in the collected match stats from the last 30 days. This deck connects the news cycle to what actually happened on the pitch.',
      icon:'bolt', image:formAndNews[0]?.photo_url ?? null, names:formAndNews.slice(0,3).map(p=>p.name),
      filter:{ categories:['player'], card_ids:formAndNews.map(p=>p.id), lang },
      evidence:formAndNews.map(p=>({ card_id:p.id, title:p.matchedHeadline.title, url:p.matchedHeadline.url, source:p.matchedHeadline.source, published_at:p.matchedHeadline.published_at })),
      stats:form.filter(p=>formAndNews.some(m=>m.id===p.card_id)).map(p=>({ card_id:p.card_id, matches:p.matches, goals:p.goals, assists:p.assists })),
    });
    if (newsMatches.length >= 3) result.push({
      id:'smart-news-pulse', family:'news', eyebrow:ru?'СВЕЖИЕ НОВОСТИ · 72 ЧАСА':'NEWS PULSE · 72 HOURS',
      title:ru?'Кто сейчас в центре футбольного сюжета':'Names behind the latest headlines',
      description:ru?`Эти футболисты найдены в свежих публикациях за 72 часа${newsSourceCount ? ` из ${newsSourceCount} источников` : ''}. Мы связываем заголовки только с полными именами из колоды — попробуй вспомнить контекст раньше, чем откроешь ответ.`:`These players appear in recent coverage from the last 72 hours${newsSourceCount ? ` across ${newsSourceCount} sources` : ''}. Headlines are linked only to full canonical names in the deck — see if you remember the story before revealing the answer.`,
      icon:'calendar', image:newsMatches[0]?.photo_url ?? null, names:newsMatches.slice(0,3).map(p=>p.name),
      filter:{ categories:['player'], card_ids:newsMatches.map(p=>p.id), lang },
      evidence:newsMatches.map(p=>({ card_id:p.id, title:p.matchedHeadline.title, url:p.matchedHeadline.url, source:p.matchedHeadline.source, published_at:p.matchedHeadline.published_at })),
    });
    for (const comparison of comparisons) {
      const isBirthCountry = comparison.groupBy === 'birth-country';
      result.push({
        id: comparison.id, family: 'comparison',
        eyebrow: isBirthCountry ? (ru ? 'СРАВНЕНИЕ ЭПОХ · СТРАНА РОЖДЕНИЯ' : 'CROSS-ERA · BIRTH COUNTRY') : (ru ? 'СРАВНЕНИЕ ЭПОХ · ЛИГА' : 'CROSS-ERA · LEAGUE'),
        title: isBirthCountry
          ? (ru ? `Рождены в одной стране: ${comparison.groupKey}` : `Born in the same country: ${comparison.groupKey}`)
          : (ru ? `Лига и поколения: ${comparison.groupKey}` : `League across eras: ${comparison.groupKey}`),
        description: isBirthCountry
          ? (ru ? 'Игроки разных поколений, объединённые подтверждённой страной рождения. Сравни их суммарные карьерные матчи и голы.' : 'Players from different eras connected by a sourced country of birth. Compare their career appearances and goals.')
          : (ru ? 'Игроки связаны с этой лигой по данным карточек. Сравни суммарные карьерные матчи и голы за всю карьеру — показатели не ограничиваются матчами только в этой лиге.' : 'These players are associated with this league in the card data. Compare career-wide appearances and goals; totals are not restricted to this league.'),
        icon: 'era', image: comparison.players[0]?.photo_url ?? null,
        names: comparison.players.slice(0, 3).map((p) => p.name),
        filter: { categories: ['player'], card_ids: comparison.players.map((p) => p.id), lang },
        groupBy: comparison.groupBy, groupKey: comparison.groupKey,
        careerTotals: comparison.careerTotals,
        careerRows: comparison.players.map((player, index) => ({
          card_id: player.id, name: player.name,
          appearances: comparison.careerTotals[index].appearances,
          goals: comparison.careerTotals[index].goals,
          assists: comparison.careerTotals[index].assists,
        })),
      });
    }
    if (goldenEra && goldenEra.players.length >= 3) result.push({
      id:'smart-golden-era', family:'golden-era', eyebrow:ru?'ЗОЛОТАЯ ЭПОХА · ПО КАРЬЕРАМ':'GOLDEN ERA · CAREER OVERLAP',
      title:ru?`Великая эпоха: ${goldenEra.club}`:`Golden era: ${goldenEra.club}`,
      description:ru?`Не просто подборка легенд: их карьеры пересеклись в ${goldenEra.club} в ${goldenEra.startYear}–${goldenEra.endYear}. Попробуй собрать эту команду по памяти.`:`More than a list of legends: their careers overlapped at ${goldenEra.club} in ${goldenEra.startYear}–${goldenEra.endYear}. Try to rebuild that team from memory.`,
      icon:'era', image:goldenEra.players[0]?.photo_url ?? null,
      names:goldenEra.players.slice(0,3).map(p=>p.name),
      filter:{ categories:['player'], card_ids:goldenEra.players.map(p=>p.id), lang },
      era:{ club:goldenEra.club, startYear:goldenEra.startYear, endYear:goldenEra.endYear },
    });
    return result;
  }, [form, legends, newsMatches, players, lang, ru]);

  useEffect(() => {
    let cancelled = false;
    if (!decks.length) { setEditorials({}); setEditorialMode('deterministic'); return; }
    setEditorialMode('loading');
    const candidates = decks.map((deck) => ({
      id: deck.id,
      family: deck.family,
      title: deck.title,
      description: deck.description,
      card_ids: deck.filter.card_ids ?? [],
      names: deck.names,
      evidence: deck.evidence ?? [],
      era: deck.era,
      stats: deck.stats ?? [],
      groupBy: deck.groupBy,
      groupKey: deck.groupKey,
      careerTotals: deck.careerTotals,
    }));
    void supabase.functions.invoke('smart-deck-editorial', {
      body: { language: ru ? 'ru' : 'en', candidates },
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data || typeof data !== 'object') {
        setEditorials({});
        setEditorialMode('deterministic');
        return;
      }
      const next: Record<string, SmartDeckEditorial> = {};
      for (const row of (data.editorials ?? []) as SmartDeckEditorial[]) {
        if (decks.some((deck) => deck.id === row.id) && row.title && row.hook) next[row.id] = row;
      }
      setEditorials(next);
      setEditorialMode(data.mode === 'ai' || data.mode === 'cached-ai' ? 'ai' : 'deterministic');
    }).catch(() => {
      if (cancelled) return;
      setEditorials({});
      setEditorialMode('deterministic');
    });
    return () => { cancelled = true; };
  }, [decks, ru]);

  const orderedDecks = useMemo(() => [...decks].sort((a, b) =>
    (editorials[a.id]?.rank ?? 100) - (editorials[b.id]?.rank ?? 100),
  ), [decks, editorials]);

  const requestDecks = () => {
    if (requested) setGeneration((value) => value + 1);
    else setRequested(true);
  };

  return <section className="w-full max-w-sm space-y-3" aria-labelledby="smart-decks-title">
    <div>
      <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-brand-accent mb-1">{ru?'ПОД ТВОЙ ФУТБОЛЬНЫЙ МОМЕНТ':'YOUR FOOTBALL MOMENT'}</p>
      <h2 id="smart-decks-title" className="ds-display text-xl font-extrabold text-white">{ru?'Подборки с футбольным сюжетом':'A deck with a story'}</h2>
      <p className="text-[11px] text-brand-muted mt-1">{ru?'Новости, форма, статистика карьеры и связи между поколениями. Источники проверяются перед сборкой.':'News, form, career stats and connections across eras. Sources are checked before a deck is built.'}</p>
    </div>
    <button type="button" disabled={loading || editorialMode === 'loading'} onClick={requestDecks} className="w-full flex items-center justify-between rounded-xl bg-brand-accent text-brand-bg font-bold text-sm px-4 py-3 disabled:opacity-60">
      <span>{loading || editorialMode === 'loading' ? (ru ? 'Собираем подборку…' : 'Building your deck…') : (requested ? (ru ? 'Обновить подборку от ИИ' : 'Refresh AI picks') : (ru ? 'Собрать подборку от ИИ' : 'Generate AI picks'))}</span>
      <IconBolt size={18}/>
    </button>
    {!requested && <p className="text-[10px] text-brand-muted">{ru?'Нажми, когда захочешь новую подборку. До нажатия данные и ИИ не запрашиваются.':'Tap when you want a fresh selection. No source or AI requests run before you ask.'}</p>}
    {requested && loading && <div className="rounded-2xl border border-brand-border bg-brand-surface p-4 text-sm text-brand-muted">{ru?'Собираем подборки из свежих данных…':'Building decks from fresh data…'}</div>}
    {requested && !loading && failed && decks.length===0 && <div className="rounded-2xl border border-brand-border bg-brand-surface p-4 text-sm text-brand-muted">{ru?'Не удалось проверить все источники. Попробуй позже.':'Could not verify sources. Try again later.'}</div>}
    {requested && !loading && !failed && decks.length===0 && <div className="rounded-2xl border border-brand-border bg-brand-surface p-4 text-sm text-brand-muted">{ru?'Пока недостаточно подтверждённых данных для тематической колоды.':'Not enough verified data for a themed deck yet.'}</div>}
    {requested && editorialMode === 'ai' && <p className="text-[9px] uppercase tracking-[0.12em] text-brand-accent">{ru?'ИИ-редактор · факты проверены':'AI editor · facts verified'}</p>}
    {requested && !loading && !decks.some((deck) => deck.family === 'comparison' && deck.groupBy === 'birth-country') && <p className="text-[10px] leading-relaxed text-brand-muted">{ru?'Подборки по стране рождения появятся после загрузки подтверждённых данных о месте рождения. Национальность не используется вместо страны рождения.':'Birth-country decks will appear when sourced birthplace data is available. Nationality is not used as a substitute.'}</p>}
    {requested && orderedDecks.map(deck => {
      const Icon = deck.icon==='bolt'?IconBolt:deck.icon==='calendar'||deck.icon==='era'?IconCalendarEvent:IconCrown;
      return <article key={deck.id} className="relative overflow-hidden rounded-2xl border border-brand-border bg-brand-surface">
        <div className="absolute inset-0 opacity-20 pointer-events-none">{deck.image && <img src={deck.image} alt="" className="w-full h-full object-cover blur-sm scale-110"/>}<div className="absolute inset-0 bg-gradient-to-r from-brand-bg via-brand-bg/85 to-transparent"/></div>
        <div className="relative p-4 space-y-3">
          <div className="flex items-center gap-2 text-brand-accent"><Icon size={14}/><span className="text-[9px] font-bold tracking-[0.13em] uppercase">{deck.eyebrow}</span></div>
          <div><h3 className="ds-display text-lg font-extrabold text-white">{editorials[deck.id]?.title ?? deck.title}</h3>
            <p className="text-[11px] leading-relaxed text-brand-muted mt-1">{editorials[deck.id]?.hook ?? deck.description}</p>
            {editorials[deck.id]?.why && <p className="text-[10px] leading-relaxed text-white/75 mt-1.5"><span className="text-brand-accent font-semibold">{ru?'Почему сейчас: ':'Why now: '}</span>{editorials[deck.id].why}</p>}</div>
          <div className="flex flex-wrap gap-1.5">{deck.names.map(name=><span key={name} className="rounded-full bg-brand-bg/80 border border-brand-border px-2 py-1 text-[10px] text-white/90">{name}</span>)}<span className="rounded-full bg-brand-bg/80 border border-brand-border px-2 py-1 text-[10px] text-brand-muted">{deck.filter.card_ids?.length ?? 0} {ru?'карточек':'cards'}</span></div>
          {deck.family === 'comparison' && deck.careerRows && <div className="rounded-xl border border-brand-border bg-brand-bg/70 p-3 space-y-2">
            <p className="text-[9px] uppercase tracking-wider text-brand-muted font-bold">{ru?'Карьера: матчи · голы':'Career: appearances · goals'}</p>
            {deck.careerRows.slice(0, 5).map((row) => <div key={row.card_id} className="flex items-center gap-2 text-[11px]">
              <span className="min-w-0 flex-1 truncate text-white/90">{row.name}</span>
              <span className="shrink-0 tabular-nums text-brand-muted">{row.appearances} · {row.goals}</span>
            </div>)}
            <p className="text-[9px] leading-relaxed text-brand-muted">{ru?'Сумма показателей из доступной истории карьеры. Для лиги это не только матчи внутри указанного чемпионата.':'Totals from available career history. For league groups, these are not limited to matches in that league.'}</p>
          </div>}
          <button type="button" onClick={()=>onStart(deck.filter,deck.id)} className="w-full flex items-center justify-between rounded-xl bg-brand-accent text-brand-bg font-bold text-sm px-4 py-3 active:scale-[0.99] transition-transform"><span>{ru?'Играть в эту колоду':'Play this deck'}</span><IconArrowUpRight size={18}/></button>
        </div>
      </article>;
    })}
    {requested && failed && decks.length > 0 && <p className="text-[10px] text-brand-muted">{ru?'Часть источников временно недоступна; показаны только данные, которые удалось проверить.':'Some sources are temporarily unavailable; only successfully verified data is shown.'}</p>}
    {requested && news.length>0 && <div className="rounded-2xl border border-brand-border bg-brand-surface p-3 space-y-2">
      <div className="flex items-center gap-2 text-brand-muted"><IconCalendarEvent size={14}/><span className="text-[10px] uppercase tracking-wider font-bold">{ru?'В центре внимания':'In the headlines'}</span></div>
      {news.slice(0,3).map(item=><button key={item.url} type="button" onClick={()=>openLink(item.url)} className="w-full flex items-start gap-2 text-left"><span className="flex-1 text-[11px] leading-snug text-white/90">{item.title}</span><span className="shrink-0 text-[9px] text-brand-muted">{item.source}<IconArrowUpRight size={10} className="inline ml-1"/></span></button>)}
    </div>}
  </section>;
}
