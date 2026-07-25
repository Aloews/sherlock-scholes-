// Data-integrity gate for the game deck (sherlock_cards.csv).
//
// This is the front line against the "many inaccuracies" in the app. The deck
// is player-facing content: a junk row, a wrong category or a duplicated player
// all show up directly in the game. These tests parse the real CSV and assert
// invariants over every row.
//
// Three real defects were found while building this harness:
//   1. FIXED here  — a junk placeholder card leaked into the deck.
//   2. LOCKED (it.fails) — `difficulty` is degenerate: every row is 'medium',
//      so the whole difficulty system is dead in the shipped data.
//   3. LOCKED (it.fails) — one player is duplicated across two categories.
// The it.fails() locks are honest documentation, not skips: they assert the
// defect still exists, and will fail loudly (demanding removal) the moment the
// data is corrected.

import { readFileSync } from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';
import { describe, it, expect } from 'vitest';
import { ALL_CATEGORIES } from '@/shared/types/database';

const CSV_PATH = path.resolve(__dirname, '../../sherlock_cards.csv');

interface Row {
  category: string;
  category_ru: string;
  name: string;
  difficulty: string;
  forbidden_words: string;
}

function loadRows(): Row[] {
  const raw = readFileSync(CSV_PATH, 'utf-8');
  return parse(raw, { columns: true, skip_empty_lines: true }) as Row[];
}

const VALID_DIFFICULTY = ['easy', 'medium', 'hard'];

// Meta/placeholder words that must never appear in a real card name — they mark
// a row that was inserted as a stub and never filled in.
const JUNK_NAME_RE = /дубликат|вставля|неполн|заглушк|placeholder|тест[\s_-]|^test$/i;

describe('sherlock_cards.csv — structural integrity', () => {
  it('parses with a strict CSV reader (no unterminated quotes / ragged rows)', () => {
    const raw = readFileSync(CSV_PATH, 'utf-8');
    // parse() throws on quote/column errors; a raw list gives us the column count.
    const records = parse(raw, { skip_empty_lines: true }) as string[][];
    expect(records.length).toBeGreaterThan(2000);
    for (const rec of records) {
      expect(rec).toHaveLength(5);
    }
  });

  it('has the expected header', () => {
    const raw = readFileSync(CSV_PATH, 'utf-8');
    const [header] = parse(raw, { skip_empty_lines: true }) as string[][];
    expect(header).toEqual([
      'category',
      'category_ru',
      'name',
      'difficulty',
      'forbidden_words',
    ]);
  });
});

describe('sherlock_cards.csv — per-row invariants', () => {
  const rows = loadRows();

  it('every category is a known game category', () => {
    const known = new Set<string>(ALL_CATEGORIES as unknown as string[]);
    const unknown = [...new Set(rows.map((r) => r.category))].filter(
      (c) => !known.has(c),
    );
    expect(unknown).toEqual([]);
  });

  it('every difficulty is from the valid set', () => {
    const bad = rows.filter((r) => !VALID_DIFFICULTY.includes(r.difficulty));
    expect(bad.map((r) => `${r.name}:${r.difficulty}`)).toEqual([]);
  });

  it('forbidden_words is non-empty, pipe-delimited, contains the name, no empty tokens', () => {
    const offenders: string[] = [];
    for (const r of rows) {
      const tokens = r.forbidden_words.split('|');
      const emptyToken = tokens.some((t) => t.trim() === '');
      const containsName = tokens.some(
        (t) => t.trim().toLowerCase() === r.name.trim().toLowerCase(),
      );
      if (r.forbidden_words.trim() === '' || emptyToken || !containsName) {
        offenders.push(r.name);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no junk / placeholder cards leaked into the deck (regression: row 1780)', () => {
    const junk = rows.filter((r) => JUNK_NAME_RE.test(r.name));
    expect(junk.map((r) => r.name)).toEqual([]);
  });

  it('no two rows are byte-for-byte identical', () => {
    const seen = new Set<string>();
    const dups: string[] = [];
    for (const r of rows) {
      const key = [r.category, r.name, r.difficulty, r.forbidden_words].join('␟');
      if (seen.has(key)) dups.push(r.name);
      seen.add(key);
    }
    expect(dups).toEqual([]);
  });
});

// --- LOCKED DEFECTS ---------------------------------------------------------
// These assert the current (broken) reality. it.fails passes while the defect
// is present and FAILS the moment the data is fixed — forcing this lock to be
// turned into a real green assertion. This is documentation with teeth.

describe('sherlock_cards.csv — known defects (locked, remove when fixed)', () => {
  const rows = loadRows();

  it.fails('DEFECT: difficulty is degenerate — every card is "medium"', () => {
    const distinct = new Set(rows.map((r) => r.difficulty));
    // A healthy deck spreads across easy/medium/hard. Today it does not.
    expect(distinct.size).toBeGreaterThan(1);
  });

  it.fails('DEFECT: a player is duplicated across categories (Владимир Маслаченко)', () => {
    const byName = new Map<string, Set<string>>();
    for (const r of rows) {
      const n = r.name.trim().toLowerCase();
      if (!byName.has(n)) byName.set(n, new Set());
      byName.get(n)!.add(r.category);
    }
    const crossCategoryDup = [...byName.entries()].filter(
      ([, cats]) => cats.size > 1,
    );
    expect(crossCategoryDup).toEqual([]);
  });
});
