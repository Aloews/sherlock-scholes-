import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ScreenHeader } from '@/shared/ui/ScreenHeader';
import { Button } from '@/shared/ui/Button';
import { Chip } from '@/shared/ui/Chip';
import { hapticImpact } from '@/shared/lib/telegram';
import { LOADING, dataOr, type LoadState } from '@/shared/lib/loadState';
import {
  fetchMyLeagues, fetchLeagueView, createLeague, createTeam, joinTeam, leaveTeam,
  findLeagueByCode, uploadLogo, MAX_LOGO_BYTES, POSITIONS,
  type AmateurLeague, type AmateurRow, type AmateurPosition,
} from '@/features/amateur/amateurApi';

/**
 * ЛЮБИТЕЛЬСКИЕ ЛИГИ — единственный экран приложения, куда ПИШУТ.
 *
 * Владелец: «возможность добавлять любительские лиги и себя, как игрока в них,
 * загружать лого команды и лиги».
 *
 * ⚠️ ЗАПИСАТЬ МОЖНО ТОЛЬКО СЕБЯ, и это решено НЕ здесь, а в SQL: telegram_id
 * берётся из подписи, а не из поля формы. Экран не может дать записать
 * другого человека, даже если его переписать.
 *
 * ⚠️ ЛИГА ОТКРЫВАЕТСЯ ПО КОДУ, А НЕ ИЗ ОБЩЕГО СПИСКА. Двор не хочет быть в
 * каталоге, а раздел с пользовательскими названиями и картинками, открытый
 * всем, — это витрина для того, что туда напишут.
 */

function LogoButton({ kind, id, url, canEdit, onDone }: {
  kind: 'league' | 'team'; id: string; url: string | null;
  canEdit: boolean; onDone: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    // Предел проверяется и здесь, и в функции, и в корзине. Здесь — чтобы
    // сказать человеку словами вместо молчаливого отказа сети.
    if (file.size > MAX_LOGO_BYTES) { setFailed(t('amateur.logo_too_big')); return; }
    setBusy(true); setFailed(null);
    const out = await uploadLogo(kind, id, file);
    setBusy(false);
    if (out) onDone(); else setFailed(t('amateur.logo_failed'));
  };

  return (
    <div className="shrink-0">
      <label className={canEdit ? 'cursor-pointer' : ''}>
        {url
          ? <img src={url} alt="" className="w-10 h-10 rounded-xl object-cover bg-brand-bg" />
          : <span className="w-10 h-10 rounded-xl bg-brand-bg border border-brand-border
                             flex items-center justify-center text-brand-muted text-[9px]
                             text-center leading-tight px-0.5">
              {canEdit ? t('amateur.logo_add') : ''}
            </span>}
        {canEdit && (
          <input
            type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
            disabled={busy}
            onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }}
          />
        )}
      </label>
      {failed && <p className="text-rose-400 text-[9px] max-w-[4rem] leading-tight">{failed}</p>}
    </div>
  );
}

function LeagueBoard({ league, onBack }: { league: AmateurLeague; onBack: () => void }) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<LoadState<AmateurRow[]>>(LOADING);
  const [teamName, setTeamName] = useState('');
  const [myName, setMyName] = useState('');
  const [pos, setPos] = useState<AmateurPosition | null>(null);
  const [shirt, setShirt] = useState('');
  const [joining, setJoining] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    void fetchLeagueView(league.id).then(setRows);
  }, [league.id]);
  useEffect(reload, [reload]);

  const list = dataOr(rows, []);
  // Строки приходят «команда × игрок»; у пустой команды игрок null.
  const teams = new Map<string, { name: string; logo: string | null; owner: boolean; players: AmateurRow[] }>();
  for (const r of list) {
    if (!teams.has(r.team_id)) {
      teams.set(r.team_id, { name: r.team_name, logo: r.team_logo, owner: r.team_owner, players: [] });
    }
    if (r.player_id) teams.get(r.team_id)!.players.push(r);
  }

  const addTeam = async () => {
    if (!teamName.trim()) return;
    const res = await createTeam(league.id, teamName.trim());
    if (res.status === 'error') { setError(t('amateur.team_failed')); return; }
    setTeamName(''); setError(null); reload();
  };

  const join = async (teamId: string) => {
    if (!myName.trim()) { setError(t('amateur.need_name')); return; }
    const n = shirt.trim() === '' ? null : Number(shirt);
    const res = await joinTeam(teamId, myName.trim(), pos,
                              n !== null && Number.isFinite(n) ? n : null);
    if (res.status === 'error') { setError(t('amateur.join_failed')); return; }
    setJoining(null); setError(null); reload();
  };

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack}
              className="text-brand-accent text-[12px]">{t('amateur.back_to_list')}</button>

      <div className="flex items-center gap-3">
        <LogoButton kind="league" id={league.id} url={league.logo_url}
                    canEdit={league.is_owner} onDone={reload} />
        <div className="min-w-0">
          <p className="text-white ds-display font-bold truncate">{league.name}</p>
          {league.city && <p className="text-brand-muted text-[11px]">{league.city}</p>}
        </div>
      </div>

      {/* ⚠️ КОД ПОКАЗЫВАЕТСЯ ТОЛЬКО ТОМУ, КТО ЛИГУ ЗАВЁЛ. Так решает сервер:
          участнику он приходит пустым. Раздать код — значит раздать
          приглашение в чужую лигу. */}
      {league.join_code && (
        <div className="rounded-2xl border border-brand-border p-3">
          <p className="text-brand-muted text-[10px] uppercase tracking-wider">
            {t('amateur.code_title')}
          </p>
          <p className="text-white ds-display text-xl font-black tracking-[0.2em] mt-0.5">
            {league.join_code}
          </p>
          <p className="text-brand-muted text-[11px] mt-1">{t('amateur.code_how')}</p>
        </div>
      )}

      {error && <p className="text-rose-400 text-[12px]">{error}</p>}

      {[...teams.entries()].map(([id, team]) => (
        <div key={id} className="rounded-2xl bg-white/5 border border-white/10 p-3 space-y-2">
          <div className="flex items-center gap-3">
            <LogoButton kind="team" id={id} url={team.logo} canEdit={team.owner} onDone={reload} />
            <p className="text-white text-sm flex-1 min-w-0 truncate">{team.name}</p>
            <span className="text-brand-muted text-[11px] shrink-0">
              {t('amateur.squad', { count: team.players.length })}
            </span>
          </div>

          {team.players.map((p) => (
            <div key={p.player_id} className="flex items-center gap-2 text-[12px] pl-1">
              <span className="text-brand-muted w-6 tabular-nums">{p.shirt_no ?? '—'}</span>
              <span className={p.is_me ? 'text-brand-accent flex-1 truncate' : 'text-white/90 flex-1 truncate'}>
                {p.player_name}
              </span>
              {p.player_position && (
                <span className="text-brand-muted text-[10px]">
                  {t(`spotlight.pos.${p.player_position}`, { defaultValue: p.player_position })}
                </span>
              )}
              {p.is_me && (
                <button type="button" className="text-rose-400/80 text-[10px]"
                        onClick={async () => { hapticImpact('light'); await leaveTeam(id); reload(); }}>
                  {t('amateur.leave')}
                </button>
              )}
            </div>
          ))}

          {joining === id ? (
            <div className="space-y-2 pt-1">
              <input
                value={myName} onChange={(e) => setMyName(e.target.value)}
                placeholder={t('amateur.my_name')} maxLength={60}
                className="w-full h-11 rounded-xl bg-brand-bg border border-brand-border px-3
                           text-white text-sm placeholder:text-brand-muted"
              />
              <div className="flex gap-1.5 flex-wrap">
                {POSITIONS.map((p) => (
                  <Chip key={p} selected={pos === p}
                        label={t(`spotlight.pos.${p}`)}
                        onClick={() => setPos(pos === p ? null : p)} />
                ))}
              </div>
              <input
                value={shirt} onChange={(e) => setShirt(e.target.value.replace(/\D/g, '').slice(0, 2))}
                placeholder={t('amateur.shirt')} inputMode="numeric"
                className="w-24 h-11 rounded-xl bg-brand-bg border border-brand-border px-3
                           text-white text-sm placeholder:text-brand-muted tabular-nums"
              />
              <Button onClick={() => { hapticImpact('light'); void join(id); }}>
                {t('amateur.join_confirm')}
              </Button>
            </div>
          ) : (
            !team.players.some((p) => p.is_me) && (
              <button type="button"
                      onClick={() => { hapticImpact('light'); setJoining(id); setError(null); }}
                      className="text-brand-accent text-[12px]">
                {t('amateur.join_me')}
              </button>
            )
          )}
        </div>
      ))}

      <div className="rounded-2xl border border-brand-border p-3 space-y-2">
        <input
          value={teamName} onChange={(e) => setTeamName(e.target.value)}
          placeholder={t('amateur.team_name')} maxLength={60}
          className="w-full h-11 rounded-xl bg-brand-bg border border-brand-border px-3
                     text-white text-sm placeholder:text-brand-muted"
        />
        <Button onClick={() => { hapticImpact('light'); void addTeam(); }}>
          {t('amateur.team_add')}
        </Button>
      </div>
    </div>
  );
}

export function AmateurScreen() {
  const { t } = useTranslation();
  const [leagues, setLeagues] = useState<LoadState<AmateurLeague[]>>(LOADING);
  const [open, setOpen] = useState<AmateurLeague | null>(null);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => { void fetchMyLeagues().then(setLeagues); }, []);
  useEffect(reload, [reload]);

  const list = dataOr(leagues, []);
  // Открытая лига берётся из СВЕЖЕГО списка: иначе после загрузки логотипа
  // шапка показывала бы прежнюю картинку до возврата назад.
  const opened = open ? list.find((l) => l.id === open.id) ?? open : null;

  const add = async () => {
    if (!name.trim()) return;
    const res = await createLeague(name.trim(), city.trim());
    if (res.status === 'error') { setError(t('amateur.league_failed')); return; }
    setName(''); setCity(''); setError(null); reload();
  };

  const byCode = async () => {
    if (!code.trim()) return;
    const res = await findLeagueByCode(code.trim());
    if (res.status !== 'ok' || res.data.length === 0) {
      setError(t('amateur.code_not_found'));
      return;
    }
    // Найдя лигу по коду, показываем её сразу — но список «моих» пополнится
    // только когда человек запишется в команду. Иначе код давал бы членство
    // без единого действия.
    setError(null);
    setOpen({
      id: res.data[0].id, name: res.data[0].name, city: null, logo_url: null,
      join_code: null, teams: 0, players: 0, is_owner: false,
    });
  };

  return (
    <div className="min-h-screen bg-brand-bg ds-screen flex flex-col">
      <ScreenHeader title={t('amateur.title')} />
      <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-4">
        {opened ? (
          <LeagueBoard league={opened} onBack={() => { setOpen(null); reload(); }} />
        ) : (
          <>
            <p className="text-[12px] text-brand-muted leading-relaxed">{t('amateur.intro')}</p>
            {error && <p className="text-rose-400 text-[12px]">{error}</p>}

            {leagues.status === 'ok' && list.length === 0 && (
              <p className="text-[12px] text-brand-muted">{t('amateur.empty')}</p>
            )}

            {list.map((l) => (
              <button key={l.id} type="button"
                      onClick={() => { hapticImpact('light'); setOpen(l); }}
                      className="w-full text-left ds-panel bg-brand-surface border border-brand-border
                                 rounded-2xl p-3 flex items-center gap-3 active:opacity-70">
                {l.logo_url
                  ? <img src={l.logo_url} alt="" className="w-10 h-10 rounded-xl object-cover shrink-0" />
                  : <span className="w-10 h-10 rounded-xl bg-brand-bg shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm truncate">{l.name}</p>
                  <p className="text-brand-muted text-[11px] truncate">
                    {[l.city, t('amateur.teams', { count: l.teams }),
                      t('amateur.players', { count: l.players })].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </button>
            ))}

            <div className="rounded-2xl border border-brand-border p-3 space-y-2">
              <p className="text-brand-muted text-[10px] uppercase tracking-wider">
                {t('amateur.create_title')}
              </p>
              <input value={name} onChange={(e) => setName(e.target.value)}
                     placeholder={t('amateur.league_name')} maxLength={60}
                     className="w-full h-11 rounded-xl bg-brand-bg border border-brand-border px-3
                                text-white text-sm placeholder:text-brand-muted" />
              <input value={city} onChange={(e) => setCity(e.target.value)}
                     placeholder={t('amateur.league_city')} maxLength={60}
                     className="w-full h-11 rounded-xl bg-brand-bg border border-brand-border px-3
                                text-white text-sm placeholder:text-brand-muted" />
              <Button onClick={() => { hapticImpact('light'); void add(); }}>
                {t('amateur.league_add')}
              </Button>
            </div>

            <div className="rounded-2xl border border-brand-border p-3 space-y-2">
              <p className="text-brand-muted text-[10px] uppercase tracking-wider">
                {t('amateur.join_title')}
              </p>
              <input value={code}
                     onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 8))}
                     placeholder={t('amateur.code_placeholder')}
                     className="w-full h-11 rounded-xl bg-brand-bg border border-brand-border px-3
                                text-white text-sm tracking-[0.2em] placeholder:tracking-normal
                                placeholder:text-brand-muted" />
              <Button onClick={() => { hapticImpact('light'); void byCode(); }}>
                {t('amateur.code_go')}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
