// i18n parity across all 9 locales. These invariants are PLURAL-AWARE on
// purpose: a naive "every locale has identical keys" test would be WRONG —
// Arabic legitimately has _zero/_two, Russian _few/_many, and CJK (ja/ko/zh)
// have no _one form at all (CLDR). We compare LOGICAL keys (plural suffix
// stripped) and the UNION of interpolation variables per logical key.

import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const LOCALES_DIR = path.resolve(__dirname, './locales');
const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];
const BASE = 'en';

type Flat = Record<string, string>;

function flatten(obj: unknown, prefix = ''): Flat {
  const out: Flat = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const nk = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') Object.assign(out, flatten(v, nk));
    else out[nk] = String(v);
  }
  return out;
}

function loadLocale(loc: string): Flat {
  return flatten(JSON.parse(readFileSync(path.join(LOCALES_DIR, `${loc}.json`), 'utf-8')));
}

function logicalKey(k: string): string {
  const parts = k.split('_');
  return PLURAL_SUFFIXES.includes(parts[parts.length - 1]) ? parts.slice(0, -1).join('_') : k;
}

function isPluralKey(k: string): boolean {
  return PLURAL_SUFFIXES.includes(k.split('_').pop() as string);
}

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]);
}

/** Union of interpolation variables across every plural variant of each logical key. */
function placeholderUnion(flat: Flat): Record<string, Set<string>> {
  const u: Record<string, Set<string>> = {};
  for (const [k, v] of Object.entries(flat)) {
    const lk = logicalKey(k);
    u[lk] ??= new Set();
    placeholders(v).forEach((p) => u[lk].add(p));
  }
  return u;
}

const LOCALES = readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));
const data: Record<string, Flat> = Object.fromEntries(LOCALES.map((l) => [l, loadLocale(l)]));
const en = data[BASE];
const enLogical = new Set(Object.keys(en).map(logicalKey));
const enPluralLogical = new Set(Object.keys(en).filter(isPluralKey).map(logicalKey));

describe('i18n locales', () => {
  it('ships all 9 expected locales', () => {
    expect(LOCALES.sort()).toEqual(['ar', 'en', 'es', 'fr', 'ja', 'ko', 'pt', 'ru', 'zh']);
  });

  it('every locale covers every logical key present in en', () => {
    for (const loc of LOCALES) {
      const localeLogical = new Set(Object.keys(data[loc]).map(logicalKey));
      const missing = [...enLogical].filter((k) => !localeLogical.has(k));
      expect({ loc, missing }).toEqual({ loc, missing: [] });
    }
  });

  it('every pluralized key has the required _other fallback in every locale (i18next)', () => {
    for (const loc of LOCALES) {
      const keys = new Set(Object.keys(data[loc]));
      const missingOther = [...enPluralLogical].filter((lk) => !keys.has(`${lk}_other`));
      expect({ loc, missingOther }).toEqual({ loc, missingOther: [] });
    }
  });

  it('has no empty string values', () => {
    for (const loc of LOCALES) {
      const empty = Object.entries(data[loc])
        .filter(([, v]) => v.trim() === '')
        .map(([k]) => k);
      expect({ loc, empty }).toEqual({ loc, empty: [] });
    }
  });
});

// --- LOCKED DEFECT (remove when fixed) --------------------------------------
// D3: interpolation variables diverge across locales for a logical key. The
// code calls t('facts.caps', { count, team }) (TrainingScreen.tsx) — Russian
// uses {{team}} but en (and es/fr/pt/ja/ko/zh/ar) drop it, so those locales
// silently lose the national-team context. Fix = reconcile the string across
// locales, then convert this to a hard assertion.
describe('i18n locales — known defects (locked)', () => {
  it.fails('DEFECT D3: placeholder variables are consistent across locales per logical key', () => {
    const enUnion = placeholderUnion(en);
    const mismatches: string[] = [];
    for (const loc of LOCALES) {
      if (loc === BASE) continue;
      const u = placeholderUnion(data[loc]);
      for (const lk of Object.keys(enUnion)) {
        const base = [...enUnion[lk]].sort().join(',');
        const other = [...(u[lk] ?? new Set())].sort().join(',');
        if (base !== other) mismatches.push(`${loc}:${lk} (${base} vs ${other})`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
