# Sherlock Scholes — working rules

A Telegram Mini App: one phone, two teams, a deck of football cards to
explain. React + Vite + Tailwind on Supabase.

## Every user-visible string ships in all nine languages

The app is translated into **ru, en, es, pt, fr, ar, ja, ko, zh**. A feature
is not finished until its strings exist in every one of them.

* **No literal user-visible text in components.** It goes through `t()` with
  a key in `src/shared/i18n/locales/*.json`.
* **Add the key to all nine files in the same commit** — not "ru now,
  the rest later". A missing key falls back to the raw key or to Russian,
  and that is what the player sees.
* **Plurals follow the language, not the base.** ru needs
  `_one/_few/_many/_other`, en `_one/_other`, ja/ko/zh only `_other`. Do not
  invent forms a language does not have; do not drop forms it needs.
* **Check before opening a PR:**

  ```bash
  node scripts/check-i18n.mjs
  ```

  It compares keys by stem, so legitimate plural differences pass and real
  gaps fail.

Translate rather than transliterate, and keep the register the rest of the
file uses. Proper nouns that travel unchanged (La Liga, Serie A) still get
an entry — an explicit identity mapping beats a silent fallback, because the
fallback hides the case where the name *should* differ (`Premier League`
means England here; Russia's top flight is its own entry).

`ar` is right-to-left: check that any layout you touch survives it.

## Checks

```bash
npx tsc --noEmit          # noUnusedLocals is on
npm run build
node scripts/check-i18n.mjs
```

GitHub Actions in this repo **regularly loses the `pull_request` event**, so
a push can end up with no check run at all — which reads as "still running",
not as a failure. After pushing, look at the PR's checks; if only Vercel is
there, trigger `ci.yml` by `workflow_dispatch`.

Design-system and deck conventions live in `docs/DESIGN_SYSTEM.md` and
`docs/FILTERS_REWORK.md`.
