"""Nightly per-match football statistics from sports.ru.

    python3 sports_ru_stats.py                 # resolve new slugs, then collect
    python3 sports_ru_stats.py --resolve       # only rebuild the slug map
    python3 sports_ru_stats.py --collect       # only read stat pages
    python3 sports_ru_stats.py --dry-run       # fetch and parse, write nothing
    python3 sports_ru_stats.py --limit 50      # cap players read this run

WHY TWO STEPS. A slug cannot be derived from a name — Zenit's "Нино" lives at
`marcilio-florencia-mota-filho` — so it has to be crawled off club squad pages
and stored. That crawl is slow and almost never changes an answer, while the
stat pages change every matchday. Splitting them lets the nightly run spend its
requests on the half that actually moves.

THE CHAIN, every link checked against robots.txt with urllib.robotparser:

    /football/club/<seed>/table/  -> the league's other club slugs
    /football/club/<slug>/team/   -> (player slug, Russian name)
    /football/person/<slug>/stat/ -> one row per match, with a date

`/stat/` in robots.txt is a PREFIX rule: it closes `sports.ru/stat/…`, not
`/football/person/<slug>/stat/`. `/api/`, `/ajax/` and `/search/` are closed,
which is why the slug map is crawled instead of searched, and why only the
current season is reachable (the season picker posts to /ajax/, and a
?season= query string is ignored — the page returns the current season
regardless). The yearly window therefore fills in as this table accumulates.

Environment: SUPABASE_URL, SUPABASE_KEY (service role — the tables are closed
to anon by design).
"""
import argparse
import os
import re
import sys
import time
from datetime import date

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from scraper.dedup import _similarity, canonical_key  # noqa: E402
from scraper.sports_ru import (  # noqa: E402
    fold_latin,
    parse_club_slugs,
    parse_match_rows,
    parse_person_names,
    parse_squad,
    parse_totals,
    slug_candidates,
    totals_disagreement,
)

BASE = "https://m.sports.ru"
USER_AGENT = (
    "SherlockScholesBot/1.0 (Telegram mini app; football cards; "
    "+https://github.com/Aloews/sherlock-scholes-)"
)

# One club per league; the league TABLE page names the rest, so this list
# stays short and does not rot every time a club is promoted. Each slug was
# verified to answer 200 on /table/ (real-madrid and manchester-united answer
# 301, which is why their leagues are seeded from a sibling instead).
SEED_CLUBS = (
    "zenit",         # Россия
    "chelsea",       # Англия
    "barcelona",     # Испания
    "milan",         # Италия
    "bayern",        # Германия
    "psg",           # Франция
    "inter-miami",   # США
    "santos",        # Бразилия
    "al-nassr",      # Саудовская Аравия
)

# Two spellings of one player must match; two players must not. Measured on
# the real gap between the deck and the source: "Эрлинг Холанн"/"Эрлинг
# Холанд" score 0.917, "Кристиан Пулишич"/"Пулисич" 0.933, while two
# different people ("Лионель Месси"/"Луис Суарес") score 0.455.
NAME_MATCH_RATIO = 0.88

# A GUESSED slug is confirmed by reading the page header back and comparing it
# with the card that asked for it. The bar is lower than NAME_MATCH_RATIO
# because here both spellings are Russian and the disagreements are small and
# real — sports.ru writes "Дьокереш" where the deck writes "Дьёкереш" (0.93),
# "Рэшфорд" against "Рашфорд" (0.92), "Садьо" against "Садио" (0.89) — while a
# genuinely different player still lands far below.
SLUG_VERIFY_RATIO = 0.80

DELAY_SECONDS = 1.2
MAX_RETRIES = 4

# ⚠️ БЮДЖЕТ ПОДНЯТ С 2000, И ЭТО АРИФМЕТИКА, А НЕ ЖЕЛАНИЕ БОЛЬШЕГО. Прогон
# 12.09.2026: `pages fetched: 2000`, из них сбор дошёл до 1810 игроков из
# 2153 — то есть весь бюджет уходил в сбор, а шагу догадки не доставалось
# ничего. Догадка — единственный способ пополнить сам список игроков, и
# владелец просил статистику ВСЕХ, то есть именно её.
#
# Потолок ставит не осторожность, а время прогона: 3500 страниц по 1.2 с — это
# 70 минут выборки плюс ~20 минут на чтение и запись базы, при
# `timeout-minutes: 180` в player-stats.yml. Пауза между запросами НЕ
# тронута — вежливость к чужому серверу не размен.
PAGE_BUDGET = 3500

# Сколько страниц бюджета НЕ отдаётся резолву слагов.
#
# Бюджет один на оба шага, а резолв идёт первым — и до тех пор, пока сборщик
# видел тысячу карточек из 2919, это ничего не значило: догадываться было не о
# ком. Постраничное чтение открыло настоящий список, и кандидатов на догадку
# стало ~1130 (1248 карточек с клубом минус найденные в составах и уже
# известные). При одной-двух страницах на догадку резолв съедает весь бюджет,
# и на чтение статистики — то есть на ЕДИНСТВЕННЫЙ шаг, который наполняет
# рейтинг, — не остаётся ничего.
#
# Резерв делает приоритет явным: слаги можно дорезолвить завтра, а сутки
# матчей, не прочитанные сегодня, завтра уже не прочитаются — страница отдаёт
# один сезон целиком, но `checked_at`-порядок вращает список, и пропущенный
# игрок ждёт своей очереди.
# ⚠️ ЧИСЛОМ, А НЕ ДОЛЕЙ БЮДЖЕТА, И ЭТО СМЕНА ПРИОРИТЕТА. Половина от 3500 —
# это 1750 страниц сбору и почти столько же догадке; но сбор ВРАЩАЕТСЯ по
# `checked_at`, и непрочитанный сегодня игрок читается завтра, а не теряется.
# Карточка, до которой догадка не дошла, не появляется в списке НИКОГДА —
# пока до неё не дойдёт очередь, статистики у неё нет вовсе.
#
# 1200 хватает, чтобы каждый из 2153 слагов читался раз в двое суток; остаток
# (~2100 страниц, 700–1000 карточек за ночь) уходит догадке. При 24 093
# кандидатах это первый заход по всему списку примерно за месяц — против
# «первые 368 каждую ночь» до этой правки.
COLLECT_RESERVE = 1200


class Fetcher:
    """Polite GET with a delay, retries and a hard page budget."""

    def __init__(self, delay=DELAY_SECONDS, budget=PAGE_BUDGET):
        self.delay = delay
        self.budget = budget
        self.count = 0
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": USER_AGENT})
        self._last = 0.0

    @property
    def remaining(self):
        return max(0, self.budget - self.count)

    def get(self, url):
        """Page text, or None. A 404 is a real answer (the slug moved), not an
        error to retry — retrying it would burn the budget on a dead page."""
        if self.count >= self.budget:
            raise RuntimeError("page budget spent: {}".format(self.budget))
        for attempt in range(MAX_RETRIES):
            gap = time.monotonic() - self._last
            if gap < self.delay:
                time.sleep(self.delay - gap)
            self._last = time.monotonic()
            try:
                r = self.session.get(url, timeout=40)
                self.count += 1
                if r.status_code == 404:
                    return None
                if r.status_code == 200:
                    return r.text
                if r.status_code in (429, 500, 502, 503, 504):
                    time.sleep(2 ** attempt)
                    continue
                return None
            except requests.RequestException:
                time.sleep(2 ** attempt)
        return None


class Db:
    """PostgREST access. Nothing here is clever; the two traps are.

    ⚠️ Every UPSERT names its conflict target in the query string. Without
    `?on_conflict=…` PostgREST aims `merge-duplicates` at the primary key, and
    a genuine conflict on another unique column comes back as a 409 for the
    WHOLE batch. Same class of failure has bitten this repo twice.

    ⚠️ `merge-duplicates` emits ON CONFLICT DO UPDATE, so the key must hold
    UPDATE as well as INSERT. A writer with only INSERT writes nothing and
    still answers 200 — "285 read, 0 written", both numbers believable.

    ⚠️ И ЧТЕНИЕ ТОЖЕ НЕ ОТДАЁТ ВСЁ, О ЧЁМ ЕГО ПОПРОСИЛИ. `?limit=5000` сервер
    исполняет молча урезанным: PostgREST режет ответ по `db-max-rows`, и на
    этом проекте это 1000. Приходит HTTP 200, ровно тысяча строк и ни одного
    признака, что за ними есть ещё. Замер: `limit=5000` по `cards` вернул
    1000, а `Content-Range` того же запроса — `0-999/2919`. То есть оба
    сборщика видели ТРЕТЬ колоды и печатали «cards in deck: 1000» как
    нормальное число.
    """

    # Столько отдаёт PostgREST за раз (`db-max-rows` проекта). Просить больше
    # можно, получить — нет.
    PAGE_ROWS = 1000

    def __init__(self, url, key):
        self.url = url.rstrip("/") + "/rest/v1"
        self.session = requests.Session()
        self.session.headers.update(
            {"apikey": key, "Authorization": "Bearer " + key,
             "Content-Type": "application/json"}
        )

    # Коды, при которых запрос имеет смысл ПОВТОРИТЬ. 5xx значит «сервер не
    # справился», 408 и 429 — «не сейчас». Всё остальное из 4xx значит «запрос
    # рассмотрели и отвергли», и повтор даст тот же ответ столько раз, сколько
    # его послать.
    RETRY_CODES = {408, 429, 500, 502, 503, 504}

    def _get_with_retry(self, url, what):
        """GET, переживающий обрыв связи и неготовность сервера.

        ⚠️ ЭТОГО ЗДЕСЬ НЕ БЫЛО, И ПРОГОН ОТ ЭТОГО ПАДАЛ — ДВАЖДЫ И ПО-РАЗНОМУ.

            12.09.2026  resolve FAILED: ReadTimeout ... (read timeout=60)
            13.09.2026  resolve FAILED: HTTPError: 504 Server Error:
                        Gateway Timeout ... /cards?...&offset=5000

        Второе поймано ручным прогоном уже после починки первого, и это важно:
        `ReadTimeout` — исключение сети, а 504 приходит НОРМАЛЬНЫМ ответом и
        становится исключением только в `raise_for_status`. Повтор, написанный
        под один класс, второй пропускал бы.

        Для вызывающего разницы нет никакой: ответа нет, карта слагов за сутки
        не пополняется, прогон красный. Чтение к тому же ИДЕМПОТЕНТНО —
        повторять его безопаснее, чем запись, у которой повтор с 18.08.

        ⚠️ ПОВТОР НЕ ЛЕЧИТ ПРИЧИНУ 504, и притворяться иначе нельзя: сервер не
        успел, потому что его попросили о дорогом. Причина снята в `select`
        ниже — обходом по ключу вместо смещения.
        """
        for attempt in range(3):
            try:
                r = self.session.get(url, timeout=60)
            except (requests.Timeout, requests.ConnectionError) as exc:
                if attempt == 2:
                    raise
                self._pause(what, type(exc).__name__, attempt)
                continue
            if r.status_code in self.RETRY_CODES and attempt < 2:
                self._pause(what, "HTTP {}".format(r.status_code), attempt)
                continue
            r.raise_for_status()
            return r
        raise AssertionError("unreachable")  # pragma: no cover

    @staticmethod
    def _pause(what, why, attempt):
        wait = 2 ** (attempt + 1)
        print("   {} select: {} — повтор через {} с".format(what, why, wait),
              file=sys.stderr)
        time.sleep(wait)

    @staticmethod
    def _keyset_column(path):
        """Колонка для обхода по ключу — или None, если так нельзя.

        ⚠️ СМЕЩЕНИЕ НА БОЛЬШОЙ ТАБЛИЦЕ — ЭТО НЕ МЕДЛЕННО, ЭТО ОТКАЗ. Ручной
        прогон 13.09.2026 получил на шестой странице `cards`:

            504 Server Error: Gateway Timeout
            /cards?select=id,name,name_en&...&order=id&limit=1000&offset=5000

        `OFFSET 5000` заставляет Postgres построить и выбросить пять тысяч
        строк, и цена растёт с каждой страницей: к двадцать шестой это
        двадцать пять тысяч выброшенных строк ради нужной тысячи. Обход по
        ключу (`id=gt.<последний>`) стоит одинаково на любой странице — и
        заодно снимает то, о чём предупреждает `select`: при обходе по ключу
        строка не может ни задвоиться, ни пропасть, сколько бы их ни вставили
        между запросами.

        Так можно не всегда: ключ обязан быть ОДНОЙ колонкой, по возрастанию,
        и обязан быть в `select` — иначе последнюю строку не с чем сравнить.
        Составной порядок (`checked_at,card_id`) остаётся на смещении, и это
        безопасно: там таблица на две тысячи строк, то есть три страницы.
        """
        m = re.search(r"[?&]order=([^&]+)", path)
        if not m:
            return None
        order = m.group(1)
        if "," in order or ".desc" in order:
            return None
        col = order.split(".")[0]
        sel = re.search(r"[?&]select=([^&]+)", path)
        if not sel or col not in sel.group(1).split(","):
            return None
        return col

    def select(self, path, cap=None):
        """Все строки под `path`, страницами. `cap` — сколько хватит.

        ⚠️ ПУТЬ ОБЯЗАН НЕСТИ `order=`, и это не стиль. Смещение без полного
        порядка сортировки Postgres выполнять волен как угодно: между двумя
        запросами строки могут переставиться, и тогда обход одну строку
        покажет дважды, а другую не покажет вовсе. Хуже всего то, что
        результат при этом правдоподобен — просто в нём кого-то нет.

        Где можно, обход идёт ПО КЛЮЧУ, а не по смещению — разбор в
        `_keyset_column`. Где нельзя (составной порядок), остаётся смещение.
        """
        assert "order=" in path, "select() paginates, so the path must order: " + path
        key = self._keyset_column(path)
        what = path.split("?")[0].lstrip("/")
        sep = "&" if "?" in path else "?"
        rows, offset, last = [], 0, None
        while True:
            want = self.PAGE_ROWS if cap is None else min(self.PAGE_ROWS, cap - len(rows))
            if want <= 0:
                break
            if key:
                after = "&{}=gt.{}".format(key, last) if last is not None else ""
                url = "{}{}{}limit={}{}".format(self.url, path, sep, want, after)
            else:
                url = "{}{}{}limit={}&offset={}".format(self.url, path, sep, want, offset)
            batch = self._get_with_retry(url, what).json()
            rows.extend(batch)
            # Короткая страница — последняя. Полная не доказывает, что есть
            # следующая, поэтому лишний пустой запрос здесь допустим: он стоит
            # одного round-trip, а его отсутствие стоило бы половины таблицы.
            if len(batch) < want:
                break
            if key:
                last = batch[-1][key]
            else:
                offset += len(batch)
        return rows

    def delete_in(self, table, column, values):
        """Удалить строки, у которых `column` попал в `values`.

        Пачками по 200: список идёт В СТРОКЕ ЗАПРОСА, а у неё есть предел
        длины, о котором сервер сообщит отказом, а не усечением.
        """
        for i in range(0, len(values), 200):
            chunk = values[i:i + 200]
            r = self.session.delete(
                "{}/{}?{}=in.({})".format(
                    self.url, table, column, ",".join('"%s"' % v for v in chunk)
                ),
                headers={"Prefer": "return=minimal"},
                timeout=60,
            )
            if r.status_code >= 300:
                raise RuntimeError(
                    "{} delete {}: {}".format(table, r.status_code, r.text[:200])
                )

    @staticmethod
    def _pause_write(table, why, attempt):
        wait = 2 ** (attempt + 1)
        print("   {} upsert: {} — повтор через {} с".format(table, why, wait),
              file=sys.stderr)
        time.sleep(wait)

    def upsert(self, table, rows, on_conflict):
        """Записать пачками, пережив одиночный обрыв связи.

        ⚠️ ПОВТОР ПО СЕТИ И ПО 5xx, А НЕ ПО ВСЕМУ ПОДРЯД. Таймаут, обрыв и
        «сервер не справился» означают одно: ответа нет. Повтор осмыслен,
        потому что запись идемпотентна (merge-duplicates по одному ключу). А
        код 4xx означает «пачку рассмотрели и отвергли»: 409 на дубликате slug
        повторится столько же раз, сколько его послать. Такое падает сразу.

        ⚠️ 5xx ЗДЕСЬ НЕ БЫЛО, И ЭТО РОВНО ТА ЖЕ ОШИБКА, ЧТО УЖЕ ЧИНИЛАСЬ В
        `_get_with_retry`. Повтор стоял только на исключениях сети, а 504
        приходит НОРМАЛЬНЫМ ответом — и падал сразу:

            13.09.2026  RuntimeError: player_match_stats upsert 504:
                        {"message":"Gateway Timeout"}

        Это унесло обход на тринадцатой лиге из пятидесяти трёх, через сорок
        минут работы. Урок был записан выше по файлу дословно — «повтор,
        написанный под один класс, второй пропускал бы», — и не применён к
        записи только потому, что её чинили раньше и по другому поводу.

        ПОЧЕМУ ЭТО ПОЯВИЛОСЬ. Ночной прогон 18.08.2026 упал ровно здесь:
        `ReadTimeout ... (read timeout=90)` на одной пачке `sports_ru_player`.
        Пачки уже были по 500, то есть дело не в размере — Supabase просто не
        ответил. Одна такая заминка уносила весь сбор за сутки.
        """
        if not rows:
            return 0
        written = 0
        for i in range(0, len(rows), 500):
            batch = rows[i:i + 500]
            for attempt in range(3):
                try:
                    r = self.session.post(
                        "{}/{}?on_conflict={}".format(self.url, table, on_conflict),
                        json=batch,
                        headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
                        timeout=90,
                    )
                except (requests.Timeout, requests.ConnectionError) as exc:
                    if attempt == 2:
                        raise
                    self._pause_write(table, type(exc).__name__, attempt)
                    continue
                if r.status_code in self.RETRY_CODES and attempt < 2:
                    self._pause_write(table, "HTTP {}".format(r.status_code), attempt)
                    continue
                if r.status_code >= 300:
                    raise RuntimeError(
                        "{} upsert {}: {}".format(table, r.status_code, r.text[:400])
                    )
                break
            written += len(batch)
        return written


def match_card(name, cards_by_key):
    """Best card for a squad name, or None.

    Exact key first, then the fuzzy sweep — the deck and the source disagree on
    spelling often enough that exact equality alone would drop real players
    ("Холанн" vs "Холанд"), and loosely enough that a low threshold would start
    merging teammates.
    """
    key = canonical_key(name)
    if key in cards_by_key:
        return cards_by_key[key]
    best, best_score = None, 0.0
    for other_key, card in cards_by_key.items():
        score = _similarity(key, other_key)
        if score > best_score:
            best, best_score = card, score
    return best if best_score >= NAME_MATCH_RATIO else None


def resolve_by_name(fetcher, card, max_candidates=None):
    """Slug for a card whose squad page never listed it, or None.

    `max_candidates` обрезает перебор сверху; None — перебирать все формы.
    Зачем — в `_candidate_budget`.

    WHY THIS EXISTS. sports.ru server-renders the squad table for Russian clubs
    and leaves it EMPTY for foreign ones — Chelsea's squad block is literally
    `<div> </div>`, and /football/sportsman/ is client-rendered too. So for
    most of the deck there is no page that hands over the slug, and it has to
    be proposed from the Latin name instead.

    Guessing is only safe because the guess is CHECKED: the page header prints
    the player's Russian name, and it is compared against the card that asked.
    A wrong guess that 404s costs one request; a wrong guess that returns a
    real page — a different player with a similar name — is rejected here
    rather than being written in as that player's goals. Measured on the 40
    most famous cards: 34 resolved, 2 pages rejected by the name check.

    ⚠️ СВЕРЯЮТСЯ ОБА НАПИСАНИЯ, И РАНЬШЕ ВТОРОЕ ВЫБРАСЫВАЛОСЬ. Заголовок
    страницы печатает и русское имя, и латинское, а код брал только русское и
    ронял латинское в `_`. Из-за этого верная страница отвергалась на
    расхождении ТРАНСЛИТЕРАЦИИ, а не игрока: карточка «Уго Экитике», страница
    «Юго Экитике» — 0.70 при пороге 0.80, отказ. Латинское написание на той же
    странице — «Hugo Ekitike», то есть ровно `name_en` карточки, 1.00.

    Порог НЕ снижен: он и есть защита от чужого игрока. Добавлено второе
    независимое свидетельство, и достаточно любого из двух. Циркулярности тут
    нет: слаг предлагается из имени, но сверяется ПОЛНОЕ имя со страницы, так
    что догадка `fernandez`, попавшая на другого Фернандеса, даёт низкую
    похожесть по обоим написаниям и отвергается по-прежнему.
    """
    name_en = (card.get("name_en") or "").strip()
    if not name_en:
        return None
    card_ru = canonical_key(card["name"])
    card_en = canonical_key(fold_latin(name_en))
    candidates = slug_candidates(name_en)
    if max_candidates is not None:
        candidates = candidates[:max_candidates]
    for candidate in candidates:
        html = fetcher.get("{}/football/person/{}/".format(BASE, candidate))
        if html is None:
            continue
        page_ru, page_en = parse_person_names(html)
        if not page_ru and not page_en:
            continue
        score = 0.0
        if page_ru:
            score = max(score, _similarity(card_ru, canonical_key(page_ru)))
        if page_en:
            score = max(score, _similarity(card_en, canonical_key(fold_latin(page_en))))
        if score >= SLUG_VERIFY_RATIO:
            return candidate
    return None


def guess_order(cards, wanted, known, misses, club_value=None):
    """Очередь шага догадки: кого пробовать сегодня и в каком порядке.

    ⚠️ ПОРЯДОК ЗДЕСЬ — НЕ ОФОРМЛЕНИЕ, А РАЗНИЦА МЕЖДУ «СОБЕРЁМ ВСЕХ» И
    «НЕ СОБЕРЁМ НИКОГДА». Раньше кандидаты шли в порядке `id`, а бюджет
    кончается на первых сотнях: каждую ночь перебирались одни и те же
    карточки, а остальные двадцать тысяч не пробовались НИ РАЗУ. Замер по
    прогону 11.09.2026 — угаданы ранги с 5-го по 368-й из 24 093.

    Ключ сортировки — (сколько раз пробовали, когда пробовали в последний
    раз, известность наоборот), а «не пробовали ни разу» это (-1, "") и идёт
    раньше всего. Значит очередь двигается: каждую ночь берутся новые, а к
    старым отказам она возвращается, только когда новых не осталось.

    ⚠️ ТРЕТИЙ КЛЮЧ — НЕ УКРАШЕНИЕ, И БЕЗ НЕГО САМЫХ ИЗВЕСТНЫХ НЕ ПРОБОВАЛИ
    ВОВСЕ. У всех непробованных первые два ключа одинаковы — (-1, ""), — а
    сортировка в питоне устойчива, то есть внутри этой группы порядок
    оставался тем, в котором карточки пришли из базы: по `id`. Бюджет
    кончается на первой тысяче из двадцати с лишним, и кто попадёт в эту
    тысячу, решал номер карточки.

    Замер на боевой базе 15.09.2026, карточки с известностью 70+ и БЕЗ
    статистики: у всех тридцати `tried = 0`. Среди них Тьерри Анри
    (известность 100), Родриго (97), Серхио Агуэро (96), Дани Карвахаль (95),
    Войцех Щенсный (94), Марко Верратти (89) — то есть ровно те, кого колода
    сдаёт чаще всего, не пробовались НИ РАЗУ, пока тысячи карточек без единого
    просмотра в википедии пробовались каждую ночь.

    Известность — это и есть порядок, в котором колода сдаёт карточки
    (`cards.fame`, перцентиль по просмотрам), так что «сначала известные»
    значит «сначала те, чью статистику игрок увидит». Карточка без
    известности считается нулём и идёт после — не выбрасывается, а уступает.

    ⚠️ ПЕРЕД ИЗВЕСТНОСТЬЮ СТОИТ СТОИМОСТЬ КЛУБА, И ЭТО ДАЁТ БОЛЬШЕ ЗА ТЕ ЖЕ
    СТРАНИЦЫ. Замер 20.09.2026: без статистики 12 824 карточки в 1191 клубе,
    но в пятидесяти самых дорогих клубах их всего 235 — при том что на эти
    полсотни приходится 26.2 млрд евро из 51.1, то есть половина стоимости
    всего охваченного футбола. Двести тридцать пять страниц — это пять минут
    обхода; те же пять минут, потраченные по порядку `id`, не закрывают ни
    одного клуба целиком.

    Стоимость клуба и известность игрока связаны, но не совпадают: в дорогом
    клубе есть молодой запасной без единого просмотра в википедии, и именно
    он чаще всего и оказывается пропущенным. Поэтому ключа два, и клуб
    первый.

    Насовсем не выбрасывается никто: страница у игрока может появиться
    завтра, и отметка отказа — не приговор, а место в очереди.
    """
    value = club_value or {}
    todo = [c for c in cards if c["id"] in wanted and c["id"] not in known]
    todo.sort(key=lambda c: misses.get(c["id"], (-1, ""))
                            + (-float(value.get(c.get("club_key")) or 0.0),
                               -float(c.get("fame") or 0.0)))
    return todo


def active_cards_by_key(cards, current_club_ids):
    """Cards eligible for squad-page name matching, keyed by canonical_key.

    Excludes any card with no card_current_club row — the same "no current
    club, nothing to collect" signal the guess pass below already applies,
    just applied here too. A squad page lists REAL, CURRENTLY FIELDED
    players, and matching purely by canonical_key breaks the moment a
    retired legend's bare-name card (no surname to disambiguate) shares that
    name with whoever a club just fielded.

    MEASURED, NOT HYPOTHETICAL. Ronaldo (b.1976, retired ~2011, card name is
    the bare "Роналдо" — the world knows him by nothing else) picked up a
    currently-active FC Rostov player's match_stats this way: same
    canonical_key, different human, and the squad pass had no way to tell.
    Found on the boevaya baza 24.08.2026 — seven sports.ru rows plus two ESPN
    rows, all real matches played by someone who is not this card.

    A missed match for an active player whose card_current_club hasn't
    caught up yet is the safe direction to fail in; attributing a stranger's
    goals to a retired legend's card is not — the same rule this project
    already applies everywhere else a guess can be wrong in either direction.
    """
    by_key = {}
    for c in cards:
        if c["id"] not in current_club_ids:
            continue
        by_key.setdefault(canonical_key(c["name"]), c)
    return by_key


# Сколько форм имени пробовать на карточку за один заход.
#
# ⚠️ ЭТО ПРО СКОРОСТЬ ПЕРВОГО ОБХОДА, А НЕ ПРО ОТКАЗ ОТ РЕДКИХ ФОРМ.
# `slug_candidates` даёт четыре формы: полное имя, хвост после первого слова,
# голая фамилия, голое имя. Замер по 727 угаданным карточкам (15.09.2026):
#
#     кандидат #1 — 711 (98%), #2 — 11 (2%), #3 — 4 (1%), #4 — 1 (0%)
#
# Но перебор платит за промахи: карточка, которой на sports.ru нет вовсе,
# стоит ЧЕТЫРЕ страницы вместо одной, и таких примерно половина (635 отказов
# на 727 попаданий). Средняя цена карточки выходит 2.41 страницы, а при двух
# формах — 1.48. При ночном бюджете догадки в 2300 страниц это 1554 карточки
# за ночь вместо 954, то есть первый обход 21712 кандидатов занимает около
# двадцати трёх ночей вместо тридцати восьми.
#
# ⚠️ ФОРМЫ НЕ ВЫБРАСЫВАЮТСЯ, А ОТКЛАДЫВАЮТСЯ НА ВТОРОЙ ЗАХОД, и это
# принципиально. Именно #4 — голое имя — ловит бразильцев, играющих под
# именем: «Vinícius Júnior» живёт на `/football/person/vinicius/`, и обрезать
# её насовсем значило бы потерять ровно самых известных. Очередь промахов уже
# упорядочена «сначала те, кого не пробовали, потом реже и давнее», так что
# второй заход по карточке физически наступает после того, как весь список
# прошли по разу. Редкая форма достаётся тому, у кого частая не сработала, —
# и достаётся ПОСЛЕ, а не вместо.
FIRST_PASS_CANDIDATES = 2


def _candidate_budget(tries):
    """Сколько форм имени отдать карточке, которую пробовали `tries` раз."""
    return FIRST_PASS_CANDIDATES if tries <= 0 else None


def resolve_slugs(fetcher, db, dry_run=False, guess=True, reserve=COLLECT_RESERVE):
    """Crawl league tables and squads, map squad names onto cards.

    Two passes, in this order because the first is authoritative and cheap per
    player (one page yields a whole squad) while the second costs one or two
    requests per player and rests on a verified guess.
    """
    # `fame` читается ради порядка очереди догадки (см. `guess_order`): без
    # неё самые известные карточки не пробовались ни разу.
    cards = db.select(
        "/cards?select=id,name,name_en,fame,market_value_eur"
        "&active=eq.true&category=eq.player&order=id"
    )
    # `club_key` читается ради приоритета очереди догадки (см. `guess_order`):
    # самые дорогие клубы закрываются первыми.
    club_of = {c["card_id"]: c.get("club_key")
               for c in db.select(
                   "/card_current_club?select=card_id,club_key&order=card_id")}
    current_club_ids = set(club_of)
    cards_by_key = active_cards_by_key(cards, current_club_ids)
    print("cards in deck: {}, with a current club: {}".format(len(cards), len(current_club_ids)))

    club_slugs = []
    for seed in SEED_CLUBS:
        html = fetcher.get("{}/football/club/{}/table/".format(BASE, seed))
        found = parse_club_slugs(html) if html else []
        print("  seed {:<14} -> {} clubs".format(seed, len(found)))
        for slug in found:
            if slug not in club_slugs:
                club_slugs.append(slug)
    print("clubs to read: {}".format(len(club_slugs)))

    rows, unmatched = [], 0
    seen_cards = set()
    for slug in club_slugs:
        html = fetcher.get("{}/football/club/{}/team/".format(BASE, slug))
        if not html:
            continue
        for player in parse_squad(html):
            card = match_card(player["name_ru"], cards_by_key)
            if not card:
                unmatched += 1
                continue
            if card["id"] in seen_cards:
                continue
            seen_cards.add(card["id"])
            rows.append(
                {
                    "card_id": card["id"],
                    "slug": player["slug"],
                    "name_ru": player["name_ru"],
                    "club_slug": slug,
                }
            )

    print("from squads: {} cards, {} squad names had no card".format(len(rows), unmatched))

    # Second pass: everyone a squad page never named. Restricted to cards with
    # a current club, because a retired player has no matches to collect and
    # asking for his page every night is a request spent on a certainty.
    if guess:
        wanted = current_club_ids - seen_cards
        known = {p["card_id"] for p in db.select("/sports_ru_player?select=card_id&order=card_id")}
        # ⚠️ ПАМЯТЬ ОБ ОТКАЗЕ, И БЕЗ НЕЁ ШАГ ХОДИЛ ПО КРУГУ. Кандидаты шли в
        # порядке id, а бюджет кончается на первых сотнях — то есть каждую
        # ночь перебирались ОДНИ И ТЕ ЖЕ карточки, а остальные двадцать тысяч
        # не пробовались ни разу. Замер по прогону 11.09.2026: угаданы ранги с
        # 5-го по 368-й из 24 093. При таком порядке «собрать всех» —
        # недостижимо в принципе, а не медленно.
        #
        # Отказ теперь записывается, и очередь строится по нему: сначала те,
        # кого не пробовали ВОВСЕ, потом те, кого пробовали реже и давнее.
        # Ни один кандидат не выбрасывается навсегда — страница у игрока может
        # появиться, — но и не отнимает попытку у ни разу не виденного.
        misses = {
            m["card_id"]: (m.get("tries") or 1, m.get("tried_at") or "")
            for m in db.select(
                "/sports_ru_no_slug?select=card_id,tried_at,tries&order=card_id")
        }
        # Стоимость клуба — сумма стоимостей его игроков в колоде. Считается
        # здесь, а не запросом: обе половины уже прочитаны выше.
        club_value = {}
        for c in cards:
            k = club_of.get(c["id"])
            if k:
                club_value[k] = club_value.get(k, 0.0) + float(c.get("market_value_eur") or 0.0)
        for c in cards:
            c["club_key"] = club_of.get(c["id"])
        todo = guess_order(cards, wanted, known, misses, club_value)
        fresh = sum(1 for c in todo if c["id"] not in misses)
        print("guessing slugs for {} cards not on any squad page ({} ни разу не пробованы)"
              .format(len(todo), fresh))
        guessed, tried, failed, resolved_ids = 0, 0, [], []

        # ⚠️ ОТМЕТКИ ПИШУТСЯ ПАЧКАМИ ПО ХОДУ, А НЕ ОДНИМ ЗАЛПОМ В КОНЦЕ.
        # Раньше весь `failed` копился в памяти до последней строки цикла, и
        # это возвращало ровно ту поломку, ради которой таблица заведена:
        # прогон, убитый на середине прохода — `timeout-minutes: 180` в
        # player-stats.yml, падение, снятый контейнер, — не записывал НИ ОДНОЙ
        # отметки. Очередь не сдвигалась, и следующей ночью перебирались те же
        # первые сотни карточек. Выход по резерву и по бюджету до записи
        # доходил, а вот убитый процесс — нет, и различить эти два случая по
        # таблице было нельзя: она одинаково пуста.
        #
        # Пачкой, а не построчно, потому что запрос на карточку — это лишняя
        # секунда на каждую из двух тысяч; 200 строк на upsert держат обещание
        # «убили — потеряли последние двести», а не «потеряли всё».
        FLUSH_EVERY = 200

        def flush():
            """Отдать накопленные отметки и успехи базе и очистить буферы."""
            if dry_run:
                failed.clear()
                resolved_ids.clear()
                return
            # Записывается ОТДЕЛЬНО от найденных: это другая таблица и другой
            # смысл. Успех — строка справочника; отказ — отметка «тут уже
            # смотрели», без которой очередь выше не сдвинется ни на шаг.
            if failed:
                db.upsert("sports_ru_no_slug", failed, "card_id")
                failed.clear()
            # ⚠️ УСПЕХ ТОЖЕ СТИРАЕТ ОТМЕТКУ — иначе однажды не найденный игрок
            # навсегда остался бы в хвосте очереди, хотя страница у него уже
            # есть.
            if resolved_ids:
                db.delete_in("sports_ru_no_slug", "card_id", resolved_ids)
                resolved_ids.clear()

        for card in todo:
            if fetcher.remaining <= reserve:
                print("  reserve reached ({} pages left), leaving the rest for collect"
                      .format(fetcher.remaining))
                break
            prev = misses.get(card["id"])
            try:
                slug = resolve_by_name(
                    fetcher, card,
                    max_candidates=_candidate_budget(prev[0] if prev else 0))
            except RuntimeError:  # budget spent — keep what we have
                print("  budget spent, stopping the guess pass")
                break
            tried += 1
            if slug:
                guessed += 1
                resolved_ids.append(card["id"])
                rows.append({"card_id": card["id"], "slug": slug,
                             "name_ru": card["name"], "club_slug": None})
            else:
                failed.append({"card_id": card["id"], "tried_at": _now_iso(),
                               "tries": (prev[0] + 1) if prev else 1})
            # Проход идёт сорок минут и до этой строки не печатал НИЧЕГО.
            # Молчащий шаг неотличим от повисшего: сорок минут тишины при
            # живом процессе уже стоили одного разбирательства «почему в базе
            # ноль попыток». Строка раз в двести карточек — это раз в
            # несколько минут, не поток.
            if tried % FLUSH_EVERY == 0:
                flush()
                print("  ... {}/{}, угадано {}, страниц осталось {}"
                      .format(tried, len(todo), guessed, fetcher.remaining),
                      flush=True)
        print("tried {}, guessed and verified: {}".format(tried, guessed))
        flush()

    if dry_run:
        for r in rows[:10]:
            print("   {} -> {}".format(r["name_ru"], r["slug"]))
        return len(rows)
    # Two cards can propose the same slug (a fuzzy name match on both sides);
    # `slug` is UNIQUE, so the batch must not carry the pair or the whole
    # upsert 409s. First card wins — the squad pass runs first and is the
    # authoritative one.
    #
    # ⚠️ И ЗАНЯТЫЕ В ТАБЛИЦЕ — ТОЖЕ. Внутрипачечной проверки НЕ ХВАТИЛО, и
    # прогон 06.09.2026 умер на ней целиком:
    #
    #   sports_ru_player upsert 409: Key (slug)=(alexis-mac-allister)
    #   already exists
    #
    # Запись идёт `on conflict (card_id)`, а уникален ещё и `slug`: строка с
    # ДРУГИМ card_id и тем же slug конфликт по карточке не разрешает, и
    # Postgres отвергает пачку целиком. Так и вышло — в колоде оказались две
    # карточки одного игрока (их наплодил шаг заведения карточек из заявок), и
    # вторая предложила slug, уже занятый первой.
    #
    # Занятый чужой карточкой slug пропускаем: справочник от этого не
    # пострадает — у игрока уже есть строка, — а пачка перестаёт падать.
    taken = {}
    for row in db.select("/sports_ru_player?select=card_id,slug&order=card_id"):
        if row.get("slug"):
            taken[row["slug"]] = row["card_id"]

    deduped, used, skipped = [], set(), 0
    for r in rows:
        if r["slug"] in used:
            continue
        holder = taken.get(r["slug"])
        if holder is not None and holder != r["card_id"]:
            skipped += 1
            continue
        used.add(r["slug"])
        deduped.append(r)
    if skipped:
        # ⚠️ ПЕЧАТАЕМ, А НЕ ГЛОТАЕМ: пропущенный slug почти всегда значит, что
        # в колоде две карточки одного человека, и это стоит увидеть.
        print("slugs already held by another card: {} (дубли карточек?)"
              .format(skipped))
    return db.upsert("sports_ru_player", deduped, "card_id")


def collapse_duplicate_keys(rows):
    """Одна строка на (карточка, дата, турнир) — иначе пачку отвергнут целиком.

    ⚠️ ЭТО НЕ ПЕРЕСТРАХОВКА, А ПОЧИНКА ПАДЕНИЯ. Прогон 17.08 прочитал 632
    страницы, собрал 16908 строк и умер на записи:

        ON CONFLICT DO UPDATE command cannot affect row a second time

    Postgres не даёт одному оператору дважды тронуть одну строку, и PostgREST
    отвергает при этом ВСЮ пачку. Часть пачек до отказа успела записаться, то
    есть прогон закончился наполовину применённым — худший из возможных
    исходов.

    ОТКУДА БЕРУТСЯ ДУБЛИ. Ключ — (card_id, match_date, tournament), а турнир
    пишется как `row["tournament"] or "—"`. Прочерк — не название, а признак
    «не разобрали»: два матча одного дня с неразобранным турниром получают
    ОДИН ключ, хотя это разные турниры. Запасное значение само изготавливает
    коллизию. Настоящий турнир в двух матчах одного дня совпасть не может.

    ПОЧЕМУ ВЫБИРАЕМ, А НЕ СУММИРУЕМ. Сумма была бы верна, если дубль — два
    РАЗНЫХ матча, и врала бы вдвое, если это один матч, разобранный дважды.
    Причину прогон не сообщает, а между «недосчитать» и «выдумать гол» этот
    проект всегда выбирает первое. Выигрывает строка, которая знает больше:
    сначала с минутами, потом с большей отдачей, потом первая по порядку —
    чтобы ответ не менялся от прогона к прогону.

    Схлопнутое печатается: коллизия должна оставаться видимой, иначе
    прочерк-турнир будет тихо съедать по матчу и дальше.
    """
    best = {}
    order = []
    collapsed = []
    for r in rows:
        key = (r["card_id"], r["match_date"], r["tournament"])
        prev = best.get(key)
        if prev is None:
            best[key] = r
            order.append(key)
            continue
        rank = lambda x: (x["minutes"] is not None, x["goals"] + x["assists"])
        collapsed.append((key, prev, r))
        if rank(r) > rank(prev):
            best[key] = r

    if collapsed:
        print("collapsed {} duplicate keys (same card+date+tournament):"
              .format(len(collapsed)))
        for key, a, b in collapsed[:5]:
            print("     {} {} «{}»: {}–{} vs {}–{}".format(
                key[0][:8], key[1], key[2],
                a.get("home_team"), a.get("away_team"),
                b.get("home_team"), b.get("away_team")))
    return [best[k] for k in order]


def collect_stats(fetcher, db, limit=None, dry_run=False):
    """Read stat pages least-recently-checked first and write the matches.

    The order matters: a run cut short by the budget still advances instead of
    re-reading the same head of the list every night.
    """
    # `card_id` дописан в порядок вторым ключом не для красоты: `checked_at`
    # у непрочитанных карточек одинаково пуст, а обход идёт страницами по
    # смещению — при неполном порядке страницы могут перекрыться, и часть
    # игроков не была бы прочитана ни разу.
    path = ("/sports_ru_player?select=card_id,slug,name_ru"
            "&order=checked_at.asc.nullsfirst,card_id.asc")
    players = db.select(path, cap=int(limit) if limit else None)
    print("players to read: {}".format(len(players)))

    stats, checked, suspect = [], [], []
    for p in players:
        try:
            html = fetcher.get("{}/football/person/{}/stat/".format(BASE, p["slug"]))
        except RuntimeError:
            # Бюджет кончился посреди обхода. Выход, а не исключение: всё
            # прочитанное лежит в `stats` и пишется ниже, а необработанный
            # RuntimeError выбросил бы целую ночь чтения ради строки в логе.
            # Ровно этого опасается комментарий про потолок в workflow —
            # «закончиться бюджетом, а не обрывом посреди записи».
            print("  budget spent after {} players, writing what was read"
                  .format(len(checked)))
            break
        if html is None:
            print("  !! {} ({}): page gone".format(p["name_ru"], p["slug"]))
            continue
        rows = parse_match_rows(html)

        # The page prints its own "Всего" line. Comparing it with the summed
        # rows turns a silent markup shift — the failure mode that once read
        # three of Haaland's assists as goals — into a loud one. A player whose
        # numbers disagree is skipped rather than written wrong.
        gap = totals_disagreement(rows, parse_totals(html))
        if gap:
            suspect.append((p["name_ru"], gap))
            continue

        for row in rows:
            stats.append(
                {
                    "card_id": p["card_id"],
                    "match_date": row["date"].isoformat(),
                    "tournament": row["tournament"] or "—",
                    "home_team": row["home"],
                    "away_team": row["away"],
                    "home_score": row["home_score"],
                    "away_score": row["away_score"],
                    "minutes": row["minutes"],
                    "goals": row["goals"],
                    "assists": row["assists"],
                    "yellow": row["yellow"],
                    "red": row["red"],
                }
            )
        checked.append({"card_id": p["card_id"], "slug": p["slug"],
                        "checked_at": _now_iso()})

    print("parsed {} match rows from {} players".format(len(stats), len(checked)))
    if suspect:
        print("!! {} players disagreed with their own page total:".format(len(suspect)))
        for name, gap in suspect[:10]:
            print("     {}: {}".format(name, gap))

    stats = collapse_duplicate_keys(stats)

    if dry_run:
        for s in stats[:10]:
            print("   {} {} {}г {}п".format(s["match_date"], s["tournament"],
                                            s["goals"], s["assists"]))
        return len(stats)

    written = db.upsert("player_match_stats", stats,
                        "card_id,match_date,tournament")
    db.upsert("sports_ru_player", checked, "card_id")
    return written


def _now_iso():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--resolve", action="store_true", help="rebuild the slug map only")
    ap.add_argument("--collect", action="store_true", help="read stat pages only")
    ap.add_argument("--limit", type=int, help="cap players read this run")
    ap.add_argument("--dry-run", action="store_true", help="fetch and parse, write nothing")
    ap.add_argument("--budget", type=int, default=PAGE_BUDGET, help="max pages to fetch")
    # Резерв сбора — флагом, чтобы ручной прогон мог проверить шаг догадки, не
    # тратя весь ночной бюджет. По умолчанию тот же, что у расписания.
    ap.add_argument("--reserve", type=int, default=COLLECT_RESERVE,
                    help="pages kept for the collect pass")
    args = ap.parse_args()

    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not url or not key:
        print("SUPABASE_URL / SUPABASE_KEY are required", file=sys.stderr)
        return 2

    fetcher = Fetcher(budget=args.budget)
    db = Db(url, key)
    do_resolve = args.resolve or not args.collect
    do_collect = args.collect or not args.resolve

    print("=== sports.ru player stats, {} ===".format(date.today().isoformat()))

    # ⚠️ КАРТА СЛАГОВ НЕ ДОЛЖНА УНОСИТЬ СБОР, и это тот же принцип, по которому
    # в player-stats.yml у шага ESPN стоит `if: always()`: два независимых дела
    # в одном прогоне, и падение первого не отменяет второе.
    #
    # Цена ошибки здесь несимметрична. Карта слагов — ОБНОВЛЕНИЕ справочника:
    # не собралась сегодня — соберётся завтра, вчерашняя на месте. Сбор
    # статистики — сам продукт: пропущенные сутки не догоняются, потому что
    # страница матча показывает последние туры, а не архив.
    #
    # Ровно так это и стоило: 18.08.2026 таймаут одной пачки в resolve_slugs
    # уронил процесс, и сбор за сутки не случился вовсе — в таблице остались
    # позавчерашние 23971 строка.
    failed = None
    if do_resolve:
        print("-- resolve --")
        try:
            print("slug map rows: {}".format(
                resolve_slugs(fetcher, db, args.dry_run, reserve=args.reserve)))
        except Exception as exc:  # noqa: BLE001 — причина печатается целиком
            failed = exc
            print("resolve FAILED: {}: {}".format(type(exc).__name__, exc), file=sys.stderr)
            print("   продолжаем сбор: справочник переживёт сутки, статистика нет",
                  file=sys.stderr)

    if do_collect:
        print("-- collect --")
        print("match rows written: {}".format(
            collect_stats(fetcher, db, args.limit, args.dry_run)))

    print("pages fetched: {}".format(fetcher.count))

    # Прогон всё равно КРАСНЫЙ, если что-то упало: молчаливая половинчатая
    # работа — это то, ради чего в этом репозитории заведены все проверки.
    # Но упавшая половина уже не мешает целой.
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
