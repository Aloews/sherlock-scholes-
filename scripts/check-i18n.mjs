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

if (failed) {
  console.error(`\nEvery key in ${BASE}.json must exist in all ${langs.length} locales.`);
  process.exit(1);
}
console.log(`i18n OK — ${base.size} keys across ${langs.length} locales.`);
