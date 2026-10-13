import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LOADING, dataOr, type LoadState } from '@/shared/lib/loadState';
import { supabase } from '@/shared/lib/supabase';
import type { Outcome } from './forecastApi';

interface ExpressLeg {
  fixture_id: string;
  commence_at: string;
  sport_key: string;
  home_team: string;
  away_team: string;
  pick: Outcome;
  price: number;
  fair_prob: number;
  books: number;
  edge: number;
}

interface ExpressPortfolio {
  profile: 'safe' | 'diverse' | 'value';
  leg_count: number;
  fair_probability: number;
  combined_odds: number;
  expected_return: number;
  historical_tickets: number;
  historical_wins: number;
  historical_hit_rate: number | null;
  legs: ExpressLeg[];
}

const PICK: Record<Outcome, string> = { H: '1', D: 'X', A: '2' };

function pct(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(1)}%`;
}

function num(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

export function BestExpressesPanel({ password = null }: { password?: string | null }) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState<LoadState<ExpressPortfolio[]>>(LOADING);

  useEffect(() => {
    let cancelled = false;
    if (!password) {
      setState({ status: 'ok', data: [] });
      return () => { cancelled = true; };
    }
    void supabase.rpc('admin_diverse_accumulators', {
      p_password: password,
      p_hours: 168,
    }).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setState({ status: 'error', code: error.code ?? 'unknown' });
        return;
      }
      setState({ status: 'ok', data: (Array.isArray(data) ? data : []) as ExpressPortfolio[] });
    });
    return () => { cancelled = true; };
  }, [password]);

  if (!password) return null;

  const rows = dataOr(state, []);
  const labels: Record<ExpressPortfolio['profile'], string> = {
    safe: t('expressPortfolio.safe'),
    diverse: t('expressPortfolio.diverse'),
    value: t('expressPortfolio.value'),
  };

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-black text-white">{t('expressPortfolio.title')}</h2>
        <p className="text-[11px] leading-relaxed text-brand-muted">{t('expressPortfolio.subtitle')}</p>
      </div>

      {state.status === 'error' ? (
        <p className="text-xs text-rose-400">{t('expressPortfolio.unavailable')}</p>
      ) : state.status === 'loading' ? (
        <p className="text-xs text-brand-muted">…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-brand-muted">{t('expressPortfolio.empty')}</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <article key={row.profile} className="rounded-xl border border-white/10 bg-black/10 p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-xs font-bold text-white">{labels[row.profile]}</h3>
                  <p className="text-[10px] text-brand-muted">
                    {t('expressPortfolio.history', {
                      wins: row.historical_wins,
                      total: row.historical_tickets,
                      rate: row.historical_hit_rate == null ? '—' : pct(row.historical_hit_rate / 100),
                    })}
                  </p>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <div className="text-lg font-black text-white">{num(row.combined_odds)}</div>
                  <div className="text-[10px] text-brand-muted">{t('expressPortfolio.odds')}</div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-white/5 p-2">
                  <div className="text-sm font-bold text-white tabular-nums">{pct(row.fair_probability)}</div>
                  <div className="text-[9px] text-brand-muted">{t('expressPortfolio.probability')}</div>
                </div>
                <div className="rounded-lg bg-white/5 p-2">
                  <div className={`text-sm font-bold tabular-nums ${row.expected_return >= 1 ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {pct(row.expected_return)}
                  </div>
                  <div className="text-[9px] text-brand-muted">{t('expressPortfolio.expectedReturn')}</div>
                </div>
                <div className="rounded-lg bg-white/5 p-2">
                  <div className="text-sm font-bold text-white tabular-nums">{row.leg_count}</div>
                  <div className="text-[9px] text-brand-muted">{t('expressPortfolio.legs')}</div>
                </div>
              </div>

              <div className="space-y-2">
                {row.legs.map((leg) => (
                  <div key={leg.fixture_id} className="flex items-start justify-between gap-3 border-t border-white/5 pt-2">
                    <div className="min-w-0">
                      <div className="text-[11px] text-white leading-snug">{leg.home_team} — {leg.away_team}</div>
                      <div className="text-[10px] text-brand-muted">
                        {new Date(leg.commence_at).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' })}
                        {' · '}{leg.sport_key.replace(/^soccer_/, '').replaceAll('_', ' ')}
                        {' · '}{t('expressPortfolio.books', { n: leg.books })}
                      </div>
                    </div>
                    <div className="shrink-0 text-right tabular-nums">
                      <div className="text-xs font-bold text-white">{PICK[leg.pick]} · {num(leg.price)}</div>
                      <div className="text-[10px] text-brand-muted">{pct(leg.fair_prob)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="text-[10px] leading-relaxed text-brand-muted">{t('expressPortfolio.disclaimer')}</p>
    </section>
  );
}
