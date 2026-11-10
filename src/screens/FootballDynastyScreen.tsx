import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IconArrowLeft, IconCrown, IconBuildingStadium, IconUsers, IconCalendarEvent, IconCoins, IconPlus, IconHourglass } from '@tabler/icons-react';
import {
  advanceCampaign, createCampaign, createHeir, executeSuccession, getCampaign,
  listCampaigns, previewSuccession, type CampaignSummary, type CampaignView, type Character,
} from '@/features/football-dynasty/api';

const inputClass = 'w-full rounded-xl border border-brand-border bg-brand-bg px-3 py-2.5 text-sm text-white outline-none focus:border-brand-accent';
const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-xl bg-brand-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50';
const quietButtonClass = 'inline-flex items-center justify-center gap-2 rounded-xl border border-brand-border bg-brand-surface px-4 py-2.5 text-sm text-white transition hover:border-brand-accent/60 disabled:opacity-50';

export function FootballDynastyScreen() {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [campaign, setCampaign] = useState<CampaignView | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [candidates, setCandidates] = useState<Character[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [founderName, setFounderName] = useState('');
  const [dynastyName, setDynastyName] = useState('');
  const [clubName, setClubName] = useState('');
  const [origin, setOrigin] = useState('entrepreneur');
  const [mode, setMode] = useState<'sandbox' | 'scenario'>('sandbox');
  const [heirName, setHeirName] = useState('');
  const [heirAge, setHeirAge] = useState(16);

  const refreshCampaigns = useCallback(async () => {
    const rows = await listCampaigns();
    setCampaigns(rows);
    setSelectedId((current) => current || rows[0]?.id || '');
  }, []);

  const refreshSelected = useCallback(async (id: string) => {
    const data = await getCampaign(id);
    setCampaign(data);
    setCandidates(data.campaign.status === 'succession_pending' ? await previewSuccession(id) : []);
  }, []);

  useEffect(() => {
    let active = true;
    setBusy('loading');
    listCampaigns()
      .then((rows) => {
        if (!active) return;
        setCampaigns(rows);
        setSelectedId(rows[0]?.id ?? '');
      })
      .catch(() => { if (active) setError(t('dynasty.error')); })
      .finally(() => { if (active) setBusy(''); });
    return () => { active = false; };
  }, [t]);

  useEffect(() => {
    if (!selectedId) { setCampaign(null); return; }
    let active = true;
    setBusy('loading');
    getCampaign(selectedId)
      .then(async (data) => {
        if (!active) return;
        setCampaign(data);
        const heirs = data.campaign.status === 'succession_pending' ? await previewSuccession(selectedId) : [];
        if (active) setCandidates(heirs);
      })
      .catch(() => { if (active) setError(t('dynasty.error')); })
      .finally(() => { if (active) setBusy(''); });
    return () => { active = false; };
  }, [selectedId, t]);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError('');
    try { await action(); }
    catch { setError(t('dynasty.error')); }
    finally { setBusy(''); }
  };

  const submitCampaign = () => run('create', async () => {
    const created = await createCampaign({
      name: campaignName, mode, origin, founder_name: founderName,
      dynasty_name: dynastyName, club_name: clubName,
    });
    await refreshCampaigns();
    setSelectedId(created.id);
    setShowCreate(false);
  });

  const submitHeir = () => {
    if (!campaign || !heirName.trim()) return;
    void run('heir', async () => {
      await createHeir(campaign.campaign.id, { name: heirName.trim(), age: heirAge });
      setHeirName('');
      await refreshSelected(campaign.campaign.id);
    });
  };

  const advance = () => {
    if (!campaign) return;
    void run('advance', async () => {
      await advanceCampaign(campaign.campaign.id, 10);
      await refreshSelected(campaign.campaign.id);
      await refreshCampaigns();
    });
  };

  const inherit = (heirId: string) => {
    if (!campaign) return;
    void run('succession', async () => {
      await executeSuccession(campaign.campaign.id, heirId);
      await refreshSelected(campaign.campaign.id);
      await refreshCampaigns();
    });
  };

  const formatMoney = useMemo(() => new Intl.NumberFormat(i18n.language, {
    style: 'currency', currency: 'EUR', maximumFractionDigits: 0,
  }), [i18n.language]);

  const statusLabel = (status: string) => {
    if (status === 'active') return t('dynasty.active');
    if (status === 'succession_pending') return t('dynasty.succession_pending');
    if (status === 'ended_no_heir') return t('dynasty.no_heirs');
    return status;
  };
  const currentPlayer = campaign?.characters.find((person) => person.id === campaign.player_character_id) ?? campaign?.founder;

  return (
    <main className="min-h-screen bg-brand-bg px-4 pb-12 pt-5 text-white sm:px-6">
      <div className="mx-auto max-w-5xl">
        <header className="mb-7 flex items-center justify-between gap-3">
          <button type="button" onClick={() => navigate('/')} className="inline-flex items-center gap-2 text-sm text-brand-muted hover:text-white">
            <IconArrowLeft size={18} /> {t('dynasty.back')}
          </button>
          <div className="flex items-center gap-2 rounded-full border border-brand-border bg-brand-surface px-3 py-2 text-xs text-brand-muted">
            <IconCrown size={16} className="text-brand-accent" /> Football Dynasty
          </div>
        </header>

        <section className="mb-7">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-brand-accent">Sherlock Scholes</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{t('dynasty.title')}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-brand-muted">{t('dynasty.subtitle')}</p>
        </section>

        {error && <div role="alert" className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t('dynasty.my_campaigns')}</h2>
          <button type="button" className={quietButtonClass} onClick={() => setShowCreate((value) => !value)}>
            <IconPlus size={16} /> {t('dynasty.new_campaign')}
          </button>
        </div>

        {showCreate && (
          <section className="mb-7 rounded-2xl border border-brand-border bg-brand-surface p-4 sm:p-6">
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-brand-muted">{t('dynasty.campaign_name')}
                <input className={inputClass} value={campaignName} onChange={(e) => setCampaignName(e.target.value)} maxLength={64} />
              </label>
              <label className="text-xs text-brand-muted">{t('dynasty.founder_name')}
                <input className={inputClass} value={founderName} onChange={(e) => setFounderName(e.target.value)} maxLength={80} />
              </label>
              <label className="text-xs text-brand-muted">{t('dynasty.dynasty_name')}
                <input className={inputClass} value={dynastyName} onChange={(e) => setDynastyName(e.target.value)} maxLength={64} />
              </label>
              <label className="text-xs text-brand-muted">{t('dynasty.club_name')}
                <input className={inputClass} value={clubName} onChange={(e) => setClubName(e.target.value)} maxLength={64} />
              </label>
              <label className="text-xs text-brand-muted">{t('dynasty.origin')}
                <select className={inputClass} value={origin} onChange={(e) => setOrigin(e.target.value)}>
                  <option value="football_family">{t('dynasty.origin_football_family')}</option>
                  <option value="entrepreneur">{t('dynasty.origin_entrepreneur')}</option>
                  <option value="former_player">{t('dynasty.origin_former_player')}</option>
                  <option value="agent">{t('dynasty.origin_agent')}</option>
                  <option value="executive">{t('dynasty.origin_executive')}</option>
                  <option value="newcomer">{t('dynasty.origin_newcomer')}</option>
                </select>
              </label>
              <label className="text-xs text-brand-muted">{t('dynasty.campaign_mode')}
                <select className={inputClass} value={mode} onChange={(e) => setMode(e.target.value as 'sandbox' | 'scenario')}>
                  <option value="sandbox">{t('dynasty.sandbox')}</option>
                  <option value="scenario">{t('dynasty.scenario')}</option>
                </select>
              </label>
            </div>
            <button type="button" className={buttonClass} onClick={submitCampaign} disabled={busy !== '' || !campaignName.trim() || !founderName.trim() || !dynastyName.trim() || !clubName.trim()}>
              {busy === 'create' ? t('dynasty.loading') : t('dynasty.create')}
            </button>
          </section>
        )}

        {campaigns.length > 0 && (
          <div className="mb-6 flex gap-2 overflow-x-auto pb-2">
            {campaigns.map((item) => (
              <button key={item.id} type="button" onClick={() => setSelectedId(item.id)}
                className={`shrink-0 rounded-xl border px-3 py-2 text-left text-sm transition ${selectedId === item.id ? 'border-brand-accent bg-brand-accent/10 text-white' : 'border-brand-border bg-brand-surface text-brand-muted'}`}>
                <span className="block font-medium">{item.name}</span>
                <span className="text-xs">{item.current_year} · {statusLabel(item.status)}</span>
              </button>
            ))}
          </div>
        )}

        {!campaign && !showCreate && campaigns.length === 0 && busy !== 'loading' && (
          <section className="rounded-2xl border border-dashed border-brand-border bg-brand-surface/50 p-8 text-center">
            <IconCrown size={34} className="mx-auto mb-3 text-brand-accent" />
            <h2 className="text-lg font-semibold">{t('dynasty.no_campaigns')}</h2>
            <button type="button" className={`${buttonClass} mt-4`} onClick={() => setShowCreate(true)}>{t('dynasty.create')}</button>
          </section>
        )}

        {busy === 'loading' && <p className="py-8 text-center text-sm text-brand-muted">{t('dynasty.loading')}</p>}

        {campaign && currentPlayer && (
          <>
            <section className="mb-6 rounded-2xl border border-brand-border bg-brand-surface p-4 sm:p-6">
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-semibold">{campaign.dynasty.name}</h2>
                  <p className="mt-1 text-sm text-brand-muted">{campaign.campaign.name} · {campaign.campaign.current_year}</p>
                </div>
                <span className="rounded-full border border-brand-accent/30 bg-brand-accent/10 px-3 py-1 text-xs text-brand-accent">{statusLabel(campaign.campaign.status)}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl bg-brand-bg p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs text-brand-muted"><IconUsers size={15} /> {t('dynasty.family')}</div>
                  <div className="font-semibold">{campaign.dynasty.name}</div>
                  <div className="mt-1 text-xs text-brand-muted">{currentPlayer.full_name} · {t('dynasty.age')}: {currentPlayer.age}</div>
                </div>
                <div className="rounded-xl bg-brand-bg p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs text-brand-muted"><IconBuildingStadium size={15} /> {t('dynasty.club')}</div>
                  <div className="font-semibold">{campaign.clubs[0]?.name ?? '—'}</div>
                  <div className="mt-1 text-xs text-brand-muted">{campaign.clubs[0]?.city ?? ''}</div>
                </div>
                <div className="rounded-xl bg-brand-bg p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs text-brand-muted"><IconCoins size={15} /> {t('dynasty.cash')}</div>
                  <div className="font-semibold">{formatMoney.format(campaign.cash_accounts.reduce((sum, account) => sum + account.balance_minor, 0) / 100)}</div>
                  <div className="mt-1 text-xs text-brand-muted">{campaign.cash_accounts.length} {t('dynasty.accounts')}</div>
                </div>
              </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
              <section className="rounded-2xl border border-brand-border bg-brand-surface p-4 sm:p-6">
                <h3 className="mb-4 text-lg font-semibold">{t('dynasty.family')}</h3>
                <div className="space-y-3">
                  {campaign.characters.map((character) => (
                    <div key={character.id} className="flex items-center justify-between gap-3 rounded-xl bg-brand-bg px-3 py-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{character.full_name}</div>
                        <div className="mt-1 text-xs text-brand-muted">{t('dynasty.age')}: {character.age} · {character.life_status === 'alive' ? t('dynasty.alive') : t('dynasty.deceased')}</div>
                      </div>
                      {character.is_heir && <span className="rounded-full bg-brand-accent/10 px-2 py-1 text-xs text-brand-accent">{t('dynasty.heir')}</span>}
                    </div>
                  ))}
                </div>

                {campaign.campaign.status === 'active' && (
                  <div className="mt-5 border-t border-brand-border pt-5">
                    <h4 className="mb-3 font-semibold">{t('dynasty.add_heir')}</h4>
                    <div className="grid gap-3 sm:grid-cols-[1fr_110px_auto]">
                      <input className={inputClass} placeholder={t('dynasty.heir_name')} value={heirName} onChange={(e) => setHeirName(e.target.value)} />
                      <input className={inputClass} type="number" min={0} max={70} value={heirAge} onChange={(e) => setHeirAge(Number(e.target.value))} aria-label={t('dynasty.heir_age')} />
                      <button type="button" className={buttonClass} disabled={busy !== '' || !heirName.trim()} onClick={submitHeir}>{busy === 'heir' ? t('dynasty.loading') : t('dynasty.save_heir')}</button>
                    </div>
                    <button type="button" className={`${quietButtonClass} mt-4`} disabled={busy !== ''} onClick={advance}>
                      <IconHourglass size={16} /> {busy === 'advance' ? t('dynasty.loading') : t('dynasty.advance')}
                    </button>
                  </div>
                )}

                {campaign.campaign.status === 'succession_pending' && (
                  <div className="mt-5 border-t border-brand-border pt-5">
                    <h4 className="mb-3 font-semibold">{t('dynasty.succession_title')}</h4>
                    {candidates.length === 0
                      ? <p className="text-sm text-brand-muted">{t('dynasty.no_heirs')}</p>
                      : candidates.map((heir) => (
                        <div key={heir.id} className="mb-2 flex items-center justify-between gap-3 rounded-xl bg-brand-bg p-3">
                          <div><div className="font-medium">{heir.full_name}</div><div className="text-xs text-brand-muted">{t('dynasty.age')}: {heir.age}</div></div>
                          <button type="button" className={buttonClass} disabled={busy !== ''} onClick={() => inherit(heir.id)}>{busy === 'succession' ? t('dynasty.loading') : t('dynasty.complete_succession')}</button>
                        </div>
                      ))}
                  </div>
                )}
              </section>

              <section className="rounded-2xl border border-brand-border bg-brand-surface p-4 sm:p-6">
                <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold"><IconCalendarEvent size={18} /> {t('dynasty.chronicle')}</h3>
                <div className="space-y-3">
                  {campaign.chronicle.map((event) => (
                    <div key={event.id} className="border-l-2 border-brand-accent/50 pl-3">
                      <div className="text-xs text-brand-accent">{event.game_year}</div>
                      <div className="mt-1 text-sm">{event.title}</div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
