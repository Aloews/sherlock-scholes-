import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconChevronLeft, IconTrophy, IconShirt, IconFlag } from '@tabler/icons-react';
import { PlayerCard } from '@/shared/ui/PlayerCard';
import { CATEGORY_COLOR, CATEGORY_FALLBACK_COLOR } from '@/shared/ui/CategoryIcon';
import { cardDisplayName } from '@/shared/lib/cardName';
import { splitHonours } from '@/shared/lib/honours';
import { isoToFlag } from '@/shared/lib/flag';
import { countryName, positionName } from '@/shared/lib/countryName';
import { hapticImpact, openLink } from '@/shared/lib/telegram';
import {
  TIER_COLOR, TIER_LABEL_RU, TIER_LABEL_EN, type Card, type CardAttributes,
} from '@/shared/types/database';
import { fetchCollectedTotals, type CollectedTotals } from '@/features/ratings/ratingsApi';
import {
  fetchPlayerNews, fetchPlayerClips, type PlayerNewsItem, type PlayerClip,
} from '@/features/collection/playerMediaApi';

// Full-screen card dossier, opened from the Collection grid. Follows the
// prototype's `isPlayer` overlay: framed hero card, quick-fact tiles, OVR
// badge, attribute bars, trophies, career, facts.
//
// The OVR badge and the six "Характеристики" bars only render when
// card.ovr / card.attributes carry a value — nothing seeds them yet
// (docs/cards_attributes_column.sql adds the columns; real per-player
// ratings are a separate data project, see docs/PROGRESSION_FEATURES_HANDOFF.md).
// Inventing numbers on a screen that reads as factual would be a lie, so
// absent data means the badge/bars are simply omitted, not faked.
const ATTRIBUTE_ROWS: { key: keyof CardAttributes; labelKey: string }[] = [
  { key: 'pace',      labelKey: 'collection.attr_pace' },
  { key: 'shooting',  labelKey: 'collection.attr_shooting' },
  { key: 'passing',   labelKey: 'collection.attr_passing' },
  { key: 'dribbling', labelKey: 'collection.attr_dribbling' },
  { key: 'defense',   labelKey: 'collection.attr_defense' },
  { key: 'physical',  labelKey: 'collection.attr_physical' },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-brand-muted mb-2.5">
        {title}
      </p>
      {children}
    </div>
  );
}

export function CardDossier({ card, onClose }: { card: Card; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isRu = lang.startsWith('ru');

  // Собранная статистика матчей — та же таблица, что кормит рейтинг. Грузится
  // отдельно и молча: досье полно и без неё, а её отсутствие для легенды —
  // норма, а не поломка (мы собираем только действующих игроков).
  const [collected, setCollected] = useState<CollectedTotals[]>([]);
  useEffect(() => {
    let cancelled = false;
    setCollected([]);
    void fetchCollectedTotals(card.id).then((r) => {
      if (!cancelled && r.status === 'ok') setCollected(r.data);
    });
    return () => { cancelled = true; };
  }, [card.id]);

  // Новости и видео — по фамилии, через ту же токенизацию, что клеит темы
  // дайджеста через алфавиты. Пусто трое суток подряд — норма: `news_items`
  // столько и живёт, а не каждый день про игрока пишут.
  const [news, setNews] = useState<PlayerNewsItem[]>([]);
  const [clips, setClips] = useState<PlayerClip[]>([]);
  useEffect(() => {
    let cancelled = false;
    setNews([]);
    setClips([]);
    void fetchPlayerNews(card.id).then((r) => { if (!cancelled) setNews(r); });
    void fetchPlayerClips(card.id).then((r) => { if (!cancelled) setClips(r); });
    return () => { cancelled = true; };
  }, [card.id]);

  const name     = cardDisplayName(card, lang);
  const catColor = CATEGORY_COLOR[card.category] ?? CATEGORY_FALLBACK_COLOR;
  const facts    = card.facts ?? null;

  const tierLabel = card.tier
    ? (isRu ? TIER_LABEL_RU : TIER_LABEL_EN)[card.tier]
    : null;

  // Quick facts — only the tiles that actually have a value.
  const flag = isoToFlag(card.country);
  const tiles = [
    card.country && {
      label: t('collection.f_country'),
      value: `${flag ? `${flag} ` : ''}${countryName(card.country, lang) ?? card.country}`,
    },
    (card.position_ru || facts?.position) && {
      label: t('collection.f_position'),
      value: positionName(card.position_ru ?? facts?.position ?? null, lang)
        ?? (card.position_ru ?? facts?.position),
    },
    facts?.height_cm && { label: t('collection.f_height'), value: `${facts.height_cm} cm` },
    facts?.years_active && { label: t('collection.f_years'), value: facts.years_active },
    facts?.national_caps && { label: t('collection.f_caps'), value: String(facts.national_caps) },
    facts?.clubs_count && { label: t('collection.f_clubs'), value: String(facts.clubs_count) },
  ].filter(Boolean).slice(0, 4) as { label: string; value: string }[];

  // Trophies are things WON; facts.tournaments is where a player turned up.
  // The rule lives in shared/lib/honours.ts and is tested there — it used to
  // be a concatenation here, which credited players with honours they never
  // had. See honours.test.ts.
  const { trophies, tournaments } = splitHonours({
    titles: facts?.titles,
    legendTitles: card.legend_career?.titles,
    tournaments: facts?.tournaments,
  });

  // Career: legends carry clubs+years, veterans carry clubs+apps/goals.
  const career: { club: string; meta: string }[] =
    card.legend_career?.clubs?.map((c) => ({
      club: (!isRu && c.club_en) ? c.club_en : c.club,
      meta: c.years,
    }))
    ?? card.career_stats?.map((c) => ({
      club: (isRu && c.club_ru) ? c.club_ru : c.club,
      meta: c.years,
    }))
    ?? [];

  const blurb = card.descriptions?.[lang.slice(0, 2)] ?? card.descriptions?.ru ?? null;

  const attributeRows = card.attributes
    ? ATTRIBUTE_ROWS
        .map((row) => ({ label: t(row.labelKey), value: card.attributes![row.key] }))
        .filter((row): row is { label: string; value: number } => row.value != null)
    : [];

  return (
    <div className="fixed inset-0 z-50 bg-brand-bg ds-screen overflow-y-auto animate-slide-up">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 flex items-center px-4 py-4 border-b border-brand-border bg-brand-bg">
        <button
          type="button"
          onClick={() => { hapticImpact('light'); onClose(); }}
          aria-label={t('home.back')}
          className="p-1.5 -ml-1.5 text-brand-muted hover:text-white transition-colors"
        >
          <IconChevronLeft size={20} stroke={2} />
        </button>
        <span className="flex-1 text-center text-[12px] font-bold uppercase tracking-[0.12em] text-brand-muted mr-6">
          {t('collection.dossier')}
        </span>
      </div>

      <div className="max-w-sm mx-auto px-5 py-5 space-y-5 pb-12">
        {/* Hero — the same card the game shows, framed by rarity. */}
        <PlayerCard card={card} mode="explainer" />

        {tierLabel && (
          <p
            className="text-center text-[11px] font-bold uppercase tracking-[0.12em] -mt-2"
            style={{ color: TIER_COLOR[card.tier!] }}
          >
            {tierLabel}
          </p>
        )}

        {card.photo_url && (
          <div
            className="relative w-full h-[180px] rounded-2xl border border-brand-border
                       bg-brand-surface overflow-hidden flex items-center justify-center"
          >
            {/* object-contain, not object-cover: source photos range from tight
                headshots to full-body shots, and a fixed-height crop was cutting
                a lot of them off. Showing the whole photo (letterboxed if needed)
                never loses the subject, at the cost of some empty space beside
                narrow ones. */}
            <img
              src={card.photo_url}
              alt={name}
              className="max-w-full max-h-full object-contain"
            />
            {card.ovr != null && (
              <div
                role="img"
                aria-label={t('collection.ovr_aria', { value: card.ovr })}
                className="absolute top-3 left-3 w-11 h-11 rounded-xl flex items-center justify-center"
                style={{
                  background: 'linear-gradient(155deg, rgb(var(--brand-accent-soft)), rgb(var(--brand-accent)))',
                }}
              >
                <span className="ds-display text-[16px] font-extrabold text-brand-bg">{card.ovr}</span>
              </div>
            )}
          </div>
        )}

        {/* Two per row, not the prototype's four: its tiles held numbers, ours
            hold words like "Нападающий", which truncate at 390px. */}
        {tiles.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {tiles.map((tile) => (
              <div
                key={tile.label}
                className="ds-panel bg-brand-surface border border-brand-border rounded-xl px-3 py-2.5 text-center"
              >
                <p className="text-[13px] font-bold text-white truncate">{tile.value}</p>
                <p className="text-[9px] uppercase tracking-[0.05em] text-brand-muted mt-0.5">
                  {tile.label}
                </p>
              </div>
            ))}
          </div>
        )}

        {attributeRows.length > 0 && (
          <Section title={t('collection.attributes')}>
            <div className="flex flex-col gap-2.5">
              {attributeRows.map((row) => (
                <div key={row.label}>
                  <div className="flex justify-between text-[11.5px] mb-1">
                    <span className="text-brand-muted">{row.label}</span>
                    <span className="font-bold text-white">{row.value}</span>
                  </div>
                  <div className="h-[5px] rounded-full bg-brand-border overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${row.value}%`, background: 'var(--accent-gradient)' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {trophies.length > 0 && (
          <Section title={t('collection.trophies')}>
            <div className="space-y-2">
              {trophies.map((tr) => (
                <div
                  key={tr}
                  className="ds-panel flex items-center gap-2.5 bg-brand-surface border border-brand-border rounded-xl px-3 py-2.5"
                >
                  <IconTrophy size={15} stroke={1.75} style={{ color: TIER_COLOR.legendary }} />
                  <span className="text-[12.5px] text-white/90">{tr}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {tournaments.length > 0 && (
          <Section title={t('collection.tournaments')}>
            <div className="space-y-2">
              {tournaments.map((tr) => (
                <div
                  key={tr}
                  className="ds-panel flex items-center gap-2.5 bg-brand-surface border border-brand-border rounded-xl px-3 py-2.5"
                >
                  <IconFlag size={15} stroke={1.75} className="text-brand-muted" />
                  <span className="text-[12.5px] text-white/90">{tr}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {career.length > 0 && (
          <Section title={t('collection.career')}>
            <div>
              {career.map((row, i) => (
                <div
                  key={`${row.club}-${i}`}
                  className="flex gap-3 py-2.5 border-b border-brand-border last:border-b-0"
                >
                  <IconShirt size={14} stroke={1.75} className="text-brand-muted mt-0.5 shrink-0" />
                  <span className="flex-1 text-[12.5px] text-white/90">{row.club}</span>
                  <span className="text-[11.5px] text-brand-muted">{row.meta}</span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Собранная статистика — то же, что кормит рейтинг футболистов.
            Ставится ПОСЛЕ карьеры намеренно: карьера это история, а здесь
            только то, что конвейер видел своими глазами, и период подписан
            датами, чтобы блок не выдавал себя за полную карьеру. */}
        {collected.length > 0 && (
          <Section title={t('collection.collected')}>
            <div>
              {collected.map((row) => (
                <div
                  key={row.tournament}
                  className="flex gap-3 py-2.5 border-b border-brand-border last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-[12.5px] text-white/90 truncate">{row.tournament}</p>
                    <p className="text-[11px] text-brand-muted">
                      {t('collection.collected_period', {
                        from: row.first_match,
                        to: row.last_match,
                      })}
                    </p>
                  </div>
                  <span className="text-[11.5px] text-brand-muted tabular-nums shrink-0">
                    {t('collection.collected_line', {
                      matches: row.matches,
                      goals: row.goals,
                      assists: row.assists,
                    })}
                  </span>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Новости и видео — по фамилии из тех же лент, что кормят дайджест.
            Ставится ПОСЛЕ карьеры и собранной статистики: это самое свежее и
            самое необязательное — редкий инфоповод не должен быть первым,
            что видит человек, открывший досье легенды. */}
        {(news.length > 0 || clips.length > 0) && (
          <Section title={t('collection.news_and_video')}>
            <div className="space-y-3">
              {clips.length > 0 && (
                <div className="-mx-4 px-4 overflow-x-auto">
                  <div className="flex gap-2 w-max pb-0.5">
                    {clips.map((clip) => (
                      <button
                        key={clip.video_id}
                        type="button"
                        onClick={() => {
                          hapticImpact('light');
                          openLink(`https://www.youtube.com/watch?v=${clip.video_id}`);
                        }}
                        className="w-32 shrink-0 text-left"
                      >
                        {clip.thumb_url && (
                          <img
                            src={clip.thumb_url}
                            alt=""
                            loading="lazy"
                            className="w-32 aspect-video object-cover rounded-lg border border-brand-border"
                          />
                        )}
                        <p className="text-white text-[11px] mt-1 line-clamp-2 leading-tight">
                          {clip.title}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {news.length > 0 && (
                <div className="space-y-2">
                  {news.map((item) => (
                    <button
                      key={item.url}
                      type="button"
                      onClick={() => { hapticImpact('light'); openLink(item.url); }}
                      className="w-full flex items-start gap-2 text-left"
                    >
                      <span className="flex-1 min-w-0 text-[12.5px] text-white/90 leading-snug">
                        {item.title}
                      </span>
                      <span className="shrink-0 text-[10.5px] text-brand-muted mt-0.5">
                        {item.source}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </Section>
        )}

        {blurb && (
          <Section title={t('collection.about')}>
            <p
              className="text-[12.5px] leading-relaxed text-brand-muted bg-brand-surface
                         border border-brand-border rounded-xl px-3.5 py-3 ds-panel"
              style={{ borderLeftColor: catColor }}
            >
              {blurb}
            </p>
          </Section>
        )}
      </div>
    </div>
  );
}
