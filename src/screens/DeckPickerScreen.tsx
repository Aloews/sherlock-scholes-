// The quick-game deck picker — a screen of its own.
//
// It used to be a block wedged into the middle of HomeScreen, so it
// inherited the hero: logo, tagline and quote rotator ate the top half,
// the options scrolled under the fold and the Play button sat below them,
// off screen. On top of that every control had been drawn at a different
// time — filled chips, outlined chips, bordered cards and two native
// selects, four ways of saying "this one is selected".
//
// So the layout is fixed and the vocabulary is one:
//
//   header   back · title · step bar — never scrolls
//   body     the only scrolling region
//   footer   deck size + the single primary action — never scrolls
//
//   OptionRow  one row = one choice: icon, label, description, count,
//              and the SAME check mark everywhere it is selected
//   PickChip   one chip = one toggle, for dense multi-selects
//   SelectRow  a native <select> wearing the OptionRow's clothes, so the
//              country list doesn't look like a leftover from a form
//
// State lives here rather than in HomeScreen: the picker owns the filter
// it builds and hands the finished DeckFilter back through onStart.

import { useState, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconArrowLeft, IconCheck, IconLock, IconChevronDown, IconChevronRight,
} from '@tabler/icons-react';
import { Button } from '@/shared/ui/Button';
import { countCards } from '@/features/game/cardRandomizer';
import { supabase } from '@/shared/lib/supabase';
import { countryName } from '@/shared/lib/countryName';
import { fameFloor, fameStartLevel } from '@/features/game/onboarding';
import { trackEvent } from '@/shared/lib/analytics';
import { hapticImpact } from '@/shared/lib/telegram';
import { ALL_CONTINENT_FILTERS, type CardCategory, type ContinentFilter } from '@/shared/types/database';
import {
  CATEGORY_GROUPS, DECK_LEAGUES, DECK_PRESETS, DECK_TRAITS,
  FAME_LEVELS, FAME_MIN, NON_PLAYER_CATEGORIES, normalizeFilter,
  type DeckFilter, type DeckPreset, type FameLevel,
} from '@/shared/types/deck';
import { ACCENT, PRO } from '@/shared/ui/palette';

type Step = 'presets' | 'who' | 'fame' | 'refine';
const BUILD_STEPS: Step[] = ['who', 'fame', 'refine'];

interface Props {
  isPro: boolean;
  gamesPlayed: number;
  onClose: () => void;
  onNeedPro: () => void;
  onStart: (filter: DeckFilter, presetId: string) => void;
}

// ─── Building blocks ─────────────────────────────────────────────────

/** One row = one choice. A row that TOGGLES something ends in a check
 *  circle — the only "this is on" signal on the screen. A row that ACTS
 *  (a preset starts the game) ends in a chevron instead, so the presets
 *  don't read as a list of unticked checkboxes. */
function OptionRow({
  title, description, leading, count, selected, locked, disabled, action, onClick,
}: {
  title: ReactNode;
  description?: string;
  leading?: ReactNode;
  count?: number | null;
  selected?: boolean;
  locked?: boolean;
  disabled?: boolean;
  action?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`w-full text-left rounded-2xl border p-3.5 flex items-center gap-3 transition-colors ${
        selected ? 'border-brand-accent bg-brand-accent/10' : 'border-brand-border bg-brand-surface'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : 'active:bg-brand-border/40'}`}
    >
      {leading && (
        <span className="w-10 h-10 rounded-xl bg-brand-border/60 flex items-center justify-center text-xl flex-shrink-0">
          {leading}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-white font-semibold truncate">{title}</span>
          {locked && <IconLock size={13} stroke={2.5} style={{ color: PRO }} />}
        </span>
        {description && (
          <span className="block text-brand-muted text-xs mt-0.5 leading-snug">{description}</span>
        )}
      </span>
      {count != null && count >= 0 && (
        <span className="text-brand-muted/70 text-xs tabular-nums flex-shrink-0">{count}</span>
      )}
      {action ? (
        <IconChevronRight size={18} stroke={2} className="text-brand-muted flex-shrink-0" />
      ) : (
        <span
          className={`w-5 h-5 rounded-full border flex items-center justify-center flex-shrink-0 ${
            selected ? 'border-transparent' : 'border-brand-border'
          }`}
          style={selected ? { backgroundColor: ACCENT } : undefined}
        >
          {selected && <IconCheck size={13} stroke={3} className="text-brand-bg" />}
        </span>
      )}
    </button>
  );
}

/** One toggle, for dense sets (categories, continents, traits). */
function PickChip({
  label, selected, locked, onClick,
}: { label: string; selected: boolean; locked?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 h-8 px-3 rounded-full text-xs font-medium border transition-colors ${
        selected
          ? 'border-brand-accent bg-brand-accent/15 text-white'
          : 'border-brand-border bg-brand-surface text-brand-muted active:text-white'
      }`}
    >
      {locked && <IconLock size={11} stroke={2.5} style={{ color: PRO }} />}
      {label}
    </button>
  );
}

/** A native select dressed as an OptionRow — same height, same radius,
 *  same border, so the country list doesn't read as a stray form field. */
function SelectRow({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  const active = value !== '';
  return (
    <div
      className={`relative rounded-2xl border ${
        active ? 'border-brand-accent bg-brand-accent/10' : 'border-brand-border bg-brand-surface'
      }`}
    >
      <select
        value={value}
        onChange={(e) => { hapticImpact('light'); onChange(e.target.value); }}
        className="w-full h-[52px] bg-transparent pl-3.5 pr-10 text-sm text-white appearance-none focus:outline-none"
      >
        <option value="">{label}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <IconChevronDown
        size={16} stroke={2}
        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-brand-muted pointer-events-none"
      />
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-white text-lg font-bold leading-tight">{title}</h2>
        {hint && <p className="text-brand-muted text-xs leading-snug">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

// ─── The screen ──────────────────────────────────────────────────────

export function DeckPickerScreen({ isPro, gamesPlayed, onClose, onNeedPro, onStart }: Props) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.slice(0, 2);

  const [step, setStep] = useState<Step>('presets');
  const [withPlayers, setWithPlayers] = useState(true);
  const [selCats, setSelCats] = useState<Set<CardCategory>>(new Set(NON_PLAYER_CATEGORIES));
  // Onboarding PRE-SELECTS a recognizability step instead of applying an
  // invisible floor on top of one, so the highlighted label, the counter
  // and the dealt deck always describe the same deck.
  const [fameLevel, setFameLevel] = useState<FameLevel>(() => fameStartLevel(gamesPlayed));
  const [selConts, setSelConts] = useState<Set<ContinentFilter>>(new Set());
  const [selTraits, setSelTraits] = useState<Set<string>>(new Set());
  const [selCountry, setSelCountry] = useState('');
  const [selLeague, setSelLeague] = useState('');
  const [countryOpts, setCountryOpts] = useState<string[] | null>(null);

  const [deckCount, setDeckCount] = useState<number | null>(null);
  const [presetCounts, setPresetCounts] = useState<Record<string, number> | null>(null);
  const [fameCounts, setFameCounts] = useState<Record<string, number> | null>(null);

  // ── The filter under construction ────────────────────────────────
  // Player-only dimensions are dropped when players are not in the deck,
  // so they can never silently shrink a clubs-only game.
  const selectedCats: CardCategory[] = [
    ...(withPlayers ? (['player'] as CardCategory[]) : []),
    ...NON_PLAYER_CATEGORIES.filter((c) => selCats.has(c)),
  ];
  const everything = withPlayers && selCats.size === NON_PLAYER_CATEGORIES.length;

  const filter: DeckFilter = normalizeFilter({
    categories: everything ? null : selectedCats,
    continents: withPlayers && selConts.size ? [...selConts] : null,
    countries:  withPlayers && selCountry ? [selCountry] : null,
    leagues:    withPlayers && selLeague ? [selLeague] : null,
    tags:       withPlayers && selTraits.size ? [...selTraits] : null,
    fame_min:   FAME_MIN[fameLevel],
    lang,
  });

  // Onboarding easing for the one-tap presets, which have no fame step to
  // show it in: whoever asks for more fame wins.
  const onboardingFloor = fameFloor(gamesPlayed);
  const withFloor = (f: DeckFilter): DeckFilter => normalizeFilter({
    ...f, lang, fame_min: Math.max(f.fame_min ?? 0, onboardingFloor),
  });

  const nothingSelected = selectedCats.length === 0;
  const filterKey = JSON.stringify(filter);

  const steps = withPlayers ? BUILD_STEPS : BUILD_STEPS.filter((s) => s !== 'refine');
  const stepIndex = steps.indexOf(step);
  const isLastStep = stepIndex === steps.length - 1;

  // ── Counts: every number on screen comes from count_deck, the RPC the
  // game deals from ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setDeckCount(null);
    const handle = setTimeout(() => {
      countCards(JSON.parse(filterKey) as DeckFilter)
        .then((n) => { if (!cancelled) setDeckCount(n); });
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [filterKey]);

  useEffect(() => {
    if (presetCounts) return;
    let cancelled = false;
    Promise.all(DECK_PRESETS.map(async (preset) => {
      // Counted WITH the onboarding floor: a preset must not advertise
      // 3364 cards and hand a newcomer 500.
      const n = await countCards({
        ...preset.filter, lang,
        fame_min: Math.max(preset.filter.fame_min ?? 0, onboardingFloor),
      });
      return [preset.id, n ?? -1] as const;
    })).then((entries) => {
      if (!cancelled) setPresetCounts(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [presetCounts, lang, onboardingFloor]);

  useEffect(() => {
    if (step !== 'fame') return;
    let cancelled = false;
    const base = JSON.parse(filterKey) as DeckFilter;
    Promise.all(FAME_LEVELS.map(async (level) => {
      const n = await countCards({ ...base, fame_min: FAME_MIN[level] });
      return [level, n ?? -1] as const;
    })).then((entries) => {
      if (!cancelled) setFameCounts(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [step, filterKey]);

  // Country options come from the deck. Leagues do NOT: they are the fixed
  // DECK_LEAGUES list, because deriving that list from live data is how
  // "FA Cup" and "Friendlies Clubs" got into the old dropdown.
  useEffect(() => {
    if (countryOpts) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('cards').select('country')
        .eq('active', true).eq('category', 'player').not('country', 'is', null);
      if (cancelled || !data) return;
      setCountryOpts([...new Set(data.map((r) => r.country).filter(Boolean) as string[])]);
    })().catch(() => { if (!cancelled) setCountryOpts([]); });
    return () => { cancelled = true; };
  }, [countryOpts]);

  // ── Actions ──────────────────────────────────────────────────────
  const toggleCategory = (cat: CardCategory) => {
    hapticImpact('light');
    setSelCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else { next.add(cat); trackEvent('category_selected', { kind: 'category', value: cat }); }
      return next;
    });
  };

  const toggleGroup = (cats: CardCategory[]) => {
    hapticImpact('light');
    setSelCats((prev) => {
      const next = new Set(prev);
      const anyOn = cats.some((c) => next.has(c));
      cats.forEach((c) => (anyOn ? next.delete(c) : next.add(c)));
      return next;
    });
  };

  const toggleContinent = (value: ContinentFilter) => {
    hapticImpact('light');
    setSelConts((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else { next.add(value); trackEvent('category_selected', { kind: 'continent', value }); }
      return next;
    });
  };

  // Pro-only traits open the Pro screen instead of selecting — the server
  // strips them anyway (deck_sanitize_filter).
  const toggleTrait = (tag: string, pro?: boolean) => {
    if (pro && !isPro) { hapticImpact('light'); onNeedPro(); return; }
    hapticImpact('light');
    setSelTraits((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else { next.add(tag); trackEvent('category_selected', { kind: pro ? 'pro_tag' : 'tag', value: tag }); }
      return next;
    });
  };

  const reset = () => {
    hapticImpact('light');
    setWithPlayers(true);
    setSelCats(new Set(NON_PLAYER_CATEGORIES));
    setFameLevel(fameStartLevel(gamesPlayed));
    setSelConts(new Set());
    setSelTraits(new Set());
    setSelCountry('');
    setSelLeague('');
    setFameCounts(null);
  };

  const startPreset = (preset: DeckPreset) => {
    if (preset.pro && !isPro) { hapticImpact('light'); onNeedPro(); return; }
    hapticImpact('light');
    onStart(withFloor(preset.filter), preset.id);
  };

  const goNext = () => {
    hapticImpact('light');
    const next = steps[stepIndex + 1];
    if (next) setStep(next);
    else onStart(filter, 'custom');
  };

  const goBack = () => {
    hapticImpact('light');
    if (step === 'presets') onClose();
    else setStep(stepIndex <= 0 ? 'presets' : steps[stepIndex - 1]);
  };

  const onPresets = step === 'presets';

  return (
    <div className="min-h-screen h-screen bg-brand-bg flex flex-col">
      {/* Header — fixed. A back arrow, the title, and the step bar. */}
      <header className="flex-shrink-0 px-4 pt-8 pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={goBack}
            aria-label={t('home.back')}
            className="w-10 h-10 -ml-2 flex items-center justify-center rounded-xl text-brand-muted active:text-white"
          >
            <IconArrowLeft size={20} stroke={2} />
          </button>
          <h1 className="text-white font-bold flex-1 truncate">
            {onPresets ? t('home.mode_training_title') : t('home.build_own')}
          </h1>
          {!onPresets && (
            <button
              onClick={reset}
              className="text-brand-muted text-xs px-2 py-1 active:text-white"
            >
              {t('home.reset')}
            </button>
          )}
        </div>

        {!onPresets && (
          <div className="flex gap-1.5 mt-3" aria-label={t('home.step_of', { n: stepIndex + 1, total: steps.length })}>
            {steps.map((s, i) => (
              <span
                key={s}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  i <= stepIndex ? 'bg-brand-accent' : 'bg-brand-border'
                }`}
              />
            ))}
          </div>
        )}
      </header>

      {/* Body — the only scrolling region. */}
      <main className="flex-1 overflow-y-auto px-4 pt-2 pb-4 space-y-6">
        {onPresets && (
          <Section title={t('home.picker_title')}>
            <div className="space-y-2">
              {DECK_PRESETS.map((preset) => {
                const n = presetCounts?.[preset.id];
                const locked = !!preset.pro && !isPro;
                return (
                  <OptionRow
                    key={preset.id}
                    leading={preset.emoji}
                    title={t(preset.labelKey)}
                    description={t(preset.descKey)}
                    count={n}
                    locked={locked}
                    disabled={n === 0 && !locked}
                    action
                    onClick={() => startPreset(preset)}
                  />
                );
              })}
            </div>
          </Section>
        )}

        {step === 'who' && (
          <>
            <Section title={t('home.step_who')}>
              <OptionRow
                leading="⚽"
                title={t('category.player')}
                description={t('home.who_players_desc')}
                selected={withPlayers}
                onClick={() => { hapticImpact('light'); setWithPlayers((v) => !v); }}
              />
            </Section>

            {CATEGORY_GROUPS.map((group) => {
              const on = group.categories.filter((c) => selCats.has(c)).length;
              return (
                <section key={group.id} className="space-y-2">
                  <button
                    onClick={() => toggleGroup(group.categories)}
                    className="w-full flex items-center justify-between active:opacity-70"
                  >
                    <span className="text-white text-sm font-semibold">{t(group.labelKey)}</span>
                    <span className={`text-xs tabular-nums rounded-full px-2 py-0.5 border ${
                      on ? 'border-brand-accent/40 text-white bg-brand-accent/10' : 'border-brand-border text-brand-muted'
                    }`}>
                      {on}/{group.categories.length}
                    </span>
                  </button>
                  <div className="flex flex-wrap gap-1.5">
                    {group.categories.map((cat) => (
                      <PickChip
                        key={cat}
                        label={t(`category.${cat}`)}
                        selected={selCats.has(cat)}
                        onClick={() => toggleCategory(cat)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </>
        )}

        {step === 'fame' && (
          <Section title={t('home.step_fame')} hint={t('home.step_fame_hint')}>
            <div className="space-y-2">
              {FAME_LEVELS.map((level) => (
                <OptionRow
                  key={level}
                  title={t(`home.fame_${level}`)}
                  description={t(`home.fame_${level}_desc`)}
                  count={fameCounts?.[level]}
                  selected={fameLevel === level}
                  onClick={() => {
                    hapticImpact('light');
                    setFameLevel(level);
                    trackEvent('category_selected', { kind: 'fame', value: level });
                  }}
                />
              ))}
            </div>
          </Section>
        )}

        {step === 'refine' && (
          <>
            <Section title={t('home.step_refine')}>
              <div className="space-y-2">
                <p className="text-brand-muted text-xs">{t('home.refine_continent')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {ALL_CONTINENT_FILTERS.map((cont) => (
                    <PickChip
                      key={cont}
                      label={t(`home.continent_${cont}`)}
                      selected={selConts.has(cont)}
                      onClick={() => toggleContinent(cont)}
                    />
                  ))}
                </div>
              </div>
            </Section>

            <section className="space-y-2">
              <p className="text-brand-muted text-xs">{t('home.refine_traits')}</p>
              <div className="flex flex-wrap gap-1.5">
                {DECK_TRAITS.map((trait) => (
                  <PickChip
                    key={trait.tag}
                    label={t(trait.labelKey)}
                    selected={selTraits.has(trait.tag)}
                    locked={!!trait.pro && !isPro}
                    onClick={() => toggleTrait(trait.tag, trait.pro)}
                  />
                ))}
              </div>
            </section>

            <section className="space-y-2">
              {!!countryOpts?.length && (
                <SelectRow
                  label={t('home.filter_all_countries')}
                  value={selCountry}
                  onChange={setSelCountry}
                  options={countryOpts
                    .map((iso) => ({ value: iso, label: countryName(iso, i18n.language) || iso }))
                    .sort((a, b) => a.label.localeCompare(b.label, i18n.language))}
                />
              )}
              <SelectRow
                label={t('home.filter_all_leagues')}
                value={selLeague}
                onChange={setSelLeague}
                options={DECK_LEAGUES.map((lg) => ({
                  value: lg, label: t(`league.${lg}`, { defaultValue: lg }),
                }))}
              />
            </section>
          </>
        )}
      </main>

      {/* Footer — fixed. The deck size and the one action, always reachable. */}
      {!onPresets && (
        <footer className="flex-shrink-0 px-4 pt-3 pb-6 border-t border-brand-border bg-brand-surface/40 backdrop-blur space-y-3">
          <p className="text-center text-sm text-brand-muted" aria-live="polite">
            {nothingSelected
              ? t('home.pick_something')
              : deckCount === null
                ? t('home.counting')
                : t('home.deck_size', { count: deckCount })}
          </p>
          <Button
            fullWidth
            size="lg"
            disabled={nothingSelected || deckCount === 0}
            onClick={goNext}
          >
            {isLastStep ? t('home.play') : t('home.next')}
          </Button>
        </footer>
      )}

      {onPresets && (
        <footer className="flex-shrink-0 px-4 pt-3 pb-6 border-t border-brand-border bg-brand-surface/40 backdrop-blur">
          <Button fullWidth size="lg" variant="secondary" onClick={() => { hapticImpact('light'); setStep('who'); }}>
            {t('home.build_own')}
          </Button>
        </footer>
      )}
    </div>
  );
}
