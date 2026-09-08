#!/usr/bin/env node
// Locale parity check: every user-visible key must exist in all nine
// languages. Run it before opening a PR — `node scripts/check-i18n.mjs`.
//
// Plural suffixes are compared by STEM, not literally: ru needs
// `_one/_few/_many/_other`, en needs `_one/_other`, and ja/ko/zh need only
// `_other`. Demanding identical key sets would force translators to invent
// forms their language does not have.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'src/shared/i18n/locales';
const BASE = 'ru'; // the language the product is written in first
const PLURAL = /_(zero|one|two|few|many|other)$/;

const flatten = (obj, prefix = '') =>
  Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]);

const load = (lang) => JSON.parse(readFileSync(join(DIR, `${lang}.json`), 'utf8'));
const stems = (lang) => new Set(flatten(load(lang)).map((k) => k.replace(PLURAL, '')));

const langs = readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
const base = stems(BASE);
let failed = false;

for (const lang of langs.filter((l) => l !== BASE)) {
  const missing = [...base].filter((k) => !stems(lang).has(k)).sort();
  if (missing.length) {
    failed = true;
    console.error(`${lang}: ${missing.length} missing — ${missing.join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// ⚠️ КЛЮЧ, КОТОРОМУ ПЕРЕДАЮТ `count`, ОБЯЗАН ИМЕТЬ ФОРМЫ МНОЖЕСТВЕННОГО ЧИСЛА.
//
// Это поставлено по живой поломке. `career.matches` — ЗАГОЛОВОК СТОЛБЦА
// («Матчи»), без `{{count}}` и без форм. Экран после игры звал его со
// счётчиком — `t('career.matches', { count: apps })` — и печатал голое
// «Матчи, Голы» без единого числа. Владелец увидел это первым.
//
// Молчит здесь всё: i18next не считает лишний `count` ошибкой, он просто
// не находит куда его подставить и отдаёт строку как есть. Ни tsc, ни
// проверка полноты локалей такого не видят — ключ ЕСТЬ и он есть во всех
// девяти. Поэтому проверка смотрит на ВЫЗОВЫ в коде, а не на файлы.
const CALL = /\bt\(\s*'([A-Za-z0-9_.]+)'\s*,\s*\{[^}]*\bcount\b/g;

const sources = [];
const walk = (dir) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) sources.push(full);
  }
};
walk('src');

const baseKeys = new Set(flatten(load(BASE)));
const hasForms = (key) => [...baseKeys].some((k) => PLURAL.test(k) && k.replace(PLURAL, '') === key);

const flat = new Map();
for (const file of sources) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(CALL)) {
    const key = m[1];
    // Ключа нет вовсе — это отдельная беда, и её ловит не эта проверка.
    if (!baseKeys.has(key)) continue;
    if (!hasForms(key)) flat.set(key, file);
  }
}

if (flat.size) {
  failed = true;
  for (const [key, file] of flat) {
    console.error(`${key}: вызывается со счётчиком, но форм множественного числа нет — ${file}`);
  }
  console.error('\nЛибо заведите _one/_few/_many/_other, либо зовите ключ без count.');
}

if (failed) {
  console.error(`\nEvery key in ${BASE}.json must exist in all ${langs.length} locales.`);
  process.exit(1);
}
console.log(`i18n OK — ${base.size} keys across ${langs.length} locales, `
  + `${sources.length} файлов проверено на счётчик без форм.`);
