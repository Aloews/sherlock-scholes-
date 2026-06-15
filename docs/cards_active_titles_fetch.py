"""Add P166 prestige titles to ACTIVE players (clubs_minutes set).

Unlike the cache-only reprocessor, this DOES spend the shared Wikidata budget:
active players' entities were never fetched, so one wbgetentities per player is
needed (no label calls — award QIDs are hard-coded). Shares photos_budget.json
and STOPS politely at the daily cap (RuntimeError), progress saved per PATCH.

Idempotent & resumable:
  * an active card that already has legend_career with titles is skipped (no
    fetch, no budget);
  * a card whose entity is already cached is read for free;
  * a fetched card with no qualifying title is left as-is (never nulled) — its
    entity is now cached, so a re-run re-checks it for free.

Storage: legend_career = {"clubs": [], "titles": [...]} — clubChips still uses
clubs_minutes for active players, and the frontend's golden line reads
legend_career.titles. Frontend untouched.

Run from football_scraper/:  python ../docs/cards_active_titles_fetch.py
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

ck = run.canonical_key


def fetch_all(url, key, table, select, extra=None, page_size=1000):
    endpoint = url.rstrip("/") + "/rest/v1/" + table
    headers = {"apikey": key, "Authorization": "Bearer " + key}
    rows, offset = [], 0
    while True:
        params = {"select": select, "order": "id.asc",
                  "limit": page_size, "offset": offset}
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
    cache = FileCache(os.path.join(SCRAPER, "cache"), True)
    budget = run.WikimediaBudget(
        cfg.get("photos", {}).get("daily_request_budget", 5000),
        os.path.join(SCRAPER, "cache", "photos_budget.json"))
    wikidata = run.WikidataEnricher(cfg["wikidata"], cache)

    meta = fetch_all(url, key, "players_meta", "name_ru,name_en,wikidata_qid")
    qid_by_key = {}
    for m in meta:
        qid = (m.get("wikidata_qid") or "").strip()
        if not qid:
            continue
        for k in (ck(m.get("name_ru")), ck(m.get("name_en"))):
            if k:
                qid_by_key.setdefault(k, qid)

    cards = fetch_all(url, key, "cards", "id,name,name_en,clubs_minutes,legend_career",
                      {"category": "eq.player", "clubs_minutes": "not.is.null"})

    def resolve_qid(card):
        q = qid_by_key.get(ck(card.get("name"))) or qid_by_key.get(ck(card.get("name_en")))
        if q:
            return q
        for title in run.cards_photos_candidates(card):
            info = cache.get("ruwiki_pageprops", title)
            if info and info.get("qid") and not info.get("disambig"):
                return info["qid"]
        return None

    total = len(cards)
    titled = skipped_done = no_qid = no_title = fetched = from_cache = 0
    print("ACTIVE TITLES fetch — {} active players, budget {}/{} ({} UTC)".format(
        total, budget.used, budget.limit, budget.date), flush=True)

    for idx, card in enumerate(cards, 1):
        lc = card.get("legend_career") or {}
        if lc.get("titles"):
            skipped_done += 1
            continue
        qid = resolve_qid(card)
        if not qid:
            no_qid += 1
            continue
        cached = cache.get("wikidata_entity", "ru,en|" + qid)
        if cached is None:
            try:
                budget.consume()
            except RuntimeError:
                print("BUDGET EXHAUSTED at {}/{} — stopping, progress saved.".format(
                    idx, total), flush=True)
                break
            ent = wikidata.entity_claims_labels(qid)
            fetched += 1
        else:
            ent = cached
            from_cache += 1
        titles = run.legend_titles_from_claims(ent.get("claims", {}))
        if not titles:
            no_title += 1
            continue
        body = {"legend_career": {"clubs": [], "titles": titles}}
        r = requests.patch(url.rstrip("/") + "/rest/v1/cards", headers=patch_h,
                           params={"id": "eq." + str(card["id"])}, json=body, timeout=30)
        r.raise_for_status()
        titled += 1
        print("  + {} -> {}".format(card["name"], ", ".join(titles)), flush=True)
        if idx % 200 == 0:
            print("[{}/{}] titled {}, budget {}/{}".format(
                idx, total, titled, budget.used, budget.limit), flush=True)

    print("=" * 56)
    print("ACTIVE TITLES SUMMARY")
    print("  active players      : {}".format(total))
    print("  titles ADDED        : {}".format(titled))
    print("  already had titles  : {}".format(skipped_done))
    print("  fetched (network)   : {}".format(fetched))
    print("  read from cache     : {}".format(from_cache))
    print("  no qualifying title : {}".format(no_title))
    print("  no QID              : {}".format(no_qid))
    print("  budget used         : {}/{} ({} UTC)".format(
        budget.used, budget.limit, budget.date))
    print("=" * 56)


if __name__ == "__main__":
    main()
