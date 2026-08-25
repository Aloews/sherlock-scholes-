# Sherlock Scholes — working rules

A Telegram Mini App: one phone, two teams, a deck of football cards to
explain. React + Vite + Tailwind on Supabase.

## Read the map first

**[`docs/MAP.md`](./docs/MAP.md)** — what exists, where, and how it connects:
routes and screens, the deck path, the layer graph, every RPC and Edge
Function with the file it lives in, the enrichment pipeline, and the traps
that have actually bitten this project.

Read the section you need there instead of walking the tree with `grep`. It
is meant to answer "where does X live" in one hop. If it disagrees with the
code, the code wins — fix the map in the same PR.

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

## Design system

Two switchable visual languages, `master` (default) and `classic`, selected
at runtime — see `docs/DESIGN_SYSTEM.md`. Colours are CSS variables in
`src/index.css`; never hardcode a hex in a component. Selection is expressed
only by `OptionRow` and `Chip` in `src/shared/ui/`, never by a new
treatment.

## The deck

One filter object (`DeckFilter`, `src/shared/types/deck.ts`) and one SQL
predicate (`cards_matching`), with `pick_random_cards` and `count_deck` as
its only wrappers — so the number under a button and the cards dealt can
never disagree. Background in `docs/FILTERS_REWORK.md`.

`supabase/migrations/deck_rpc.sql` also carries the **legacy 12-parameter
`pick_random_cards`**. It is a temporary shim: production calls it
positionally, and dropping it took the live app down once. Remove it only
after the new frontend is deployed everywhere; the `DROP` is written out in
that file.

## Checks

```bash
npx tsc --noEmit          # noUnusedLocals is on
npm run build
node scripts/check-i18n.mjs
npm test                  # vitest: unit + property + data-integrity
node scripts/check-limits.mjs   # лимиты, в которые проект уже упирался
node scripts/check-prod.mjs     # ПРОД без моков, с отрицательными контролями
node scripts/check-tests.mjs    # способна ли каждая проверка ВООБЩЕ упасть
```

⚠️ **`check-prod` — единственная проверка, которая может упасть по той
причине, по которой ломается приложение.** Остальные 863 теста гоняют код
против стендов: плейлист подделан, ответы каналов подделаны, сегменты
подделаны. Они были зелёными ровно тогда, когда владелец присылал скриншоты
со сломанным ТВ.

`check-prod` ходит в боевые адреса без единого мока и идёт до КОНЦА цепочки —
до байтов видео, а не до кода 200. Это не придирка: у Setanta верхний манифест
отвечает 200, а вариант под ним — 404, и любая проверка, которая на нём
останавливается, называет канал живым.

У каждой проверки там есть **отрицательный контроль**: та же проверка,
направленная на заведомо сломанное, обязана упасть. Не упала — скрипт
называет её ПУСТОЙ и валит прогон. Зелёная пустая проверка хуже красной: она
врёт с уверенностью.

`check-limits` ничего не заваливает — он печатает числа. Смотреть его стоит
**до** пуша, потому что каждая его строка однажды что-то сломала: усечение
ответа PostgREST по `db-max-rows` (в таблице 3809 карточек, отдаётся 1000),
каталог ТВ на 850 КБ без сжатия (~17 с на медленном 3G), исчерпанный лимит
GitHub API, вес первого захода. Порог, при котором стоит подождать, у каждого
свой — решение остаётся за человеком.

The scraper's tests are standalone scripts, not a pytest suite — pytest
collects nothing from them. Run them directly:

```bash
cd football_scraper && for f in tests/test_*.py; do python3 "$f"; done
```

GitHub Actions in this repo **regularly loses the `pull_request` event**, so
a push can end up with no check run at all — which reads as "still running",
not as a failure. After pushing, look at the PR's checks; if only Vercel is
there, trigger `ci.yml` by `workflow_dispatch`.

## The engineering standards

`docs/ENGINEERING_CONSTITUTION.md` is the long-form standard, with a
per-area document beside it (`docs/TYPESCRIPT_STANDARD.md`,
`docs/TESTING_STANDARD.md`, `docs/SUPABASE_STANDARD.md`, and the rest), plus
decision records in `docs/ADR/` and checklists in `docs/CHECKLISTS/`.
`docs/AI_ENGINEERING_GUIDE.md` is the agent-facing entry point.

The rules above are the ones this project keeps getting wrong, so they stay
here in full. Where the constitution and this file disagree about the app
itself, this file is current — it is edited as the code changes.
