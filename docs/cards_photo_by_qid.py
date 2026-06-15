"""Photo backfill for player cards via their players_meta Wikidata QID.

The --cards-photos pipeline resolves QIDs from ru/enwiki TITLES, which fail on
these cards because name_en is a corrupted phonetic transliteration. This
bypasses names entirely: it takes the correct QID from players_meta and fetches
a free Commons photo directly.

Ladder per player (PEOPLE — free Commons only, no fair-use):
  QID -> Wikidata P18 -> Commons Special:FilePath
      -> else QID sitelinks (enwiki preferred, then ruwiki) -> that wiki's
         pageimage (infobox thumbnail, Commons-hosted portrait).

Shares photos_budget.json, stops politely at the daily cap, idempotent
(PATCH guarded by photo_url IS NULL). Players only — clubs are skipped here
(their logos are usually fair-use; handled separately).

Run from football_scraper/:  python ../docs/cards_photo_by_qid.py
"""
import os
import sys
import json

import requests
from dotenv import load_dotenv

HERE = os.path.dirname(__file__)
SCRAPER = os.path.join(HERE, "..", "football_scraper")
sys.path.insert(0, SCRAPER)
import importlib.util  # noqa: E402
spec = importlib.util.spec_from_file_location("run", os.path.join(SCRAPER, "run.py"))
run = importlib.util.module_from_spec(spec)
sys.modules["run"] = run
spec.loader.exec_module(run)
from scraper.cache import FileCache  # noqa: E402
from scraper.wikidata import WikidataEnricher, commons_filepath_url  # noqa: E402
from scraper.pageviews import WikiPagePropsClient  # noqa: E402

ck = run.canonical_key


def fetch_all(url, key, table, select, extra=None, page_size=1000):
    endpoint = url.rstrip("/") + "/rest/v1/" + table
    headers = {"apikey": key, "Authorization": "Bearer " + key}
    rows, offset = [], 0
    while True:
        params = {"select": select, "order": "id.asc", "limit": page_size, "offset": offset}
        params.update(extra or {})
        r = requests.get(endpoint, headers=headers, params=params, timeout=30)
        r.raise_for_status()
        b = r.json()
        rows += b
        if len(b) < page_size:
            break
        offset += page_size
    return rows


def main():
    load_dotenv(os.path.join(SCRAPER, ".env"))
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY not set (.env)")
    patch_h = {"apikey": key, "Authorization": "Bearer " + key,
               "Content-Type": "application/json", "Prefer": "return=minimal"}

    cfg = json.load(open(os.path.join(SCRAPER, "config.json"), encoding="utf-8"))
    pv = cfg["pageviews"]
    photos_cfg = cfg.get("photos", {})
    width = int(photos_cfg.get("width", 256))
    base = photos_cfg.get("filepath_base",
                          "https://commons.wikimedia.org/wiki/Special:FilePath")
    cache = FileCache(os.path.join(SCRAPER, "cache"), True)
    budget = run.WikimediaBudget(
        photos_cfg.get("daily_request_budget", 5000),
        os.path.join(SCRAPER, "cache", "photos_budget.json"))
    wikidata = WikidataEnricher(cfg["wikidata"], cache)
    resolver = WikiPagePropsClient(pv["user_agent"], cache,
                                   pv.get("min_pause_seconds", 1.0), budget)
    en_resolver = WikiPagePropsClient(
        pv["user_agent"], cache, pv.get("min_pause_seconds", 1.0), budget,
        api_url="https://en.wikipedia.org/w/api.php", cache_prefix="enwiki")

    meta = fetch_all(url, key, "players_meta", "name_ru,name_en,wikidata_qid")
    qmap = {}
    for m in meta:
        q = (m.get("wikidata_qid") or "").strip()
        if not q:
            continue
        for k in (ck(m.get("name_ru")), ck(m.get("name_en"))):
            if k:
                qmap.setdefault(k, q)

    cards = fetch_all(url, key, "cards", "id,name,name_en",
                      {"category": "eq.player", "photo_url": "is.null"})
    targets = [(c, qmap.get(ck(c.get("name"))) or qmap.get(ck(c.get("name_en"))))
               for c in cards]
    targets = [(c, q) for c, q in targets if q]

    print("PHOTO-BY-QID — {} player cards with a meta QID, budget {}/{} ({} UTC)".format(
        len(targets), budget.used, budget.limit, budget.date), flush=True)

    written = via_p18 = via_pageimage = via_enwiki = no_image = errors = 0
    for idx, (card, qid) in enumerate(targets, 1):
        label = card.get("name")
        try:
            url_photo = None
            via = None
            # 1) Wikidata P18 (Commons, always free).
            if cache.get("wikidata_p18", qid) is None:
                budget.consume()
            filename = wikidata.media_filename_for_qid(qid, "P18")
            if filename:
                url_photo = commons_filepath_url(filename, width, base)
                via = "P18"
            else:
                # 2) sitelink article -> pageimage (people portrait, Commons).
                if cache.get("wikidata_sitelinks", qid) is None:
                    budget.consume()
                links = wikidata.titles_for_qid(qid)
                if links.get("enwiki"):
                    url_photo = en_resolver.pageimage_for_title(links["enwiki"], width)
                    if url_photo:
                        via = "pageimage-en"
                if not url_photo and links.get("ruwiki"):
                    url_photo = resolver.pageimage_for_title(links["ruwiki"], width)
                    if url_photo:
                        via = "pageimage-ru"
            if not url_photo:
                no_image += 1
                continue
            r = requests.patch(url.rstrip("/") + "/rest/v1/cards", headers=patch_h,
                               params={"id": "eq." + str(card["id"]),
                                       "photo_url": "is.null"},
                               json={"photo_url": url_photo}, timeout=30)
            r.raise_for_status()
            written += 1
            if via == "P18":
                via_p18 += 1
            else:
                via_pageimage += 1
            if via == "pageimage-en":
                via_enwiki += 1
            print("  + {} ({}) [{}]".format(label, qid, via), flush=True)
        except RuntimeError:
            print("BUDGET EXHAUSTED at {}/{} — stopping, progress saved.".format(
                idx, len(targets)), flush=True)
            break
        except Exception as exc:  # noqa: BLE001
            errors += 1
            print("  ! {} — error: {}".format(label, exc), flush=True)
            continue

    print("=" * 56)
    print("PHOTO-BY-QID SUMMARY")
    print("  candidates (player + meta QID): {}".format(len(targets)))
    print("  photos WRITTEN              : {}".format(written))
    print("    via Wikidata P18         : {}".format(via_p18))
    print("    via pageimage (portrait) : {} (enwiki {})".format(via_pageimage, via_enwiki))
    print("  no image found             : {}".format(no_image))
    print("  errors                     : {}".format(errors))
    print("  budget used                : {}/{} ({} UTC)".format(
        budget.used, budget.limit, budget.date))
    print("=" * 56)


if __name__ == "__main__":
    main()
