import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, motion } from 'framer-motion';
import {
  IconArrowsExchange,
  IconBallFootball,
  IconBuildingStadium,
  IconFlag,
  IconFlag3,
  IconReload,
  IconShield,
  IconUser,
  IconX,
} from '@tabler/icons-react';
import { useTraining, type HistoryEntry, type Team } from '@/features/game/useTraining';
import { cardDisplayName } from '@/shared/lib/cardName';
import { isoToFlag } from '@/shared/lib/flag';
import { trackEvent } from '@/shared/lib/analytics';
import {
  reportCard, alreadyReported, reportThrottled,
  REPORT_REASONS, type ReportReason,
} from '@/features/reports/reportsApi';
import { countryName, positionName } from '@/shared/lib/countryName';
import { playSound } from '@/shared/lib/sounds';
import { hapticImpact } from '@/shared/lib/telegram';
import { tierCardStyle, tierRingStyle } from '@/shared/lib/tier';
import type { CardCategory, ContinentFilter } from '@/shared/types/database';
import { CATEGORY_LABEL_RU } from '@/shared/types/database';

interface TrainingState {
  categories: CardCategory[] | null;
  continents?: ContinentFilter[] | null; // player cards only; null = all
  minPageviews?: number | null;          // legacy difficulty floor; null = whole deck
  tags?: string[] | null;                // special-category filter (вратари / star / …)
  difficulty?: number | null;            // onboarding pv floor (default quick game); null = no cap
}

const TEAM_COLOR: Record<Team, string> = {
  orange: '#FF6300',
  blue:   '#4A9EFF',
};

// History row status bar (Variant 4): guessed = success green, skipped =
// warning orange.
const STATUS_GUESSED = '#00C97D';
const STATUS_SKIPPED = '#FF6300';

// Score separator — muted slate, NOT a pure grey (Variant 5 palette).
const SCORE_DIVIDER = '#4A5270';

// cards.clubs_minutes is summed ONLY from the 2022–2024 API-Football cache, so
// every minute total it carries is a partial, often misleading tail (Nathan
// Redmond "Саутгемптон 1 мин", Walcott 490'). We therefore NEVER render minutes
// or hours from it — clubChips() shows clubs+years (legend_career),
// matches/goals (career_stats), or the bare club NAMES only.

const CATEGORY_COLOR: Record<CardCategory, string> = {
  player:        '#FF6300',
  club:          '#4A9EFF',
  club_nickname: '#4A9EFF',
  stadium:       '#00C97D',
  term:          '#B47AFF',
  position:      '#B47AFF',
  referee:       '#FFD24A',
  coach:         '#FFD24A',
  commentator:   '#7A8499',
  woman:         '#FF6BA8',
};

const googleSearch = (name: string) => {
  const q   = encodeURIComponent(`${name} football wiki`);
  const url = `https://www.google.com/search?q=${q}`;
  const tg  = window.Telegram?.WebApp as { openLink?: (url: string) => void } | undefined;
  if (tg?.openLink) tg.openLink(url);
  else window.open(url, '_blank');
};

// Placeholder icon per category when a history entry has no photo: a user
// silhouette makes no sense for a term or a stadium. People keep IconUser.
const PLACEHOLDER_ICON: Partial<Record<CardCategory, typeof IconUser>> = {
  term:          IconBallFootball,
  position:      IconBallFootball,
  club:          IconShield,
  club_nickname: IconShield,
  stadium:       IconBuildingStadium,
  // No IconWhistle in tabler — IconFlag is the referee icon used in-game too.
  referee:       IconFlag,
};

/** 32x32 round avatar for the summary history. Falls back to a category
 * placeholder circle when the card has no photo_url or the image fails.
 * (The country flag lives in the meta line under the name, not here.) */
function HistoryAvatar({ photoUrl, category, alt, tier, onOpen }: {
  photoUrl?: string | null;
  category: CardCategory;
  alt: string;
  tier?: string | null;
  onOpen?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  // Rarity ring (subtle; common/unknown → none).
  const ring = tierRingStyle(tier);
  // Commons URLs are stored with ?width=256; the 32px avatar only needs 128.
  const src = photoUrl ? photoUrl.replace('width=256', 'width=128') : null;
  if (!src || failed) {
    // No photo (or it failed to load) — a silhouette, not tappable.
    const Placeholder = PLACEHOLDER_ICON[category] ?? IconUser;
    return (
      <span
        className="w-8 h-8 shrink-0 rounded-full bg-brand-surface border border-brand-border flex items-center justify-center"
        style={ring}
      >
        <Placeholder size={16} className="text-brand-muted" />
      </span>
    );
  }
  const img = (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      // object-top: football photos have the face in the upper third, so the
      // circle crops from the top — centre-cropping cuts the head off.
      className="w-8 h-8 shrink-0 rounded-full object-cover object-top"
    />
  );
  // With a real photo, tap opens the full-size lightbox.
  return onOpen ? (
    <button type="button" onClick={onOpen} aria-label={alt} style={ring}
      className="shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-brand-accent">
      {img}
    </button>
  ) : (
    <span className="shrink-0 rounded-full" style={ring}>{img}</span>
  );
}

/** Big centred score line "orange : blue" in team colours (Variant 5). */
function ScoreLine({ orange, blue, activeTeam }: {
  orange: number;
  blue: number;
  activeTeam?: Team;
}) {
  return (
    <div className="flex items-center justify-center gap-3 text-[30px] font-medium leading-none">
      <span style={{ color: TEAM_COLOR.orange, opacity: activeTeam && activeTeam !== 'orange' ? 0.4 : 1 }}>
        {orange}
      </span>
      <span style={{ color: SCORE_DIVIDER }}>:</span>
      <span style={{ color: TEAM_COLOR.blue, opacity: activeTeam && activeTeam !== 'blue' ? 0.4 : 1 }}>
        {blue}
      </span>
    </div>
  );
}

/** "Report an error" bottom sheet: pick a reason (+ optional comment) and send
 * one anonymous report via the report_card RPC. Reasons are aggregate-only; the
 * device id (throttle) is added inside reportsApi, never shown here. */
function ReportSheet({ entry, onClose }: { entry: HistoryEntry; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const name = cardDisplayName(entry, i18n.language);
  const done = status === 'done' || alreadyReported(entry.id);

  const submit = async () => {
    if (!reason) return;
    if (reportThrottled()) { setStatus('error'); return; }
    setStatus('sending');
    try {
      await reportCard(entry.id, reason, comment);
      hapticImpact('light');
      setStatus('done');
    } catch {
      setStatus('error');
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={onClose}
    >
      <motion.div
        className="w-full max-w-md bg-brand-surface rounded-t-2xl border-t border-brand-border p-5 pb-8 space-y-4"
        initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-white font-medium truncate">{t('report.title')}</p>
          <button aria-label={t('report.close')} className="text-brand-muted p-1 shrink-0" onClick={onClose}>
            <IconX size={20} stroke={2} />
          </button>
        </div>
        <p className="text-brand-muted text-xs truncate">{name}</p>

        {done ? (
          <p className="text-[#00C97D] text-sm py-4 text-center">{t('report.thanks')}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              {REPORT_REASONS.map((r) => (
                <button key={r}
                  className={`rounded-lg px-3 py-2.5 text-sm text-left transition-colors border ${
                    reason === r
                      ? 'bg-brand-accent/20 text-white border-brand-accent'
                      : 'bg-brand-border text-brand-muted border-transparent'}`}
                  onClick={() => setReason(r as ReportReason)}>
                  {t(`report.reason_${r}`)}
                </button>
              ))}
            </div>
            <textarea
              className="w-full bg-brand-bg border border-brand-border rounded-lg px-3 py-2 text-white text-sm resize-none focus:outline-none focus:border-brand-accent"
              rows={2} maxLength={280} value={comment}
              placeholder={t('report.comment_placeholder')}
              onChange={(e) => setComment(e.target.value)}
            />
            {status === 'error' && (
              <p className="text-red-400 text-xs text-center">{t('report.error')}</p>
            )}
            <button
              className="w-full h-11 rounded-lg bg-brand-accent text-brand-bg font-medium disabled:opacity-50"
              disabled={!reason || status === 'sending'}
              onClick={submit}>
              {status === 'sending' ? '…' : t('report.submit')}
            </button>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

/** Outer wrapper — holds the remount key so "Play again" starts a fresh game. */
export function TrainingScreen() {
  const location = useLocation();
  const state    = location.state as TrainingState | null;
  const categories = state?.categories ?? null;
  const continents = state?.continents ?? null;
  const minPageviews = state?.minPageviews ?? null;
  const tags = state?.tags ?? null;
  const difficulty = state?.difficulty ?? null;

  const [gameKey, setGameKey] = useState(0);

  return (
    <TrainingGame
      key={gameKey}
      categories={categories}
      continents={continents}
      minPageviews={minPageviews}
      tags={tags}
      difficulty={difficulty}
      onPlayAgain={() => setGameKey((k) => k + 1)}
    />
  );
}

interface TrainingGameProps {
  categories: CardCategory[] | null;
  continents: ContinentFilter[] | null;
  minPageviews: number | null;
  tags: string[] | null;
  difficulty: number | null;
  onPlayAgain: () => void;
}

function TrainingGame({ categories, continents, minPageviews, tags, difficulty, onPlayAgain }: TrainingGameProps) {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const { currentCard, loading, scores, activeTeam, history, guess, skip, passTurn } =
    useTraining(categories, continents, minPageviews, tags, difficulty);

  const [finished, setFinished] = useState(false);
  // Full-size photo lightbox (history avatars). null = closed.
  const [lightbox, setLightbox] = useState<string | null>(null);
  // "Report an error" sheet — the history entry being reported, or null.
  const [reporting, setReporting] = useState<HistoryEntry | null>(null);

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center">
        <div className="text-brand-muted text-center">
          <div className="text-4xl mb-3 animate-pulse">⚽</div>
          <p>{t('app.loading')}</p>
        </div>
      </div>
    );
  }

  // Bottom line under the name: "🇩🇪 Германия · Защитник" (country name and
  // position follow the interface language). Country (flag + name) and/or
  // position; whichever is missing is dropped. No flag when there's no
  // country. Empty when neither is known.
  const metaLine = (entry: HistoryEntry): string | null => {
    const flag = isoToFlag(entry.country);
    const country = countryName(entry.country, i18n.language);
    const left = country ? `${flag ? flag + ' ' : ''}${country}` : null;
    const parts = [left, positionName(entry.position_ru, i18n.language)].filter(Boolean);
    return parts.length ? parts.join(' · ') : null;
  };

  // "1984–1991" -> "1984–91"; "1984–" stays open-ended.
  const shortYears = (years: string): string =>
    years.replace(/(\d{4})–(\d{2})(\d{2})/, '$1–$3');

  // Frontend safeguard against leftover wiki markup in a club name. Old
  // career_build runs let footnotes leak through (e.g. "Sacrofano<ref>{{Cite
  // web…}}</ref>" on Garrincha). The backend is fixed + the data reset, but
  // this keeps ANY future junk from rendering raw: cut the name at the first
  // markup marker ('<', '{{', 'http') and trim. Returns null if nothing usable
  // is left, so the caller drops that chip entirely.
  const cleanClub = (name: string): string | null => {
    const cut = name.split(/<|\{\{|https?:\/\//)[0].trim();
    return cut || null;
  };

  // Bottom clubs as chips. We NEVER show minute/hour figures (clubs_minutes
  // totals are an unreliable 2022-24 tail), only honest sources:
  //   career_stats : "Арсенал 2006–18 · 270 матчей, 65 голов"  (matches/goals)
  //   legend_career: "Реал Мадрид 2002–07", "Интер 1997–02"     (clubs + years)
  //   fallback     : bare club NAMES from clubs_minutes (no numbers).
  // FULL Russian club names (no shortening); chips wrap instead of clipping.
  const clubChips = (entry: HistoryEntry): string[] => {
    // Veterans with a Wikipedia career: club + years · apps, goals — the richest
    // and most honest line. Top clubs by apps.
    if (entry.career_stats?.length) {
      return [...entry.career_stats]
        .sort((a, b) => (b.apps ?? 0) - (a.apps ?? 0))
        .slice(0, 4)
        .map((c) => {
          const club = cleanClub(c.club);
          if (!club) return null;
          const m = t('career.matches', { count: c.apps ?? 0 });
          const g = c.goals != null ? `, ${t('career.goals', { count: c.goals })}` : '';
          return `${club} ${shortYears(c.years)} · ${m}${g}`.trim();
        })
        .filter((s): s is string => s !== null);
    }
    // Legends / veterans -> club + years, never minutes.
    if (entry.legend_career?.clubs?.length) {
      return entry.legend_career.clubs.slice(0, 4)
        .map((c) => {
          const club = cleanClub(c.club);
          return club ? `${club} ${shortYears(c.years)}`.trim() : null;
        })
        .filter((s): s is string => s !== null);
    }
    // Fallback: no richer source yet. The club NAMES in clubs_minutes are real
    // (he did play there in 2022-24) — only the minute totals lie. Show the bare
    // club list, NO numbers, rather than nothing.
    if (entry.clubs_minutes?.length) {
      return entry.clubs_minutes.slice(0, 4)
        .map((c) => cleanClub(c.club))
        .filter((s): s is string => s !== null);
    }
    return [];
  };

  // Structural facts (cards.facts) for the muted line under the gold titles.
  // NEW priority — what matters is career breadth, not minutes:
  //   clubs_count > caps-for-national > World Cup > height.
  // Titles are NOT here — they lead in the golden titlesLine() below.
  // National team genitive ("Португалии") -> short accusative phrase
  // ("за Португалию"), so the caps fact stays compact. Falls back to the long
  // "за сборную X" form for names that don't fit the common -ия/-а pattern.
  const shortNat = (team: string | null | undefined): string => {
    if (!team) return '';
    if (team.endsWith('ии')) return `за ${team.slice(0, -2)}ию`;
    if (team.endsWith('ы')) return `за ${team.slice(0, -1)}у`;
    return `за сборную ${team}`;
  };

  const brightFacts = (entry: HistoryEntry): string[] => {
    const f = entry.facts;
    if (!f) return [];
    // Women's cards take the feminine verb form ("играла на ЧМ"); i18next picks
    // the *_female_* key via context, falling back to the neutral key otherwise.
    const female = entry.category === 'woman';
    const out: string[] = [];
    // Priority: clubs_count > caps-for-national > World Cup > height. Show at
    // most TWO so the line never overflows (titles are a separate gold line).
    if (f.clubs_count) out.push(t('facts.clubs', { count: f.clubs_count }));
    if (f.national_caps) {
      out.push(t('facts.caps', { count: f.national_caps, team: shortNat(f.national_team) }));
    }
    const wc = (f.tournaments ?? []).filter((tm) => tm.startsWith('ЧМ')).length;
    if (wc) out.push(t('facts.world_cup', { count: wc, ...(female ? { context: 'female' } : {}) }));
    if (f.height_cm) out.push(t('facts.height', { cm: f.height_cm }));
    return out.slice(0, 2);
  };

  // Prestige titles in gold — now for EVERY card (legends use legend_career,
  // others fall back to facts.titles). Titles are the headline fact.
  const titlesLine = (entry: HistoryEntry): string[] =>
    (entry.legend_career?.titles?.length
      ? entry.legend_career.titles
      : entry.facts?.titles ?? []).slice(0, 3);

  // ── Summary screen ──────────────────────────────────────────────
  if (finished) {
    return (
      <div className="min-h-screen bg-brand-bg flex flex-col">
        {/* Header */}
        <div className="px-4 pt-8 pb-4 border-b border-brand-border">
          <h1 className="text-2xl font-medium text-white text-center">
            {t('quick.summary_title')}
          </h1>
        </div>

        {/* Final score — numbers only, no team labels underneath */}
        <div className="px-4 pt-6">
          <ScoreLine orange={scores.orange} blue={scores.blue} />
        </div>

        {/* Card history */}
        <div className="flex-1 px-4 pt-6 pb-4 overflow-y-auto">
          <p className="text-brand-muted text-sm uppercase tracking-wider mb-3">
            {t('quick.history_title')}
          </p>

          {history.length === 0 ? (
            <div className="rounded-md bg-brand-surface border border-brand-border p-8 text-center">
              <p className="text-brand-muted">{t('quick.history_empty')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((entry, i) => {
                const guessed = entry.status === 'guessed';
                // Category label for everything but players: photo + name
                // already identify a player, the rest need the context.
                const showCategory = entry.category !== 'player';
                // Women ARE players (their own category) — show a soft, muted
                // tag, not the loud coloured caps band the other categories use.
                const softCategory = entry.category === 'woman';
                const catColor = CATEGORY_COLOR[entry.category] ?? '#7A8499';
                // Translation -> name_en -> name, per the interface language.
                const displayName = cardDisplayName(entry, i18n.language);
                const meta = metaLine(entry);
                const chips = clubChips(entry);
                const facts = brightFacts(entry);
                const titles = titlesLine(entry);
                // Status colour bar on the left (Variant 4): green guessed,
                // orange skipped. Replaces the textual status label.
                const barColor = guessed ? STATUS_GUESSED : STATUS_SKIPPED;
                return (
                  <div
                    key={i}
                    className="flex items-start gap-2.5 bg-brand-surface border border-brand-border rounded-md rounded-l-none border-l-[3px] pl-3 pr-3 py-3"
                    style={{ borderLeftColor: barColor }}
                  >
                    <HistoryAvatar
                      photoUrl={entry.photo_url} category={entry.category} alt={displayName}
                      tier={entry.tier}
                      onOpen={entry.photo_url
                        ? () => {
                            hapticImpact('light');
                            // Interest signal: which cards players zoom into.
                            trackEvent('card_photo_opened', {
                              category: entry.category, tier: entry.tier ?? 'none',
                            });
                            setLightbox(entry.photo_url!);
                          }
                        : undefined}
                    />
                    <div className="flex-1 min-w-0">
                      {showCategory && (
                        <span
                          className={softCategory
                            ? 'block text-[10px] tracking-wide text-brand-muted/70'
                            : 'block text-[11px] uppercase tracking-widest font-medium'}
                          style={softCategory ? undefined : { color: catColor }}
                        >
                          {entry.category_ru ?? CATEGORY_LABEL_RU[entry.category] ?? entry.category}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => { hapticImpact('light'); googleSearch(displayName); }}
                        className="block w-full text-left text-xl font-medium text-white leading-snug truncate transition-colors hover:text-[#FF6300] hover:underline"
                      >
                        {displayName}
                      </button>
                      {meta && (
                        <p className="text-brand-muted text-xs leading-snug truncate mt-0.5">
                          {meta}
                        </p>
                      )}
                      {/* Titles first, in gold — the headline fact. Wraps (no clip). */}
                      {titles.length > 0 && (
                        <p className="text-[#FFD24A] text-xs font-medium leading-snug mt-0.5">
                          🏆 {titles.join(' · ')}
                        </p>
                      )}
                      {/* Career_stats lines are long ("Клуб годы · N матчей, M голов")
                          so they STACK and wrap; short minute/legend chips stay inline. */}
                      {chips.length > 0 && (
                        entry.career_stats?.length ? (
                          <div className="mt-0.5 space-y-0.5 text-brand-muted/80 text-xs leading-snug">
                            {chips.map((c, j) => (
                              <p key={j} className="break-words">{c}</p>
                            ))}
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5 text-brand-muted/80 text-xs leading-snug tabular-nums">
                            {chips.map((c, j) => (
                              <span key={j} className="whitespace-nowrap">{c}</span>
                            ))}
                          </div>
                        )
                      )}
                      {facts.length > 0 && (
                        <p className="text-brand-muted/60 text-[11px] leading-snug mt-0.5">
                          {facts.join(' · ')}
                        </p>
                      )}
                    </div>
                    {/* Unobtrusive "report an error" flag (top-right of the row). */}
                    <button
                      type="button"
                      aria-label={t('report.button')}
                      title={t('report.button')}
                      className="shrink-0 self-start -mr-1 -mt-0.5 p-1 text-brand-muted/35 hover:text-brand-accent transition-colors"
                      onClick={() => { hapticImpact('light'); setReporting(entry); }}
                    >
                      <IconFlag3 size={15} stroke={1.8} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Full-size photo lightbox — tap backdrop or ✕ to close. */}
        <AnimatePresence>
          {lightbox && (
            <motion.div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              onClick={() => setLightbox(null)}
            >
              <motion.img
                // The avatar stores ?width=256; ask Commons for a larger render.
                src={lightbox.replace('width=256', 'width=512')}
                alt=""
                className="max-h-[80vh] max-w-[90vw] rounded-2xl object-contain shadow-2xl"
                initial={{ scale: 0.92 }} animate={{ scale: 1 }} exit={{ scale: 0.92 }}
                transition={{ duration: 0.18 }}
                onClick={(e) => e.stopPropagation()}
              />
              <button
                className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20"
                aria-label="Закрыть"
                onClick={() => setLightbox(null)}
              >
                <IconX size={22} stroke={2} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* "Report an error" bottom sheet. */}
        <AnimatePresence>
          {reporting && (
            <ReportSheet entry={reporting} onClose={() => setReporting(null)} />
          )}
        </AnimatePresence>

        {/* Actions */}
        <div className="px-4 pb-8 pt-2 space-y-3">
          <button
            className="w-full h-14 rounded-md text-lg font-medium transition-opacity hover:opacity-90 flex items-center justify-center gap-2"
            style={{ backgroundColor: TEAM_COLOR.orange, color: '#0A0E1A' }}
            onClick={() => { hapticImpact('light'); onPlayAgain(); }}
          >
            {/* Match the game screen's IconArrowsExchange: same icon set, size 16, stroke 2 */}
            <IconReload size={16} stroke={2} />
            {t('end.play_again')}
          </button>
          <button
            className="w-full h-14 rounded-md text-lg font-medium text-white bg-brand-surface transition-colors hover:opacity-90"
            onClick={() => { hapticImpact('light'); navigate('/'); }}
          >
            {t('quick.home')}
          </button>
        </div>
      </div>
    );
  }

  // ── Game screen ─────────────────────────────────────────────────
  const catColor = currentCard ? (CATEGORY_COLOR[currentCard.category] ?? '#7A8499') : '#7A8499';
  const catLabel = currentCard
    ? (currentCard.category_ru ?? CATEGORY_LABEL_RU[currentCard.category] ?? currentCard.category)
    : '';
  // Translation -> name_en -> name, per the interface language (same rule
  // as the summary history).
  const cardName = currentCard ? cardDisplayName(currentCard, i18n.language) : '';

  return (
    <div className="min-h-screen bg-brand-bg flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-8 pb-3 border-b border-brand-border">
        <button
          className="text-brand-muted hover:text-white transition-colors text-sm p-1 -ml-1"
          onClick={() => {
            hapticImpact('heavy');
            playSound('fanfare');
            trackEvent('quick_game_end', {
              orange: scores.orange,
              blue: scores.blue,
              cards: history.length,
            });
            // Engagement: how many cards a session actually runs through.
            trackEvent('game_length', { cards: history.length });
            setFinished(true);
          }}
        >
          {t('quick.finish')}
        </button>
        <p className="text-brand-muted text-xs uppercase tracking-wider">
          {t('home.mode_training_title')}
        </p>
        <span className="w-16" />
      </div>

      {/* Score line */}
      <div className="px-4 pt-6">
        <ScoreLine orange={scores.orange} blue={scores.blue} activeTeam={activeTeam} />
      </div>

      {/* Pass turn — compact text row, no heavy button */}
      <div className="px-4 pt-3 flex justify-center">
        <button
          className="inline-flex items-center gap-1.5 text-brand-muted hover:text-white transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => { hapticImpact('light'); playSound('swipe'); passTurn(); }}
          disabled={!currentCard}
        >
          <IconArrowsExchange size={16} stroke={2} />
          {t('quick.pass_turn')}
        </button>
      </div>

      {/* Card area */}
      <div className="flex-1 flex flex-col justify-center px-4 py-4">
        <AnimatePresence mode="wait">
          {currentCard ? (
            <motion.div
              key={currentCard.id}
              initial={{ x: 64, opacity: 0 }}
              animate={{ x: 0,  opacity: 1 }}
              exit={{ x: -64,   opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeInOut' }}
            >
              {/* Word card — large, centred, surface, 6px radius, no accent strip.
                  Rarity tier adds a subtle coloured frame + glow (common → none). */}
              <div
                className="rounded-md bg-brand-surface border border-brand-border text-center px-[14px] py-[30px]"
                style={tierCardStyle(currentCard.tier)}
              >
                <span
                  className="text-[11px] uppercase tracking-widest font-medium"
                  style={{ color: catColor }}
                >
                  {catLabel}
                </span>
                <p className="text-[30px] font-medium text-white leading-snug mt-2">
                  {cardName}
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
            >
              <div className="rounded-md bg-brand-surface border border-brand-border p-10 text-center">
                <div className="text-5xl mb-4">🃏</div>
                <p className="text-brand-muted">{t('training.no_cards')}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Actions */}
      <div className="px-4 pb-8 flex gap-3">
        <button
          className="flex-1 h-14 rounded-md text-lg font-medium transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ backgroundColor: TEAM_COLOR.orange, color: '#0A0E1A' }}
          disabled={!currentCard}
          onClick={() => { hapticImpact('medium'); playSound('correct'); guess(); }}
        >
          {t('quick.guessed')}
        </button>
        <button
          className="flex-1 h-14 rounded-md text-lg font-medium text-white bg-brand-surface transition-opacity hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={!currentCard}
          onClick={() => { hapticImpact('light'); playSound('skip'); skip(); }}
        >
          {t('quick.skip')}
        </button>
      </div>
    </div>
  );
}
