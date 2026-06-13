import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  adminVerify, adminSearchCards, adminSaveCard, adminDeleteCard,
  buildForbiddenWords, type CardInput,
} from '@/features/admin/adminApi';
import { ALL_CATEGORIES, CATEGORY_LABEL_RU, type Card } from '@/shared/types/database';

// Password kept in sessionStorage (session memory, cleared on tab close) —
// NOT localStorage, so it never persists across sessions.
const PW_KEY = 'ss_admin_pw';

const CONTINENTS = ['', 'europe', 'south_america', 'africa', 'asia', 'north_america'];
const POSITIONS = ['', 'Вратарь', 'Защитник', 'Полузащитник', 'Нападающий'];

const EMPTY: CardInput = {
  name: '', name_en: '', category: 'player', category_ru: '', continent: '',
  country: '', position_ru: '', photo_url: '', clubs_minutes: [],
  pageviews: null, active: true,
};

function toInput(c: Card): CardInput {
  return {
    id: c.id, name: c.name, name_en: c.name_en ?? '', category: c.category,
    category_ru: c.category_ru ?? '', continent: c.continent ?? '',
    country: c.country ?? '', position_ru: c.position_ru ?? '',
    photo_url: c.photo_url ?? '', clubs_minutes: c.clubs_minutes ?? [],
    pageviews: c.pageviews ?? null, active: c.active,
    forbidden_words: c.forbidden_words,
  };
}

const inputCls =
  'w-full bg-brand-surface border border-brand-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-brand-accent';
const labelCls = 'block text-brand-muted text-xs mb-1';

export function AdminScreen() {
  const navigate = useNavigate();
  const [pw, setPw] = useState<string | null>(() => sessionStorage.getItem(PW_KEY));
  const [pwInput, setPwInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [checking, setChecking] = useState(false);

  // Verify a restored session password once on mount.
  useEffect(() => {
    if (!pw) return;
    adminVerify(pw).then((ok) => {
      if (!ok) { sessionStorage.removeItem(PW_KEY); setPw(null); }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = async () => {
    setChecking(true);
    setAuthError('');
    const ok = await adminVerify(pwInput);
    setChecking(false);
    if (ok) { sessionStorage.setItem(PW_KEY, pwInput); setPw(pwInput); }
    else setAuthError('Неверный пароль');
  };

  if (!pw) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center p-6">
        <div className="w-full max-w-xs space-y-3">
          <h1 className="text-white text-lg font-medium text-center">Админ-редактор</h1>
          <input
            type="password" className={inputCls} value={pwInput} autoFocus
            placeholder="Пароль"
            onChange={(e) => setPwInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && login()}
          />
          {authError && <p className="text-red-400 text-sm text-center">{authError}</p>}
          <button
            className="w-full h-11 rounded-lg bg-brand-accent text-brand-bg font-medium disabled:opacity-50"
            disabled={checking || !pwInput}
            onClick={login}
          >
            {checking ? '...' : 'Войти'}
          </button>
          <button className="w-full text-brand-muted text-sm" onClick={() => navigate('/')}>
            На главную
          </button>
        </div>
      </div>
    );
  }

  return <AdminEditor password={pw} onLogout={() => { sessionStorage.removeItem(PW_KEY); setPw(null); }} />;
}

function AdminEditor({ password, onLogout }: { password: string; onLogout: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Card[]>([]);
  const [searching, setSearching] = useState(false);
  const [form, setForm] = useState<CardInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  const search = async () => {
    setSearching(true);
    try { setResults(await adminSearchCards(query)); }
    catch (e) { setMsg(String(e)); }
    finally { setSearching(false); }
  };

  const set = <K extends keyof CardInput>(k: K, v: CardInput[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setMsg('');
    try {
      const payload: CardInput = {
        ...form,
        pageviews: form.pageviews === null || Number.isNaN(form.pageviews)
          ? null : Number(form.pageviews),
        // Generate forbidden_words from the name when creating (no id yet).
        forbidden_words: form.id ? form.forbidden_words : buildForbiddenWords(form.name),
      };
      const saved = await adminSaveCard(password, payload);
      setMsg(`Сохранено: ${saved.name}`);
      setForm(toInput(saved));
      if (query) await search();
    } catch (e) { setMsg(String(e)); }
    finally { setSaving(false); }
  };

  const del = async () => {
    if (!form?.id) return;
    if (!confirm(`Деактивировать «${form.name}»? (active=false, не удаление)`)) return;
    setSaving(true);
    try {
      await adminDeleteCard(password, form.id, false);
      setMsg('Карточка деактивирована');
      setForm((f) => (f ? { ...f, active: false } : f));
      if (query) await search();
    } catch (e) { setMsg(String(e)); }
    finally { setSaving(false); }
  };

  const clubs = form?.clubs_minutes ?? [];

  return (
    <div className="min-h-screen bg-brand-bg text-white p-4 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-medium">Админ-редактор карточек</h1>
        <button className="text-brand-muted text-sm" onClick={onLogout}>Выйти</button>
      </div>

      {/* Search */}
      <div className="flex gap-2">
        <input
          className={inputCls} value={query} placeholder="Поиск по имени / name_en"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
        />
        <button className="px-4 rounded-lg bg-brand-surface border border-brand-border text-sm"
          onClick={search} disabled={searching}>
          {searching ? '...' : 'Найти'}
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

      {/* Edit / create form */}
      {form && (
        <div className="space-y-3 bg-brand-surface/40 border border-brand-border rounded-xl p-3">
          <p className="text-brand-muted text-xs">{form.id ? `id: ${form.id}` : 'Новая карточка'}</p>

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

          <div className="flex gap-2 pt-1">
            <button className="flex-1 h-11 rounded-lg bg-brand-accent text-brand-bg font-medium disabled:opacity-50"
              onClick={save} disabled={saving || !form.name}>
              {saving ? '...' : (form.id ? 'Сохранить' : 'Добавить')}
            </button>
            {form.id && (
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
