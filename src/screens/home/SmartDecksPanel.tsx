import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconArrowUpRight, IconBolt, IconCalendarEvent, IconCrown, IconSparkles } from '@tabler/icons-react';
import { supabase } from '@/shared/lib/supabase';
import { openLink } from '@/shared/lib/telegram';
import type { DeckFilter } from '@/shared/types/deck';
import { buildGoldenEra, matchNewsToPlayers, type CanonicalPlayer, type NewsHeadline, type NewsCardMatch, type GoldenEra } from '@/features/decks/smartDecks';

interface RatingCandidate { card_id: string; name: string; name_en: string | null; photo_url: string | null; matches: number; goals: number; assists: number }
interface SmartDeck { id: string; eyebrow: string; title: string; description: string; icon: 'bolt' | 'calendar' | 'crown' | 'era'; image: string | null; names: string[]; filter: DeckFilter }
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
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true); setFailed(false);
      try {
    const since = new Date(Date.now() - NEWS_WINDOW_HOURS * 3600_000).toISOString();
    const [newsRes, formRes, legendRes, playersRes] = await Promise.all([
      supabase.from('news_items').select('title,url,source,published_at').gte('published_at', since).order('published_at', { ascending: false }).limit(100),
      supabase.rpc('player_ratings', { p_days: 30, p_limit: 16, p_club_key: null, p_league: null, p_country: null }),
      supabase.from('cards').select('id,name,name_en,photo_url,country,position_ru,fame,legend_career').eq('active', true).eq('category', 'player').contains('tags', ['legend']).order('fame', { ascending: false, nullsFirst: false }).limit(200),
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
    setForm(formRows.filter((p) => p.card_id && p.matches > 0).slice(0, 12));
    setLegends(legendRows);
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
  }, []);

  const decks = useMemo<SmartDeck[]>(() => {
    const result: SmartDeck[] = [];
    const goldenEra: GoldenEra | null = buildGoldenEra(legends, 16);
    if (form.length >= 3) result.push({
      id:'smart-current-form', eyebrow:ru?'ФОРМА · 30 ДНЕЙ':'FORM · 30 DAYS',
      title:ru?'Сейчас на пике':'In form now',
      description:ru?'Игроки, выделившиеся в собранной матчевой статистике за последние 30 дней.':'Players standing out in collected match stats over the last 30 days.',
      icon:'bolt', image:form[0]?.photo_url ?? null, names:form.slice(0,3).map(p=>p.name),
      filter:{ categories:['player'], card_ids:form.map(p=>p.card_id), lang },
    });
    if (newsMatches.length >= 3) result.push({
      id:'smart-news-pulse', eyebrow:ru?'ГРОМКИЕ НОВОСТИ · 72 ЧАСА':'NEWS PULSE · 72 HOURS',
      title:ru?'Футбол прямо сейчас':'Football right now',
      description:ru?'Игроки сопоставлены с полными именами в свежих заголовках — без догадок по фамилии.':'Players matched by full canonical names in recent headlines.',
      icon:'calendar', image:newsMatches[0]?.photo_url ?? null, names:newsMatches.slice(0,3).map(p=>p.name),
      filter:{ categories:['player'], card_ids:newsMatches.map(p=>p.id), lang },
    });
    if (legends.length >= 3) result.push({
      id:'smart-legends', eyebrow:ru?'ЗОЛОТОЙ ФОНД':'ALL-TIME GREATS',
      title:ru?'Легенды футбола':'Football legends',
      description:ru?'Исторические карточки, отмеченные в базе как легендарные.':'Historical cards explicitly tagged as legends in the database.',
      icon:'crown', image:legends[0]?.photo_url ?? null, names:legends.slice(0,3).map(p=>p.name),
      filter:{ categories:['player'], card_ids:legends.map(p=>p.id), lang },
    });
    if (goldenEra && goldenEra.players.length >= 3) result.push({
      id:'smart-golden-era', eyebrow:ru?'ЗОЛОТАЯ ЭПОХА · ПО КАРЬЕРАМ':'GOLDEN ERA · CAREER OVERLAP',
      title:ru?`Великая эпоха: ${goldenEra.club}`:`Golden era: ${goldenEra.club}`,
      description:ru?`Подтверждённое пересечение карьер ${goldenEra.startYear}–${goldenEra.endYear}. Состав собран по данным карточек.`:`Verified career overlap from ${goldenEra.startYear} to ${goldenEra.endYear}, derived from player dossier data.`,
      icon:'era', image:goldenEra.players[0]?.photo_url ?? null,
      names:goldenEra.players.slice(0,3).map(p=>p.name),
      filter:{ categories:['player'], card_ids:goldenEra.players.map(p=>p.id), lang },
    });
    return result;
  }, [form, legends, newsMatches, lang, ru]);

  return <section className="w-full max-w-sm space-y-3" aria-labelledby="smart-decks-title">
    <div>
      <p className="text-[10px] uppercase tracking-[0.16em] font-bold text-brand-accent mb-1">{ru?'ПОД ТВОЙ ФУТБОЛЬНЫЙ МОМЕНТ':'YOUR FOOTBALL MOMENT'}</p>
      <h2 id="smart-decks-title" className="ds-display text-xl font-extrabold text-white">{ru?'Подборки для тебя':'Picked for you'}</h2>
      <p className="text-[11px] text-brand-muted mt-1">{ru?'Подборки по статистике, новостям и проверенным карточкам.':'Curated from match stats, news and verified cards.'}</p>
    </div>
    {loading && <div className="rounded-2xl border border-brand-border bg-brand-surface p-4 text-sm text-brand-muted">{ru?'Собираем подборки из свежих данных…':'Building decks from fresh data…'}</div>}
    {!loading && failed && decks.length===0 && <div className="rounded-2xl border border-brand-border bg-brand-surface p-4 text-sm text-brand-muted">{ru?'Не удалось проверить все источники. Попробуй позже.':'Could not verify sources. Try again later.'}</div>}
    {!loading && !failed && decks.length===0 && <div className="rounded-2xl border border-brand-border bg-brand-surface p-4 text-sm text-brand-muted">{ru?'Пока недостаточно подтверждённых данных для тематической колоды.':'Not enough verified data for a themed deck yet.'}</div>}
    {decks.map(deck => {
      const Icon = deck.icon==='bolt'?IconBolt:deck.icon==='calendar'||deck.icon==='era'?IconCalendarEvent:IconCrown;
      return <article key={deck.id} className="relative overflow-hidden rounded-2xl border border-brand-border bg-brand-surface">
        <div className="absolute inset-0 opacity-20 pointer-events-none">{deck.image && <img src={deck.image} alt="" className="w-full h-full object-cover blur-sm scale-110"/>}<div className="absolute inset-0 bg-gradient-to-r from-brand-bg via-brand-bg/85 to-transparent"/></div>
        <div className="relative p-4 space-y-3">
          <div className="flex items-center gap-2 text-brand-accent"><IconSparkles size={14}/><span className="text-[9px] font-bold tracking-[0.13em] uppercase">{deck.eyebrow}</span></div>
          <div><h3 className="ds-display text-lg font-extrabold text-white">{deck.title}</h3><p className="text-[11px] leading-relaxed text-brand-muted mt-1">{deck.description}</p></div>
          <div className="flex flex-wrap gap-1.5">{deck.names.map(name=><span key={name} className="rounded-full bg-brand-bg/80 border border-brand-border px-2 py-1 text-[10px] text-white/90">{name}</span>)}<span className="rounded-full bg-brand-bg/80 border border-brand-border px-2 py-1 text-[10px] text-brand-muted">{deck.filter.card_ids?.length ?? 0} {ru?'карточек':'cards'}</span></div>
          <button type="button" onClick={()=>onStart(deck.filter,deck.id)} className="w-full flex items-center justify-between rounded-xl bg-brand-accent text-brand-bg font-bold text-sm px-4 py-3 active:scale-[0.99] transition-transform"><span>{ru?'Играть в эту колоду':'Play this deck'}</span><IconArrowUpRight size={18}/></button>
        </div>
      </article>;
    })}
    {news.length>0 && <div className="rounded-2xl border border-brand-border bg-brand-surface p-3 space-y-2">
      <div className="flex items-center gap-2 text-brand-muted"><IconCalendarEvent size={14}/><span className="text-[10px] uppercase tracking-wider font-bold">{ru?'В центре внимания':'In the headlines'}</span></div>
      {news.slice(0,3).map(item=><button key={item.url} type="button" onClick={()=>openLink(item.url)} className="w-full flex items-start gap-2 text-left"><span className="flex-1 text-[11px] leading-snug text-white/90">{item.title}</span><span className="shrink-0 text-[9px] text-brand-muted">{item.source}<IconArrowUpRight size={10} className="inline ml-1"/></span></button>)}
    </div>}
  </section>;
}
