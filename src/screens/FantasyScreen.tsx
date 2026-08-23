import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft, IconStar, IconStarFilled, IconSearch } from '@tabler/icons-react';
import { Button } from '@/shared/ui/Button';
import { Avatar } from '@/shared/ui/Avatar';
import { getRawInitData, hapticImpact, hapticError } from '@/shared/lib/telegram';
import {
  SQUAD_SIZE, fetchOpenRound, fetchCurrentRound, fetchLocksAt, fetchOptions,
  fetchMySquad, setSquad, fetchStandings,
  type FantasyOption, type SquadMember, type StandingRow,
} from '@/features/fantasy/fantasyApi';
import { LOADING, ok, dataOr, type LoadState } from '@/shared/lib/loadState';
import { dateTimeFormat } from '@/shared/lib/dateFormat';

/**
 * Фэнтези-лига: собери пятерых, назначь капитана, смотри таблицу.
 *
 * ДВА РАЗНЫХ ТУРА НА ОДНОМ ЭКРАНЕ, и это не путаница, а суть. Заявка идёт на
 * ближайший ОТКРЫТЫЙ тур (обычно следующая неделя — текущий закрылся первым
 * свистком), а таблица показывает ТЕКУЩИЙ, потому что именно он сейчас
 * набирает очки. Показывать одно вместо другого значило бы либо не дать
 * заявиться, либо показать пустую таблицу.
 *
 * ОЧКИ КАРТОЧКИ — ЗА РЕЗУЛЬТАТ ЕЁ КЛУБА, не за её действия: постатейной
 * статистики игроков нет. Правило написано на экране, чтобы это не выяснялось
 * опытным путём. Подробности — docs/FANTASY_AND_MINIGAMES.md.
 */
export function FantasyScreen() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();

  const [openRoundId, setOpenRoundId] = useState<number | null>(null);
  const [locksAt, setLocksAt] = useState<string | null>(null);
  const [options, setOptions] = useState<LoadState<FantasyOption[]>>(LOADING);
  const [picked, setPicked] = useState<string[]>([]);
  const [captain, setCaptain] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState(false);
  const [saved, setSaved] = useState(false);

  const [liveSquad, setLiveSquad] = useState<SquadMember[]>([]);
  // Отдельный признак: форма заявки — это picked/captain, а не список. Если
  // заявку не удалось прочитать, форма откроется пустой И БУДЕТ ВЫГЛЯДЕТЬ КАК
  // «состав не собран». Игрок соберёт заново и перезапишет свой же выбор.
  const [squadFailed, setSquadFailed] = useState(false);
  const [standings, setStandings] = useState<StandingRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [open, current] = await Promise.all([fetchOpenRound(), fetchCurrentRound()]);
      if (cancelled || !open) { setOptions(ok([])); return; }
      setOpenRoundId(open.id);

      const [lock, opts, mine] = await Promise.all([
        fetchLocksAt(open.id),
        fetchOptions(open.id),
        fetchMySquad(getRawInitData(), open.id),
      ]);
      if (cancelled) return;
      setLocksAt(lock);
      setOptions(opts);
      // Уже заявленный состав — это состояние формы, а не отдельный экран:
      // менять заявку до закрытия можно, и она должна открываться заполненной.
      //
      // НО ТОЛЬКО ЕСЛИ ЕЁ ДЕЙСТВИТЕЛЬНО ПРОЧИТАЛИ. Заполнять форму данными из
      // неудавшегося запроса нечем, а пустая форма здесь означает «состав не
      // собран» — и игрок соберёт его заново поверх своего же.
      setSquadFailed(mine.status === 'error');
      if (mine.status === 'ok') {
        setPicked(mine.data.map((m) => m.card_id));
        setCaptain(mine.data.find((m) => m.is_captain)?.card_id ?? null);
      }

      if (current) {
        const [squadNow, table] = await Promise.all([
          fetchMySquad(getRawInitData(), current.id),
          fetchStandings(getRawInitData(), current.id),
        ]);
        if (cancelled) return;
        setLiveSquad(dataOr(squadNow, []));
        setStandings(table);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const locked = locksAt !== null && new Date(locksAt).getTime() <= Date.now();

  const shown = useMemo(() => {
    const list = dataOr(options, []);
    const q = query.trim().toLowerCase();
    if (!q) return list.slice(0, 60);
    return list
      .filter((o) =>
        o.name.toLowerCase().includes(q) ||
        (o.name_en ?? '').toLowerCase().includes(q) ||
        o.club.toLowerCase().includes(q))
      .slice(0, 60);
  }, [options, query]);

  const toggle = (cardId: string) => {
    hapticImpact('light');
    setSaved(false);
    setPicked((prev) => {
      if (prev.includes(cardId)) {
        if (captain === cardId) setCaptain(null);
        return prev.filter((id) => id !== cardId);
      }
      if (prev.length >= SQUAD_SIZE) return prev;
      return [...prev, cardId];
    });
  };

  const save = async () => {
    if (openRoundId === null || picked.length !== SQUAD_SIZE || !captain) return;
    setSaving(true);
    const ok = await setSquad(getRawInitData(), openRoundId, picked, captain);
    setSaving(false);
    if (!ok) { setRefused(true); hapticError(); return; }
    setRefused(false);
    setSaved(true);
    hapticImpact('medium');
  };

  const lockFmt = useMemo(() => dateTimeFormat(i18n.language), [i18n.language]);

  const livePoints = liveSquad.reduce((sum, m) => sum + m.points, 0);

  return (
    <div className="min-h-screen bg-brand-bg ds-screen flex flex-col">
      <div className="flex items-center gap-3 px-4 py-4">
        <button
          type="button"
          onClick={() => { hapticImpact('light'); navigate('/'); }}
          className="text-brand-muted hover:text-white transition-colors"
          aria-label={t('home.back')}
        >
          <IconArrowLeft size={22} stroke={2} />
        </button>
        <h1 className="ds-display text-white text-xl font-black">{t('fantasy.title')}</h1>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-4">
        <p className="text-brand-muted text-[10.5px]">{t('fantasy.rules')}</p>

        {/* Текущий тур: он уже идёт и уже набирает очки. */}
        {liveSquad.length > 0 && (
          <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-3">
            <p className="text-brand-muted text-[10.5px] uppercase tracking-wider">
              {t('fantasy.this_round')}
            </p>
            <p className="ds-display text-white text-2xl font-black leading-none mt-1">{livePoints}</p>
            <div className="mt-2 space-y-1">
              {liveSquad.map((m) => (
                <div key={m.card_id} className="flex items-center gap-2 text-xs">
                  {m.is_captain && <IconStarFilled size={12} className="text-brand-accent shrink-0" />}
                  <span className="flex-1 min-w-0 truncate text-white">{m.name}</span>
                  <span className="text-brand-muted truncate max-w-[35%]">{m.club}</span>
                  <span className="ds-display text-white font-bold tabular-nums w-7 text-right">
                    {m.points}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Заявка на ближайший открытый тур. */}
        <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-3 space-y-3">
          <div>
            <p className="text-brand-muted text-[10.5px] uppercase tracking-wider">
              {t('fantasy.next_round')}
            </p>
            <p className="text-brand-muted text-xs mt-1">
              {locksAt === null
                // Пустая неделя — не закрытая: расписание до неё не дошло.
                ? t('fantasy.no_schedule')
                : locked
                  ? t('fantasy.locked')
                  : t('fantasy.locks_at', { when: lockFmt.format(new Date(locksAt)) })}
            </p>
          </div>

          <p className="text-white text-sm">
            {t('fantasy.picked_of', { n: picked.length, total: SQUAD_SIZE })}
          </p>

          {picked.length > 0 && (
            <div className="space-y-1">
              {picked.map((id) => {
                const option = dataOr(options, []).find((o) => o.card_id === id);
                return (
                  <div key={id} className="flex items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => { hapticImpact('light'); setCaptain(id); setSaved(false); }}
                      aria-label={t('fantasy.make_captain')}
                      className="shrink-0 text-brand-muted"
                      disabled={locked}
                    >
                      {captain === id
                        ? <IconStarFilled size={14} className="text-brand-accent" />
                        : <IconStar size={14} />}
                    </button>
                    <span className="flex-1 min-w-0 truncate text-white">{option?.name ?? id}</span>
                    <span className="text-brand-muted truncate max-w-[35%]">{option?.club}</span>
                    <button
                      type="button"
                      onClick={() => toggle(id)}
                      className="text-brand-muted shrink-0 px-1"
                      disabled={locked}
                      aria-label={t('fantasy.remove')}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
              {captain === null && (
                <p className="text-brand-muted text-[10.5px]">{t('fantasy.pick_captain')}</p>
              )}
            </div>
          )}

          {!locked && (
            <Button
              fullWidth
              size="sm"
              loading={saving}
              disabled={picked.length !== SQUAD_SIZE || !captain}
              onClick={() => { void save(); }}
            >
              {saved ? t('fantasy.saved') : t('fantasy.save')}
            </Button>
          )}

          {refused && <p className="text-brand-muted text-[10.5px]">{t('fantasy.refused')}</p>}
        </div>

        {/* Кого можно взять. */}
        {!locked && dataOr(options, []).length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 bg-brand-surface border border-brand-border rounded-xl px-3 h-10">
              <IconSearch size={15} stroke={2} className="text-brand-muted shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('fantasy.search')}
                className="flex-1 bg-transparent text-white text-sm focus:outline-none placeholder-brand-muted/60"
              />
            </div>

            {shown.map((option) => {
              const isPicked = picked.includes(option.card_id);
              return (
                <button
                  key={option.card_id}
                  type="button"
                  onClick={() => toggle(option.card_id)}
                  className={`w-full ds-panel border rounded-xl p-2 flex items-center gap-2 text-left transition-colors ${
                    isPicked
                      ? 'bg-brand-accent/10 border-brand-accent/50'
                      : 'bg-brand-surface border-brand-border'
                  }`}
                >
                  <Avatar name={option.name} size="sm" />
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-white text-sm">{option.name}</span>
                    <span className="block truncate text-brand-muted text-[10.5px]">{option.club}</span>
                  </span>
                  {/* Два матча в туре — вдвое больше поводов взять именно его. */}
                  {option.match_count > 1 && (
                    <span className="text-brand-accent text-[10.5px] shrink-0">
                      ×{option.match_count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Таблица по лигам, где состоит игрок. */}
        {standings.length > 0 && (
          <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-3 space-y-2">
            <p className="text-brand-muted text-[10.5px] uppercase tracking-wider">
              {t('fantasy.standings')}
            </p>
            {standings.map((row, index) => {
              const name = `${row.first_name} ${row.last_name ?? ''}`.trim();
              return (
                <div key={`${row.league_id}-${row.player_id}`} className="flex items-center gap-2">
                  <span className="ds-display text-brand-muted text-xs w-5 text-right tabular-nums">
                    {index + 1}
                  </span>
                  <Avatar name={name} src={row.avatar_url ?? undefined} size="sm" />
                  <span className="flex-1 min-w-0 truncate text-white text-sm">{name}</span>
                  <span className="ds-display text-white text-sm font-bold tabular-nums w-8 text-right">
                    {row.points}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Пустой состав правдоподобен: у тура может не быть матчей. Именно
            поэтому отказ, показанный тем же текстом, невозможно опознать — на
            этом и потерялся Челси. Теперь у поломки свой вид. */}
        {/* Заявка не прочиталась — сказать об этом ДО того, как игрок начнёт
            собирать состав заново поверх существующего. */}
        {squadFailed && (
          <p className="text-red-400/80 text-[10.5px] text-center pb-1">{t('fantasy.squad_failed')}</p>
        )}

        {options.status === 'error' && (
          <div className="ds-panel bg-brand-surface border border-brand-border rounded-2xl p-4 text-center space-y-1">
            <p className="text-brand-muted text-sm">{t('fantasy.failed')}</p>
            <p className="text-brand-muted/50 text-[10px] font-mono">{options.code}</p>
          </div>
        )}

        {options.status === 'ok' && options.data.length === 0 && (
          <p className="text-brand-muted text-sm text-center py-6">{t('fantasy.no_schedule')}</p>
        )}
      </div>
    </div>
  );
}
