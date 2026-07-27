"""Re-measure cards.pageviews for cards that were scored by the WRONG article.

WHY: --cards-pageviews assumed the ruwiki article is titled exactly like the
card and tried the bare name FIRST. For a club the bare name is usually the
city, so the deck ended up measuring the wrong thing entirely:

    «Краснодар» 767 074   -> the CITY's article
    «Астана»    707 761   -> the capital of Kazakhstan
    «Оренбург»  580 864   -> the city
    «Сатурн»    368 643   -> the planet
    «Брест»     255 299   -> the town in Belarus

Those numbers drive the Easy/Hard threshold and the "popular cards first"
ordering, so a mid-table club outranked Barcelona. run.py now resolves
pageviews through the same variant-first order the photo step uses, which
stops NEW cards from being mismeasured; this script repairs the rows already
stored, which --cards-pageviews will never revisit (it reads only NULLs).

HOW: for each non-player card, resolve the article the way the photo/description
steps do — "<name> (футбольный клуб)" / "(стадион)" first, then the bare name,
with the P31 guard rejecting the city or the person. If the resolved article
is NOT the bare card name, the stored score came from a different page: the
correct article's views are fetched for the same season window and written.

The resolution is nearly free: the descriptions run already cached every
club's title and QID. Only the pageviews themselves are fetched.

DRY-RUN BY DEFAULT — prints БЫЛО/СТАЛО per card and writes nothing. The write
is guarded on the exact value we judged, so a score changed underneath us is
left alone.

  python docs/cards_pageviews_refix.py                 # dry-run, all
  python docs/cards_pageviews_refix.py --categories club --limit 20
  APPLY=1 python docs/cards_pageviews_refix.py
"""
import argparse
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import requests
from dotenv import load_dotenv

HERE = os.path.dirname(os.path.abspath(__file__))
SCRAPER = os.path.join(os.path.dirname(HERE), "football_scraper")
sys.path.insert(0, SCRAPER)

import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location("run", os.path.join(SCRAPER, "run.py"))
run = importlib.util.module_from_spec(_spec)
sys.modules["run"] = run
_spec.loader.exec_module(run)

from scraper.cache import FileCache  # noqa: E402
from scraper.pageviews import (  # noqa: E402
    PROJECT_RU, PageviewsClient, WikimediaBudget, WikiPagePropsClient,
    season_window,
)
from scraper.wikidata import WikidataEnricher  # noqa: E402

APPLY = os.environ.get("APPLY") == "1"

# Where the bare card name collides with a city, a planet or a person. Player
# cards are out of scope: their bare name IS the article title, and a player
# mononym is handled by the name_en audit instead.
TARGET_CATEGORIES = ("club", "club_nickname", "stadium", "derby", "trophy")
SELECT_COLS = "id,name,name_en,category,pageviews"


def fetch_cards(url, key, categories, names):
    base = {"select": SELECT_COLS, "active": "eq.true",
            "pageviews": "not.is.null",
            "order": "pageviews.desc.nullslast,id.asc"}
    if names:
        base["name"] = "in.({})".format(
            ",".join('"{}"'.format(n.replace('"', "")) for n in names))
    else:
        base["category"] = "in.({})".format(",".join(categories))
    rows, offset = [], 0
    while True:
        resp = requests.get(url.rstrip("/") + "/rest/v1/cards",
                            headers={"apikey": key,
                                     "Authorization": "Bearer " + key},
                            params=dict(base, limit=1000, offset=offset),
                            timeout=60)
        resp.raise_for_status()
        batch = resp.json()
        rows += batch
        if len(batch) < 1000:
            break
        offset += 1000
    return rows


def patch_pageviews(url, key, card, views):
    """Guarded on the stored value we judged — a score changed by a parallel
    run between our read and this write matches nothing and stays."""
    resp = requests.patch(
        url.rstrip("/") + "/rest/v1/cards",
        headers={"apikey": key, "Authorization": "Bearer " + key,
                 "Content-Type": "application/json", "Prefer": "return=minimal"},
        params={"id": "eq." + str(card["id"]),
                "pageviews": "eq." + str(card["pageviews"])},
        json={"pageviews": views}, timeout=30)
    resp.raise_for_status()


def main():
    parser = argparse.ArgumentParser(
        description="Пересчёт cards.pageviews там, где счёт снят с чужой "
                    "статьи (dry-run по умолчанию, APPLY=1 — запись).")
    parser.add_argument("--categories", default=",".join(TARGET_CATEGORIES),
                        help="категории через запятую")
    parser.add_argument("--limit", type=int, default=0,
                        help="обработать только N карточек (0 = все)")
    parser.add_argument("--names", default="",
                        help="конкретные карточки по имени, через запятую")
    args = parser.parse_args()

    load_dotenv(os.path.join(SCRAPER, ".env"))
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if not url or not key:
        raise SystemExit("Нужны SUPABASE_URL и SUPABASE_KEY (env или .env).")

    cfg = json.load(open(os.path.join(SCRAPER, "config.json"), encoding="utf-8"))
    pv = cfg["pageviews"]
    season = int(cfg.get("season", 2023))
    start, end = season_window(season, pv.get("window", {}))

    cache = FileCache(os.path.join(SCRAPER, cfg["cache"]["dir"]),
                      cfg["cache"]["enabled"])
    # Pageviews traffic goes on the pageviews budget, like every other mode
    # that reads this API; the title/QID resolution rides the photos one.
    pv_budget = WikimediaBudget(
        pv.get("daily_request_budget", 5000),
        os.path.join(SCRAPER, cfg["cache"]["dir"], "pageviews_budget.json"))
    wd_budget = WikimediaBudget(
        cfg.get("photos", {}).get("daily_request_budget", 5000),
        os.path.join(SCRAPER, cfg["cache"]["dir"], "photos_budget.json"))
    client = PageviewsClient(pv, cache, pv_budget)
    wikidata = WikidataEnricher(cfg["wikidata"], cache)
    resolver = WikiPagePropsClient(
        pv["user_agent"], cache, pv.get("min_pause_seconds", 1.0), wd_budget)

    categories = [c.strip() for c in args.categories.split(",") if c.strip()]
    names = [n.strip() for n in args.names.split(",") if n.strip()]
    cards = fetch_cards(url, key, categories, names)
    if args.limit > 0:
        cards = cards[:args.limit]

    print("=" * 72)
    print("PAGEVIEWS REFIX — {}".format(
        "LIVE, запись cards.pageviews" if APPLY else "DRY RUN, без записи"))
    print("=" * 72)
    print("Окно            : {} .. {} (сезон {})".format(
        start.isoformat(), end.isoformat(), season))
    print("Карточек в работе: {}".format(len(cards)))
    print("Правило         : если статья, найденная с гардом, не совпадает с "
          "голым названием — счёт снят с чужой страницы, пересчитываем")
    print("-" * 72, flush=True)

    changed = same = unresolved = 0
    written = 0
    for i, card in enumerate(cards, 1):
        name = (card.get("name") or "").strip()
        titles = run.cards_photos_candidates(card)
        if not titles:
            unresolved += 1
            continue
        validate = run.make_card_qid_validator(card, wikidata, cache, wd_budget)
        try:
            qid, title, _via = run.resolve_card_qid(
                resolver, card, titles, validate)
        except RuntimeError as exc:
            print("\n!!! {}".format(exc), flush=True)
            break
        if not qid or not title:
            unresolved += 1
            print("[{}/{}] ? {:<26} статья не найдена, счёт оставлен".format(
                i, len(cards), name), flush=True)
            continue
        if title == name:
            # Bare name IS the right article — the stored score is honest.
            same += 1
            continue

        try:
            result = client.views_for_window(PROJECT_RU, title, start, end)
        except RuntimeError as exc:
            print("\n!!! {}".format(exc))
            print("!!! Прогресс в кеше, продолжите завтра.", flush=True)
            break
        views = int(result.get("views") or 0)
        if not result.get("found") or views <= 0:
            unresolved += 1
            print("[{}/{}] ? {:<26} у «{}» нет данных, счёт оставлен".format(
                i, len(cards), name, title), flush=True)
            continue

        changed += 1
        old = card.get("pageviews")
        print("[{}/{}] ✓ {:<26} статья «{}»".format(i, len(cards), name, title))
        print("      БЫЛО : {} (со страницы «{}»)".format(old, name))
        print("      СТАЛО: {}".format(views))
        if APPLY:
            patch_pageviews(url, key, card, views)
            written += 1
        print(flush=True)

    print("-" * 72)
    print("ИТОГО: пересчитано {} | счёт был верный {} | не проверено {}{}".format(
        changed, same, unresolved,
        " | записано {}".format(written) if APPLY else ""))
    print("Бюджет pageviews : {}/{} | wikidata: {}/{}".format(
        pv_budget.used, pv_budget.limit, wd_budget.used, wd_budget.limit))
    if not APPLY:
        print("\nЗапись не выполнялась. Повторите с APPLY=1, чтобы применить.")


if __name__ == "__main__":
    main()
