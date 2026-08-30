import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconPlus, IconCheck, IconLoader2, IconSearch, IconX } from '@tabler/icons-react';
import { getRawInitData, hapticImpact, hapticSuccess, hapticError } from '@/shared/lib/telegram';
import { LOADING, type LoadState } from '@/shared/lib/loadState';
import {
  fetchFanClubs, fetchJoinableClubs, joinFanClub, leaveFanClub,
  type FanClub, type JoinableClub,
} from './fanClubsApi';

/**
 * Фан-клубы — свои и чужие.
 *
 * ⚠️ КЛУБ ВЫБИРАЕТСЯ ИЗ СПИСКА, А НЕ ВВОДИТСЯ. Поле ввода здесь было бы не
 * удобнее, а сломано: `club_match_key` на сервере вырезает всё, кроме
 * [a-z0-9], поэтому «Зенит» превращается в NULL и сервер отвечает «unknown
 * club». Плюс свободный ввод завёл бы «клуб имени меня» — сервер такой
 * отобьёт, но человек увидит отказ и не поймёт, за что.
 *
 * ⚠️ «Наших онлайн» — не украшение, а смысл раздела. Знать, что у «Арсенала»
 * 40 болельщиков, бесполезно; знать, что трое из них СЕЙЧАС в приложении, —
 * повод позвать смотреть матч. Число берётся из того же присутствия.
 */
export function FanClubsPanel() {
  const { t } = useTranslation();
  const [clubs, setClubs] = useState<LoadState<FanClub[]>>(LOADING);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<LoadState<JoinableClub[]>>(LOADING);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    void fetchFanClubs(getRawInitData()).then(setClubs);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!picking) return;
    // Небольшая задержка: список из 534 клубов не нужно перезапрашивать на
    // каждую букву.
    const id = setTimeout(() => {
      void fetchJoinableClubs(getRawInitData(), query).then(setOptions);
    }, 250);
    return () => clearTimeout(id);
  }, [picking, query]);

  const act = (club: string, join: boolean) => {
    setBusy(club);
    hapticImpact('light');
    const run = join ? joinFanClub : leaveFanClub;
    void run(getRawInitData(), club)
      .then((okRes) => {
        okRes ? hapticSuccess() : hapticError();
        if (okRes) { setPicking(false); setQuery(''); load(); }
      })
      .finally(() => setBusy(null));
  };

  const mine = clubs.status === 'ok' ? clubs.data : [];

  return (
    <section className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <p className="text-brand-muted text-[10.5px] uppercase tracking-wider flex-1">
          {t('social.fan_clubs_title')}
        </p>
        <button
          type="button"
          onClick={() => { hapticImpact('light'); setPicking((v) => !v); }}
          aria-label={t(picking ? 'social.cancel' : 'social.join_club')}
          className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-brand-muted
                     hover:text-white transition-colors"
        >
          {picking ? <IconX size={15} stroke={2} /> : <IconPlus size={15} stroke={2} />}
        </button>
      </div>

      {picking && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 rounded-xl bg-brand-bg border border-brand-border px-3 py-2">
            <IconSearch size={14} stroke={2} className="text-brand-muted shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('social.search_club')}
              className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-brand-muted/60"
            />
          </div>
          {options.status === 'loading' && (
            <p className="text-brand-muted/70 text-sm">{t('social.online_loading')}</p>
          )}
          {options.status === 'ok' && options.data.length === 0 && (
            <p className="text-brand-muted/70 text-sm">{t('social.no_clubs_found')}</p>
          )}
          {options.status === 'ok' && options.data.length > 0 && (
            <ul className="space-y-1.5 max-h-56 overflow-y-auto">
              {options.data.map((c) => (
                <li key={c.club_key}>
                  <button
                    type="button"
                    onClick={() => act(c.club, true)}
                    disabled={busy === c.club}
                    className="w-full flex items-center gap-2 rounded-xl bg-brand-bg border border-brand-border
                               px-3 py-2 text-left hover:border-brand-accent/50 transition-colors disabled:opacity-50"
                  >
                    <span className="flex-1 min-w-0 text-white text-sm truncate">{c.club}</span>
                    {busy === c.club
                      ? <IconLoader2 size={14} stroke={2} className="animate-spin text-brand-muted" />
                      : <IconPlus size={14} stroke={2} className="text-brand-muted shrink-0" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {clubs.status === 'loading' && (
        <p className="text-brand-muted/70 text-sm">{t('social.online_loading')}</p>
      )}
      {clubs.status === 'error' && (
        <p className="text-red-400/80 text-[10.5px]">{t('social.online_failed')}</p>
      )}
      {clubs.status === 'ok' && mine.length === 0 && !picking && (
        <p className="text-brand-muted/70 text-sm">{t('social.fan_clubs_empty')}</p>
      )}

      {mine.length > 0 && (
        <ul className="space-y-2">
          {mine.map((c) => (
            <li
              key={c.club_key}
              className="flex items-center gap-3 rounded-xl bg-brand-bg border border-brand-border px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-white text-sm truncate">{c.club}</p>
                <p className="text-brand-muted text-[11px]">
                  {t('social.members', { count: c.members, n: c.members })}
                  {c.online > 0 && (
                    <span className="text-brand-accent">
                      {' · '}{t('social.ours_online', { count: c.online, n: c.online })}
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => act(c.club, !c.i_am_in)}
                disabled={busy === c.club}
                aria-label={t(c.i_am_in ? 'social.leave_club' : 'social.join_club')}
                className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg transition-colors
                           disabled:opacity-50 text-brand-muted hover:text-white"
              >
                {busy === c.club
                  ? <IconLoader2 size={15} stroke={2} className="animate-spin" />
                  : c.i_am_in
                    ? <IconCheck size={15} stroke={2} className="text-brand-accent" />
                    : <IconPlus size={15} stroke={2} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
