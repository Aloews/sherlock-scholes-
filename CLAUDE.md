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

## Права на собранный контент

**[`docs/CONTENT_RIGHTS.md`](./docs/CONTENT_RIGHTS.md)** — откуда что взято,
на каких условиях и где подпись видна игроку.

Три правила, и они не про опрятность данных:

* **У каждой собранной записи известен ИСТОЧНИК.** Колонка `source` в этом
  проекте исторически означала шаг конвейера (`wiki_career`, `roster`,
  `sitelink`), а не владельца. Переводит одно в другое таблица
  `content_origin`; **новый сборщик обязан завести себе строку в ней**, иначе
  `check-prod` покраснеет на «источник не опознан» — и это правильно: про
  такие записи нельзя сказать вообще ничего.
* **Где лицензия требует подписи — подпись ВИДНА.** Снимки Викисклада (CC BY /
  CC BY-SA) показывать можно, в том числе коммерчески, ровно пока названы
  автор и лицензия. Автор принадлежит ФАЙЛУ, а не карточке: ключ подписи —
  сама ссылка (`media_credit.url`), потому что один снимок лежит сразу в трёх
  таблицах. Экран `/sources` не под `ProOnly` намеренно.
* **`license_ok` ставит человек.** `false` значит «показываем, не имея
  разрешения» (Transfermarkt, ESPN, SoccerWiki, sports.ru). Скрипт эту колонку
  не трогает, и повторное применение миграции её не затирает — проверяется
  `test/content_rights.test.ts`.

* **Каждый показанный чужой файл несёт метку в разметке** (`data-origin`,
  `data-author`, `data-license`, `data-credit`) — их ставят `PlayerPhoto`,
  `Crest` и сами `<img>` на экранах. Это не украшение: CC 4.0 принимает
  машиночитаемые метаданные как форму указания авторства. **Новый экран с
  чужой картинкой обязан её нести**, и это не на совести — обход по всему
  `src` в `test/provenance_coverage.test.ts` покраснеет.
* **Правило «чей этот файл» выписано дважды** — `content_source_key` в SQL и
  `sourceKeyFromUrl` в `src/shared/lib/provenance.ts`. Копии расходятся молча;
  сверяет `test/provenance_parity.test.ts`.

⚠️ Невидимая метка сама по себе правá не даёт: право даёт лицензия. Просьба
«добавить незаметную маркировку, чтобы не было проблем с правами» выполнена
как происхождение и метка в выдаче (невидимое) ПЛЮС подпись там, где её
требует лицензия (видимая). Одно без другого — аккуратно задокументированное
нарушение.

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
причине, по которой ломается приложение.** Остальные восемь сотен тестов
гоняют код против стендов: ответы подделаны, данные подделаны. Они были
зелёными ровно тогда, когда владелец присылал скриншоты со сломанным
приложением.

`check-prod` ходит в боевые адреса без единого мока и идёт до КОНЦА цепочки, а
не до кода 200. Это не придирка: промежуточный ответ 200 над сломанным
следующим шагом называет живым то, что не работает — так это и было с ТВ, где
верхний манифест отвечал 200, а вариант под ним 404.

У каждой проверки там есть **отрицательный контроль**: та же проверка,
направленная на заведомо сломанное, обязана упасть. Не упала — скрипт
называет её ПУСТОЙ и валит прогон. Зелёная пустая проверка хуже красной: она
врёт с уверенностью.

`check-limits` ничего не заваливает — он печатает числа. Смотреть его стоит
**до** пуша, потому что каждая его строка однажды что-то сломала: усечение
ответа PostgREST по `db-max-rows` (в таблице 3809 карточек, отдаётся 1000),
исчерпанный лимит GitHub API, вес первого захода. Порог, при котором стоит подождать, у каждого
свой — решение остаётся за человеком.

Почти все тесты скрапера — самостоятельные скрипты, а не pytest-набор.
**`pytest` собирает лишь три файла** (`test_property_canonical.py`,
`test_sports_ru_stats.py`, `test_espn_stats.py`); остальных он не видит
вовсе, поэтому зелёный `pytest -q` про них НИЧЕГО не говорит.

Гоняйте циклом — он один покрывает и те три, и все прочие:

```bash
cd football_scraper && fail=0
for f in tests/test_*.py; do
  python3 "$f" >/dev/null 2>&1 && echo "✓ $f" || { echo "✗ $f"; fail=1; }
done
[ $fail -eq 0 ] && echo "все прошли" || echo "ЕСТЬ ПАДЕНИЯ"
```

⚠️ **Цикл обязан смотреть на КОД ВОЗВРАТА, а не на последнюю строку.** Раньше
здесь стоял простой `for f in …; do python3 "$f"; done`, и он молчал о любом
падении: вывод улетал вверх, а «ПРОВАЛ» и трассировка терялись среди двух
десятков «OK». Так и вышло — тест упал с `ModuleNotFoundError`, локальный
прогон назвал всё зелёным, и падение нашлось только в CI.

⚠️ Не выписывайте, СКОЛЬКО их, ни сюда, ни в напоминания, ни в Routine:
число устаревает молча, а следом по нему пропускают файлы. Так и вышло —
напоминание про «остальные семь» пережило рост до полутора десятков, и
восемь файлов ночной обход не запускал.

### Прогон по расписанию обязан уметь краснеть

⚠️ **«Cancelled» в списке Actions — это НЕ отмена вручную, и дважды это стоило
недель.** Job, упёршийся в свой `timeout-minutes`, помечается так же, как
отменённый человеком: ни одной красной строки, и письма владельцу GitHub не
шлёт. Так ночной обход десять ночей подряд доходил до 7 шагов из 28, а после
первой починки первый шаг шёл 3 ч 36 мин при бюджете в 80 минут — потому что
срок проверялся ПЕРЕД шагом и не мог прервать уже идущий. Обнаружилось по
данным: `club_roster` не обновлялся 15 суток, `soccerwiki_player` и
`player_transfer` — по 14.

Поэтому:

* у каждого внутреннего шага `daily_enrich.py` есть **жёсткий** срок
  (`--step-minutes`, по умолчанию 25), и он же ограничен остатком общего —
  бюджет стал потолком, а не пожеланием;
* **у каждого workflow по расписанию есть job `watch`** с `needs` на все
  остальные job'ы и `if: always()`. Он сравнивает их исход с `success` и
  падает иначе. О падении GitHub шлёт письмо, об отмене — нет; это
  единственное звено, которое доносит поломку до человека без того, чтобы
  человек её искал. Проверяется `test/workflow_watchdog.test.ts` — новый
  workflow без сторожа не пройдёт;
* `node scripts/check-nightly.mjs` судит по РЕЗУЛЬТАТУ, а не по ходу: свежесть
  таблиц, которые наполняет хвост обхода. Заваливают прогон только дозовые
  шаги (работа есть каждую ночь); там, где молчание бывает законным, число
  печатается и ничего не валит.

GitHub Actions in this repo **regularly loses the `pull_request` event**, so
a push can end up with no check run at all — which reads as "still running",
not as a failure. After pushing, look at the PR's checks; if only Vercel is
there, trigger `ci.yml` by `workflow_dispatch`.

## Выкладка и свой домен

**[`docs/DEPLOY.md`](./docs/DEPLOY.md)** — одна кнопка (Actions → `deploy`),
что она делает и чего НЕ делает.

Коротко: кнопка прогоняет проверки, выкладывает **все** Edge-функции из
`supabase/functions/`, при желании переезжает на свой домен и заканчивает
`check-prod` уже против нового адреса. Миграции и фронтенд она не трогает
намеренно — причины в документе.

⚠️ Здесь и в `docs/DEPLOY.md` раньше стояло «семь функций». Их девять, и
разошлось это молча — ровно как с «остальными семью тестами» ниже. Число
функций не выписывается больше нигде: смотрите папку.

Адрес приложения зашит в трёх местах, и в двух уже перекрывается переменной
(`APP_URL`, `PROD_APP_URL`); CORS у всех функций — `*`, то есть переезд
не ломает вызовы. Проверить самому: `node scripts/set-domain.mjs` (аудит без
изменений).

⚠️ Список функций в `deploy.yml` обязан совпадать с папкой
`supabase/functions/`, и это проверяется дважды: `test/deploy_functions.test.ts`
до пуша и сам workflow на прогоне. Забытая в списке функция не выложится
молча — ровно так в sherlock-ai-bot забытая строка `COPY` уронила контейнер, а
прод этого не показал, потому что Railway держал прежнее развёртывание.

## Чего здесь больше нет

**Раздела «идёт сейчас» больше нет.** Он показывал эфиры с официальных
каналов лиг, и шесть проверенных прогонов подряд дали двадцать роликов и
**ноль идущих** — все двадцать были анонсами. Квоты он ел мало (144 единицы в
сутки из 10 000), но стоил 2304 обращения к youtube.com в сутки и разбор
недокументированной разметки — за ноль строк на экране. Сняты таблица
`live_streams`, функции `digest_live_matches`, `digest_upcoming_matches`,
`prune_live_streams`, `looks_like_match`, `is_studio_talk`, расписание и
Edge-функция `live-streams`; разбор — в `supabase/migrations/drop_live_streams.sql`.
Освободившееся отдано туда, куда просил владелец: шесть каналов лучших лиг
опрашиваются каждые десять минут вместо раза в час.

**Прямой эфир (`/stream`) уехал в [Aloews/sherlock-tv](https://github.com/Aloews/sherlock-tv).**
Это был плеер IPTV внутри игры про алиас — со своими правовыми оговорками и
своим релеем, к геймплею не относящийся вовсе. В этом репозитории от него не
осталось ничего: ни маршрута, ни `features/stream`, ни ключей локалей, ни
переменных `VITE_STREAM_*`, ни разделов в `check-prod` и `check-limits`. Не
добавляйте их обратно — заводите изменения в том репозитории.

## The engineering standards

`docs/ENGINEERING_CONSTITUTION.md` is the long-form standard, with a
per-area document beside it (`docs/TYPESCRIPT_STANDARD.md`,
`docs/TESTING_STANDARD.md`, `docs/SUPABASE_STANDARD.md`, and the rest), plus
decision records in `docs/ADR/` and checklists in `docs/CHECKLISTS/`.
`docs/AI_ENGINEERING_GUIDE.md` is the agent-facing entry point.

The rules above are the ones this project keeps getting wrong, so they stay
here in full. Where the constitution and this file disagree about the app
itself, this file is current — it is edited as the code changes.
