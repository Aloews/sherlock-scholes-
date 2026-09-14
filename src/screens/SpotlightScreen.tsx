import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ScreenHeader } from '@/shared/ui/ScreenHeader';
import { Chip } from '@/shared/ui/Chip';
import { PlayerPhoto } from '@/shared/ui/PlayerPhoto';
import { hapticImpact } from '@/shared/lib/telegram';
import { cardDisplayName } from '@/shared/lib/cardName';
import { LOADING, dataOr, type LoadState } from '@/shared/lib/loadState';
import {
  fetchSpotlight, type SpotlightRow, type SpotlightMode,
} from '@/features/spotlight/spotlightApi';

/**
 * ГРОМКОСТЬ ПРОТИВ ИГРЫ.
 *
 * Владелец просил отделить «игроков-талантов» от «игроков-проектов» — тех,
 * кого продвигают ради стоимости, и чей талант «сложно понять».
 *
 * ⚠️ НАЗВАНИЯ НА ЭКРАНЕ — «ГРОМЧЕ, ЧЕМ ИГРАЕТ» И «ТИШЕ, ЧЕМ ИГРАЕТ», А НЕ
 * «ИГРОК-ПРОЕКТ». Разница не косметическая. «Проект» — это утверждение о
 * чужом умысле, и оно вешается на живого человека с именем и фотографией.
 * «Громче, чем играет» — это то, что мы действительно посчитали: разрыв между
 * вниманием и игрой. Первым в списке вышел Родри, обладатель «Золотого мяча»,
 * пропустивший год по травме колена: формально громче, по сути — про травму.
 *
 * ⚠️ ПРЕДУПРЕЖДЕНИЕ О ПРИЧИНАХ СТОИТ НАД СПИСКОМ, А НЕ ПОД НИМ. Под списком
 * его прочитают те, кто уже составил мнение о первых трёх именах.
 */

const MODES: SpotlightMode[] = ['loud', 'quiet'];

function Bar({ value, tint }: { value: number; tint: string }) {
  return (
    <div className="h-1 rounded-full bg-white/10 overflow-hidden w-16">
      <div className={`h-full rounded-full ${tint}`}
           style={{ width: `${Math.max(value * 100, 2)}%` }} />
    </div>
  );
}

function Row({ r, mode }: { r: SpotlightRow; mode: SpotlightMode }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const money = r.market_value_eur
    ? new Intl.NumberFormat(i18n.language, { notation: 'compact' }).format(r.market_value_eur)
    : null;

  return (
    <button
      type="button"
      onClick={() => { hapticImpact('light'); navigate(`/collection?card=${r.card_id}`); }}
      className="w-full text-left ds-panel bg-brand-surface border border-brand-border
                 rounded-2xl p-3 flex items-center gap-3 active:opacity-70 transition-opacity"
    >
      {r.photo_url
        ? <PlayerPhoto src={r.photo_url} className="w-10 h-10 rounded-full shrink-0 bg-brand-bg" />
        : <span className="w-10 h-10 rounded-full bg-brand-bg shrink-0" />}

      <div className="flex-1 min-w-0">
        <p className="text-white text-sm truncate">
          {cardDisplayName({ name: r.name, name_en: r.name_en, category: 'player' }, i18n.language)}
        </p>
        <p className="text-brand-muted text-[11px] truncate">
          {[r.club, t(`spotlight.pos.${r.player_position}`, { defaultValue: r.player_position }),
            t('spotlight.age', { count: r.age })].filter(Boolean).join(' · ')}
        </p>
        {/* ⚠️ ЧИСЛА, ИЗ КОТОРЫХ СЛОЖЕН РАЗРЫВ, — ЗДЕСЬ ЖЕ. Перцентиль без
            них непроверяем, а непроверяемое число читается как приговор. */}
        <p className="text-brand-muted text-[10.5px] tabular-nums truncate">
          {t('spotlight.played', { apps: r.apps, ga: r.goals + r.assists })}
          {money ? ` · ${money} €` : ''}
        </p>
      </div>

      <div className="shrink-0 space-y-1">
        <div className="flex items-center gap-1.5 justify-end">
          <span className="text-[9px] uppercase tracking-wider text-brand-muted w-12 text-right">
            {t('spotlight.attention')}
          </span>
          <Bar value={r.attention} tint="bg-amber-400" />
        </div>
        <div className="flex items-center gap-1.5 justify-end">
          <span className="text-[9px] uppercase tracking-wider text-brand-muted w-12 text-right">
            {t('spotlight.output')}
          </span>
          <Bar value={r.output} tint="bg-emerald-400" />
        </div>
        <p className={`text-right text-[11px] font-bold tabular-nums
                       ${mode === 'loud' ? 'text-amber-300' : 'text-emerald-300'}`}>
          {(Math.abs(r.gap) * 100).toFixed(0)}
        </p>
      </div>
    </button>
  );
}

export function SpotlightScreen() {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<SpotlightMode>('loud');
  const [rows, setRows] = useState<LoadState<SpotlightRow[]>>(LOADING);

  useEffect(() => {
    let cancelled = false;
    setRows(LOADING);
    void fetchSpotlight(mode, i18n.language, 25).then((r) => { if (!cancelled) setRows(r); });
    return () => { cancelled = true; };
  }, [mode, i18n.language]);

  const list = dataOr(rows, []);

  return (
    <div className="min-h-screen bg-brand-bg ds-screen flex flex-col">
      <ScreenHeader title={t('spotlight.title')} />

      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-3">
        <div className="flex gap-1.5">
          {MODES.map((m) => (
            <Chip key={m} selected={mode === m}
                  label={t(`spotlight.mode.${m}`)}
                  onClick={() => { hapticImpact('light'); setMode(m); }} />
          ))}
        </div>

        <p className="text-[12px] text-brand-muted leading-relaxed">
          {t(`spotlight.intro.${mode}`)}
        </p>

        {/* ⚠️ ОГОВОРКА НАД СПИСКОМ. Под ним её прочитают те, кто уже составил
            мнение о первых трёх именах. */}
        <p className="text-[11px] text-amber-300/80 leading-relaxed
                      border border-amber-300/20 rounded-xl p-2.5">
          {t('spotlight.caveat')}
        </p>

        {rows.status === 'error' && (
          <p className="text-[12px] text-rose-400">{t('spotlight.failed')}</p>
        )}
        {rows.status === 'ok' && list.length === 0 && (
          <p className="text-[12px] text-brand-muted">{t('spotlight.empty')}</p>
        )}

        {list.map((r) => <Row key={r.card_id} r={r} mode={mode} />)}

        {list.length > 0 && (
          <p className="text-[11px] text-brand-muted leading-relaxed pt-1">
            {t('spotlight.how')}
          </p>
        )}
      </div>
    </div>
  );
}
