import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  staffVerify, adminSearchCards, adminSaveCard, adminDeleteCard, adminGetCard,
  modListReports, modResolveReports, modFlagCandidate,
  buildForbiddenWords, type CardInput, type StaffRole, type CardReportGroup,
} from '@/features/admin/adminApi';
import { wakeSupabase } from '@/features/game/cardRandomizer';
import { ALL_CATEGORIES, CATEGORY_LABEL_RU, type Card } from '@/shared/types/database';

// Min characters before the search auto-fires, and the debounce pause after the
// last keystroke — keeps us off "a query per letter" on a 3000+ row ilike.
const SEARCH_MIN_CHARS = 2;
const SEARCH_DEBOUNCE_MS = 400;

// Small inline spinner (Tailwind animate-spin) for buttons that are working.
function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin align-[-2px] ${className}`}
      aria-hidden
    />
  );
}

// Password kept in sessionStorage (session memory, cleared on tab close) —
// NOT localStorage, so it never persists across sessions.
const PW_KEY = 'ss_admin_pw';

const CONTINENTS = ['', 'europe', 'south_america', 'africa', 'asia', 'north_america'];
const POSITIONS = ['', 'Вратарь', 'Защитник', 'Полузащитник', 'Нападающий'];

const EMPTY: CardInput = {
  name: '', name_en: '', category: 'player', category_ru: '', continent: '',
  country: '', position_ru: '', photo_url: '', clubs_minutes: [],
  pageviews: null, active: true, delete_candidate: false,
};

function toInput(c: Card): CardInput {
  return {
    id: c.id, name: c.name, name_en: c.name_en ?? '', category: c.category,
    category_ru: c.category_ru ?? '', continent: c.continent ?? '',
    country: c.country ?? '', position_ru: c.position_ru ?? '',
    photo_url: c.photo_url ?? '', clubs_minutes: c.clubs_minutes ?? [],
    pageviews: c.pageviews ?? null, active: c.active,
    delete_candidate: c.delete_candidate ?? false,
    forbidden_words: c.forbidden_words,
  };
}

const inputCls =
  'w-full bg-brand-surface border border-brand-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-accent';
const labelCls = 'block text-brand-muted text-xs mb-1';

export function AdminScreen() {
  const navigate = useNavigate();
  const [pw, setPw] = useState<string | null>(() => sessionStorage.getItem(PW_KEY));
  const [role, setRole] = useState<StaffRole>(null);
  const [pwInput, setPwInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [checking, setChecking] = useState(false);

  // Wake the (free-tier, possibly sleeping) DB the moment /admin opens, so it is
  // warm by the time the login RPC runs — otherwise the first request pays the
  // cold-start wake (seconds) and the login feels frozen. Best-effort.
  useEffect(() => { void wakeSupabase(); }, []);

  // Verify a restored session password once on mount, and recover the role.
  useEffect(() => {
    if (!pw) return;
    staffVerify(pw).then((r) => {
      if (r) setRole(r);
      else { sessionStorage.removeItem(PW_KEY); setPw(null); }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = async () => {
    setChecking(true);
    setAuthError('');
    const r = await staffVerify(pwInput);
    setChecking(false);
    if (r) { sessionStorage.setItem(PW_KEY, pwInput); setPw(pwInput); setRole(r); }
    else setAuthError('Неверный пароль');
  };

  if (!pw || !role) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center p-6">
        <div className="w-full max-w-xs space-y-3">
          <h1 className="text-white text-lg font-medium text-center">Кабинет</h1>
          <input
            type="password" className={inputCls} value={pwInput} autoFocus
            placeholder="Пароль"
            onChange={(e) => setPwInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && login()}
          />
          {authError && <p className="text-red-400 text-sm text-center">{authError}</p>}
          <button
            className="w-full h-11 rounded-lg bg-brand-accent text-brand-bg font-medium disabled:opacity-50 flex items-center justify-center gap-2"
            disabled={checking || !pwInput}
            onClick={login}
          >
            {checking ? <><Spinner /> Проверяю…</> : 'Войти'}
          </button>
          <button className="w-full text-brand-muted text-sm" onClick={() => navigate('/')}>
            На главную
          </button>
        </div>
      </div>
    );
  }

  return (
    <StaffCabinet
      password={pw} role={role}
      onLogout={() => { sessionStorage.removeItem(PW_KEY); setPw(null); setRole(null); }}
    />
  );
}

type Tab = 'cards' | 'reports';

function StaffCabinet({ password, role, onLogout }: {
  password: string; role: StaffRole; onLogout: () => void;
}) {
  const [tab, setTab] = useState<Tab>('reports');
  const [form, setForm] = useState<CardInput | null>(null);
  const [msg, setMsg] = useState('');
  const isAdmin = role === 'admin';

  // Open a reported card straight in the editor (Reports -> Cards tab).
  const openCard = async (id: string) => {
    setMsg('');
    try {
      const c = await adminGetCard(id);
      if (c) { setForm(toInput(c)); setTab('cards'); }
      else setMsg('Карточка не найдена');
    } catch (e) { setMsg(String(e)); }
  };

  return (
    <div className="min-h-screen bg-brand-bg text-white p-4 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">
          Кабинет
          <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
            isAdmin ? 'bg-brand-accent/20 text-brand-accent' : 'bg-brand-border text-brand-muted'}`}>
            {isAdmin ? 'админ' : 'модератор'}
          </span>
        </h1>
        <button className="text-brand-muted text-sm" onClick={onLogout}>Выйти</button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {(['reports', 'cards'] as Tab[]).map((tb) => (
          <button key={tb}
            className={`px-4 py-2 rounded-lg text-sm transition-colors ${
              tab === tb ? 'bg-brand-accent text-brand-bg' : 'bg-brand-surface border border-brand-border text-brand-muted'}`}
            onClick={() => setTab(tb)}>
            {tb === 'reports' ? 'Репорты' : 'Карточки'}
          </button>
        ))}
      </div>

      {msg && <p className="text-xs text-brand-accent">{msg}</p>}

      {tab === 'reports'
        ? <ReportsPanel password={password} onOpenCard={openCard} />
        : <CardsPanel password={password} isAdmin={isAdmin} form={form} setForm={setForm} />}
    </div>
  );
}

// ── Reports tab ──────────────────────────────────────────────
function ReportsPanel({ password, onOpenCard }: {
  password: string; onOpenCard: (id: string) => void;
}) {
  const [rows, setRows] = useState<CardReportGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = async () => {
    setLoading(true); setErr('');
    try { setRows(await modListReports(password)); }
    catch (e) { setErr(String(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resolve = async (id: string) => {
    try { await modResolveReports(password, id); setRows((r) => r.filter((x) => x.card_id !== id)); }
    catch (e) { setErr(String(e)); }
  };
  const flag = async (id: string, on: boolean) => {
    try {
      await modFlagCandidate(password, id, on);
      setRows((r) => r.map((x) => (x.card_id === id ? { ...x, delete_candidate: on } : x)));
    } catch (e) { setErr(String(e)); }
  };

  if (loading) return <p className="text-brand-muted text-sm">Загрузка…</p>;
  if (err) return <p className="text-red-400 text-sm">{err}</p>;
  if (rows.length === 0) return <p className="text-brand-muted text-sm">Новых репортов нет 🎉</p>;

  return (
    <div className="space-y-2">
      <p className="text-brand-muted text-xs">
        Карточки с репортами, самые проблемные сверху. Тап «Открыть» — править,
        затем «Решено».
      </p>
      {rows.map((r) => (
        <div key={r.card_id}
          className="bg-brand-surface border border-brand-border rounded-xl p-3 space-y-2">
          <div className="flex items-start gap-2.5">
            {r.photo_url
              ? <img src={r.photo_url} alt="" className="w-9 h-9 rounded-full object-cover object-top shrink-0" />
              : <span className="w-9 h-9 rounded-full bg-brand-border inline-block shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">
                {r.card_name} <span className="text-brand-muted">/ {r.card_name_en ?? '—'}</span>
              </p>
              <p className="text-brand-muted text-xs truncate">
                {r.category}{r.active ? '' : ' ·off'} · причины: {r.reasons}
              </p>
              {r.last_comment && (
                <p className="text-brand-muted/80 text-xs italic truncate mt-0.5">«{r.last_comment}»</p>
              )}
            </div>
            <span className="shrink-0 text-xs font-bold bg-red-500/20 text-red-300 rounded-full px-2 py-0.5">
              ×{r.report_count}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="px-3 py-1.5 rounded-lg bg-brand-accent text-brand-bg text-xs font-medium"
              onClick={() => onOpenCard(r.card_id)}>
              Открыть
            </button>
            <button className="px-3 py-1.5 rounded-lg bg-brand-border text-brand-muted text-xs"
              onClick={() => resolve(r.card_id)}>
              Решено
            </button>
            <button
              className={`px-3 py-1.5 rounded-lg text-xs border ${
                r.delete_candidate
                  ? 'bg-red-900/50 border-red-500/40 text-red-200'
                  : 'bg-brand-border border-transparent text-brand-muted'}`}
              onClick={() => flag(r.card_id, !r.delete_candidate)}>
              {r.delete_candidate ? '✓ кандидат на удаление' : 'Кандидат на удаление'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Cards tab (search + editor) ──────────────────────────────
function CardsPanel({ password, isAdmin, form, setForm }: {
  password: string; isAdmin: boolean;
  form: CardInput | null; setForm: Dispatch<SetStateAction<CardInput | null>>;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Card[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const searchSeq = useRef(0);

  const runSearch = async (raw: string) => {
    const q = raw.trim();
    if (q.length < SEARCH_MIN_CHARS) { setResults([]); setSearching(false); return; }
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const list = await adminSearchCards(q);
      if (seq === searchSeq.current) setResults(list);
    } catch (e) {
      if (seq === searchSeq.current) setMsg(String(e));
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  };

  useEffect(() => {
    const q = query.trim();
    if (q.length < SEARCH_MIN_CHARS) { setResults([]); setSearching(false); return; }
    const t = setTimeout(() => { void runSearch(q); }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof CardInput>(k: K, v: CardInput[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  const save = async () => {
    if (!form) return;
    setSaving(true); setMsg('');
    try {
      const payload: CardInput = {
        ...form,
        pageviews: form.pageviews === null || Number.isNaN(form.pageviews)
          ? null : Number(form.pageviews),
        forbidden_words: form.id ? form.forbidden_words : buildForbiddenWords(form.name),
      };
      const saved = await adminSaveCard(password, payload);
      setMsg(`Сохранено: ${saved.name}`);
      setForm(toInput(saved));
      if (query) await runSearch(query);
    } catch (e) { setMsg(String(e)); }
    finally { setSaving(false); }
  };

  // Admin-only.
  const del = async () => {
    if (!form?.id) return;
    if (!confirm(`Деактивировать «${form.name}»? (active=false, не удаление)`)) return;
    setSaving(true);
    try {
      await adminDeleteCard(password, form.id, false);
      setMsg('Карточка деактивирована');
      setForm((f) => (f ? { ...f, active: false } : f));
      if (query) await runSearch(query);
    } catch (e) { setMsg(String(e)); }
    finally { setSaving(false); }
  };

  // Candidate flag — both roles (separate RPC, not part of save).
  const toggleCandidate = async () => {
    if (!form?.id) return;
    const next = !form.delete_candidate;
    try {
      await modFlagCandidate(password, form.id, next);
      set('delete_candidate', next);
    } catch (e) { setMsg(String(e)); }
  };

  const clubs = form?.clubs_minutes ?? [];

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            className={inputCls} value={query} placeholder="Поиск по имени / name_en (от 2 букв)"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runSearch(query)}
          />
          {searching && (
            <Spinner className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-muted" />
          )}
        </div>
        <button className="px-4 rounded-lg bg-brand-surface border border-brand-border text-sm flex items-center gap-2"
          onClick={() => runSearch(query)} disabled={searching}>
          {searching ? <Spinner /> : 'Найти'}
        </button>
        <button className="px-4 rounded-lg bg-brand-accent text-brand-bg text-sm"
          onClick={() => setForm({ ...EMPTY })}>
          + Новая
        </button>
      </div>

      {results.length > 0 && (
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {results.map((c) => (
            <button key={c.id}
              className="w-full flex items-center gap-2 text-left bg-brand-surface border border-brand-border rounded-lg px-2 py-1.5 hover:border-brand-accent"
              onClick={() => setForm(toInput(c))}>
              {c.photo_url
                ? <img src={c.photo_url} alt="" className="w-7 h-7 rounded-full object-cover object-top" />
                : <span className="w-7 h-7 rounded-full bg-brand-border inline-block" />}
              <span className="flex-1 min-w-0 truncate text-sm">
                {c.name} <span className="text-brand-muted">/ {c.name_en ?? '—'}</span>
              </span>
              <span className="text-brand-muted text-xs">{c.category}{c.active ? '' : ' ·off'}</span>
            </button>
          ))}
        </div>
      )}

      {msg && <p className="text-xs text-brand-accent">{msg}</p>}

      {form && (
        <div className="space-y-3 bg-brand-surface/40 border border-brand-border rounded-xl p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-brand-muted text-xs">{form.id ? `id: ${form.id}` : 'Новая карточка'}</p>
            {form.delete_candidate && (
              <span className="text-[11px] text-red-300 bg-red-900/40 rounded-full px-2 py-0.5">
                кандидат на удаление
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>name</label>
              <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
            <div><label className={labelCls}>name_en</label>
              <input className={inputCls} value={form.name_en ?? ''} onChange={(e) => set('name_en', e.target.value)} /></div>
            <div><label className={labelCls}>category</label>
              <select className={inputCls} value={form.category} onChange={(e) => set('category', e.target.value)}>
                {ALL_CATEGORIES.map((c) => <option key={c} value={c}>{c} ({CATEGORY_LABEL_RU[c]})</option>)}
              </select></div>
            <div><label className={labelCls}>category_ru</label>
              <input className={inputCls} value={form.category_ru ?? ''} onChange={(e) => set('category_ru', e.target.value)} /></div>
            <div><label className={labelCls}>continent</label>
              <select className={inputCls} value={form.continent ?? ''} onChange={(e) => set('continent', e.target.value)}>
                {CONTINENTS.map((c) => <option key={c} value={c}>{c || '—'}</option>)}
              </select></div>
            <div><label className={labelCls}>country (ISO)</label>
              <input className={inputCls} value={form.country ?? ''} onChange={(e) => set('country', e.target.value)} placeholder="RU / BR / GB-ENG" /></div>
            <div><label className={labelCls}>position_ru</label>
              <select className={inputCls} value={form.position_ru ?? ''} onChange={(e) => set('position_ru', e.target.value)}>
                {POSITIONS.map((p) => <option key={p} value={p}>{p || '—'}</option>)}
              </select></div>
            <div><label className={labelCls}>pageviews</label>
              <input type="number" className={inputCls} value={form.pageviews ?? ''} onChange={(e) => set('pageviews', e.target.value === '' ? null : Number(e.target.value))} /></div>
          </div>

          <div><label className={labelCls}>photo_url</label>
            <div className="flex gap-2 items-center">
              <input className={inputCls} value={form.photo_url ?? ''} onChange={(e) => set('photo_url', e.target.value)} />
              {form.photo_url
                ? <img src={form.photo_url} alt="" className="w-10 h-10 rounded-full object-cover object-top shrink-0" />
                : null}
            </div>
          </div>

          {/* clubs_minutes array editor */}
          <div>
            <label className={labelCls}>clubs_minutes</label>
            <div className="space-y-1">
              {clubs.map((cm, idx) => (
                <div key={idx} className="flex gap-2">
                  <input className={inputCls} value={cm.club} placeholder="клуб"
                    onChange={(e) => set('clubs_minutes', clubs.map((x, j) => j === idx ? { ...x, club: e.target.value } : x))} />
                  <input type="number" className={`${inputCls} w-24`} value={cm.minutes} placeholder="мин"
                    onChange={(e) => set('clubs_minutes', clubs.map((x, j) => j === idx ? { ...x, minutes: Number(e.target.value) } : x))} />
                  <button className="px-2 text-red-400"
                    onClick={() => set('clubs_minutes', clubs.filter((_, j) => j !== idx))}>×</button>
                </div>
              ))}
              <button className="text-brand-accent text-xs"
                onClick={() => set('clubs_minutes', [...clubs, { club: '', minutes: 0 }])}>
                + клуб
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.active ?? true} onChange={(e) => set('active', e.target.checked)} />
            active
          </label>

          <div className="flex flex-wrap gap-2 pt-1">
            <button className="flex-1 h-11 rounded-lg bg-brand-accent text-brand-bg font-medium disabled:opacity-50"
              onClick={save} disabled={saving || !form.name}>
              {saving ? '...' : (form.id ? 'Сохранить' : 'Добавить')}
            </button>
            {form.id && (
              <button className="px-4 h-11 rounded-lg bg-brand-surface border border-brand-border text-brand-muted text-sm"
                onClick={toggleCandidate} disabled={saving}>
                {form.delete_candidate ? 'Снять кандидата' : 'В кандидаты'}
              </button>
            )}
            {isAdmin && form.id && (
              <button className="px-4 h-11 rounded-lg bg-red-900/60 border border-red-500/30 text-red-200 text-sm"
                onClick={del} disabled={saving}>
                Деактивировать
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
