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
import sys
import time
from datetime import date

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from scraper.dedup import _similarity, canonical_key  # noqa: E402
from scraper.sports_ru import (  # noqa: E402
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
PAGE_BUDGET = 2000

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
COLLECT_RESERVE = PAGE_BUDGET // 2


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

    def select(self, path, cap=None):
        """Все строки под `path`, страницами. `cap` — сколько хватит.

        ⚠️ ПУТЬ ОБЯЗАН НЕСТИ `order=`, и это не стиль. Смещение без полного
        порядка сортировки Postgres выполнять волен как угодно: между двумя
        запросами строки могут переставиться, и тогда обход одну строку
        покажет дважды, а другую не покажет вовсе. Хуже всего то, что
        результат при этом правдоподобен — просто в нём кого-то нет.
        """
        assert "order=" in path, "select() paginates, so the path must order: " + path
        rows, offset = [], 0
        sep = "&" if "?" in path else "?"
        while True:
            want = self.PAGE_ROWS if cap is None else min(self.PAGE_ROWS, cap - len(rows))
            if want <= 0:
                break
            r = self.session.get(
                "{}{}{}limit={}&offset={}".format(self.url, path, sep, want, offset),
                timeout=60,
            )
            r.raise_for_status()
            batch = r.json()
            rows.extend(batch)
            # Короткая страница — последняя. Полная не доказывает, что есть
            # следующая, поэтому лишний пустой запрос здесь допустим: он стоит
            # одного round-trip, а его отсутствие стоило бы половины таблицы.
            if len(batch) < want:
                break
            offset += len(batch)
        return rows

    def upsert(self, table, rows, on_conflict):
        if not rows:
            return 0
        written = 0
        for i in range(0, len(rows), 500):
            batch = rows[i:i + 500]
            r = self.session.post(
                "{}/{}?on_conflict={}".format(self.url, table, on_conflict),
                json=batch,
                headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
                timeout=90,
            )
            if r.status_code >= 300:
                raise RuntimeError(
                    "{} upsert {}: {}".format(table, r.status_code, r.text[:400])
                )
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


def resolve_by_name(fetcher, card):
    """Slug for a card whose squad page never listed it, or None.

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
    """
    name_en = (card.get("name_en") or "").strip()
    if not name_en:
        return None
    for candidate in slug_candidates(name_en):
        html = fetcher.get("{}/football/person/{}/".format(BASE, candidate))
        if html is None:
            continue
        page_name, _ = parse_person_names(html)
        if not page_name:
            continue
        score = _similarity(canonical_key(card["name"]), canonical_key(page_name))
        if score >= SLUG_VERIFY_RATIO:
            return candidate
    return None


def resolve_slugs(fetcher, db, dry_run=False, guess=True):
    """Crawl league tables and squads, map squad names onto cards.

    Two passes, in this order because the first is authoritative and cheap per
    player (one page yields a whole squad) while the second costs one or two
    requests per player and rests on a verified guess.
    """
    cards = db.select(
        "/cards?select=id,name,name_en&active=eq.true&category=eq.player&order=id"
    )
    cards_by_key = {}
    for c in cards:
        cards_by_key.setdefault(canonical_key(c["name"]), c)
    print("cards in deck: {}".format(len(cards)))

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
        current = db.select("/card_current_club?select=card_id&order=card_id")
        wanted = {c["card_id"] for c in current} - seen_cards
        known = {p["card_id"] for p in db.select("/sports_ru_player?select=card_id&order=card_id")}
        todo = [c for c in cards if c["id"] in wanted and c["id"] not in known]
        print("guessing slugs for {} cards not on any squad page".format(len(todo)))
        guessed = 0
        for card in todo:
            if fetcher.remaining <= COLLECT_RESERVE:
                print("  reserve reached ({} pages left), leaving the rest for collect"
                      .format(fetcher.remaining))
                break
            try:
                slug = resolve_by_name(fetcher, card)
            except RuntimeError:  # budget spent — keep what we have
                print("  budget spent, stopping the guess pass")
                break
            if slug:
                guessed += 1
                rows.append({"card_id": card["id"], "slug": slug,
                             "name_ru": card["name"], "club_slug": None})
        print("guessed and verified: {}".format(guessed))

    if dry_run:
        for r in rows[:10]:
            print("   {} -> {}".format(r["name_ru"], r["slug"]))
        return len(rows)
    # Two cards can propose the same slug (a fuzzy name match on both sides);
    # `slug` is UNIQUE, so the batch must not carry the pair or the whole
    # upsert 409s. First card wins — the squad pass runs first and is the
    # authoritative one.
    deduped, used = [], set()
    for r in rows:
        if r["slug"] in used:
            continue
        used.add(r["slug"])
        deduped.append(r)
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
    if do_resolve:
        print("-- resolve --")
        print("slug map rows: {}".format(resolve_slugs(fetcher, db, args.dry_run)))
    if do_collect:
        print("-- collect --")
        print("match rows written: {}".format(
            collect_stats(fetcher, db, args.limit, args.dry_run)))
    print("pages fetched: {}".format(fetcher.count))
    return 0


if __name__ == "__main__":
    sys.exit(main())
