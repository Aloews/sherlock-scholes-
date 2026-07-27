import { useTranslation } from 'react-i18next';
import { IconChevronLeft, IconTrophy, IconShirt } from '@tabler/icons-react';
import { PlayerCard } from '@/shared/ui/PlayerCard';
import { CATEGORY_COLOR, CATEGORY_FALLBACK_COLOR } from '@/shared/ui/CategoryIcon';
import { cardDisplayName } from '@/shared/lib/cardName';
import { isoToFlag } from '@/shared/lib/flag';
import { countryName, positionName } from '@/shared/lib/countryName';
import { hapticImpact } from '@/shared/lib/telegram';
import { TIER_COLOR, TIER_LABEL_RU, TIER_LABEL_EN, type Card } from '@/shared/types/database';

// Full-screen card dossier, opened from the Collection grid. Follows the
// prototype's `isPlayer` overlay: framed hero card, quick-fact tiles, trophies,
// career, facts.
//
// The prototype's OVR badge and its six 0–100 attribute bars are NOT here:
// nothing in the schema rates a card or a player on a numeric scale, and
// inventing numbers on a screen that reads as factual would be a lie. See
// docs/PROGRESSION_FEATURES_HANDOFF.md if those are ever to exist.

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

  // Trophies: structural titles plus tournaments, deduped.
  const trophies = [
    ...(facts?.titles ?? []),
    ...(card.legend_career?.titles ?? []),
    ...(facts?.tournaments ?? []),
  ].filter((v, i, a) => v && a.indexOf(v) === i);

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
          <img
            src={card.photo_url}
            alt={name}
            className="w-full h-[180px] object-cover object-top rounded-2xl border border-brand-border"
          />
        )}

        {tiles.length > 0 && (
          {/* Two per row, not the prototype's four: its tiles held numbers,
              ours hold words like "Нападающий", which truncate at 390px. */}
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
