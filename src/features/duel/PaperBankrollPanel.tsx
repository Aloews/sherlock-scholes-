import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LOADING, dataOr, type LoadState } from '@/shared/lib/loadState';
import { supabase } from '@/shared/lib/supabase';

interface PaperBankroll {
  initial_balance: number;
  balance: number;
  profit: number;
  roi: number;
  peak_balance: number;
  max_drawdown: number;
  settled_predictions: number;
  placed_positions: number;
  wins: number;
  win_rate: number | null;
  last_settled_at: string | null;
}

function credits(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}

export function PaperBankrollPanel({ password = null }: { password?: string | null }) {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState<PaperBankroll | null>>(LOADING);

  useEffect(() => {
    let cancelled = false;
    void supabase.rpc('llm_paper_bankroll_summary', { p_password: password })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setState({ status: 'error', error });
          return;
        }
        const row = Array.isArray(data) ? data[0] ?? null : data;
        setState({ status: 'success', data: row as PaperBankroll | null });
      });
    return () => { cancelled = true; };
  }, [password]);

  const row = dataOr(state, null);
  const stat = (label: string, value: string, valueClass = 'text-white') => (
    <div className="rounded-xl bg-white/5 p-3">
      <div className="text-[10px] uppercase tracking-wider text-brand-muted">{label}</div>
      <div className={`mt-1 text-lg font-black tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-black text-white">{t('paperBankroll.title')}</h2>
        <span className="text-[10px] uppercase tracking-wider text-brand-muted">{t('paperBankroll.virtual')}</span>
      </div>
      {state.status === 'error' ? (
        <p className="text-xs text-rose-400">{t('paperBankroll.unavailable')}</p>
      ) : !row ? (
        <p className="text-xs text-brand-muted">…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {stat(t('paperBankroll.balance'), credits(row.balance))}
            {stat(t('paperBankroll.profit'), `${row.profit > 0 ? '+' : ''}${credits(row.profit)}`, row.profit > 0 ? 'text-emerald-400' : row.profit < 0 ? 'text-rose-400' : 'text-white')}
            {stat(t('paperBankroll.roi'), row.roi == null ? '—' : `${credits(row.roi)}%`)}
            {stat(t('paperBankroll.drawdown'), `${credits(row.max_drawdown)}%`)}
            {stat(t('paperBankroll.positions'), credits(row.placed_positions))}
            {stat(t('paperBankroll.winRate'), row.win_rate == null ? '—' : `${credits(row.win_rate)}%`)}
          </div>
          <div className="text-[11px] text-brand-muted">
            {t('paperBankroll.settled', { n: row.settled_predictions })}
          </div>
        </>
      )}
    </section>
  );
}
