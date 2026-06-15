"""Cache-only, PATCH-in-place reprocessor for cards.legend_career + titles.

Spends ZERO Wikidata budget — it only READS the on-disk caches that earlier
--cards-legend-career runs already populated (wikidata_entity, wikidata_labels,
ruwiki_pageprops) and PATCHes corrected rows. Existing rows are never nulled.

Fixes applied (logic lives in run.py, imported here):
  1. Position bug — Полузащитник checked before Защитник (legend_career AND,
     where it differs, cards.position_ru).
  2. National/youth filter — drops "X national football team", "under-NN", etc.
  3. Legends: at most LEGEND_MAX_CLUBS clubs, sorted by tenure DURATION
     (longest first); short episodes/loans fall off.
  4. Titles (P166) for ALL players — legends keep clubs+years+titles; ACTIVE
     players (clubs_minutes set) get a titles-only legend_career
     {"clubs": [], "titles": [...]} so the frontend's golden line lights up
     under their minutes chips. Active players whose Wikidata entity is not in
     the cache are reported (a budgeted top-up can fetch them).

Run from football_scraper/:  python ../docs/cards_legend_career_reprocess.py
"""
import os
import sys

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

    cache = FileCache(os.path.join(SCRAPER, "cache"), True)

    meta = fetch_all(url, key, "players_meta", "name_ru,name_en,wikidata_qid")
    qid_by_key = {}
    for m in meta:
        qid = (m.get("wikidata_qid") or "").strip()
        if not qid:
            continue
        for k in (ck(m.get("name_ru")), ck(m.get("name_en"))):
            if k:
                qid_by_key.setdefault(k, qid)

    cards = fetch_all(url, key, "cards",
                      "id,name,name_en,clubs_minutes,legend_career,position_ru",
                      {"category": "eq.player"})

    def resolve_qid(card):
        q = qid_by_key.get(ck(card.get("name"))) or qid_by_key.get(ck(card.get("name_en")))
        if q:
            return q
        for title in run.cards_photos_candidates(card):
            info = cache.get("ruwiki_pageprops", title)
            if info and info.get("qid") and not info.get("disambig"):
                return info["qid"]
        return None

    def cached_entity(qid):
        return cache.get("wikidata_entity", "ru,en|" + qid)

    def patch(card_id, body):
        r = requests.patch(url.rstrip("/") + "/rest/v1/cards",
                           headers=patch_h, params={"id": "eq." + str(card_id)},
                           json=body, timeout=30)
        r.raise_for_status()

    # counters
    leg_total = leg_changed = leg_same = leg_no_qid = leg_no_cache = leg_empty = 0
    pos_fixed = 0
    act_total = act_titled = act_same = act_no_title = act_no_cache = act_no_qid = 0
    act_potential = 0  # active w/ QID but entity not cached (budgeted top-up)

    for card in cards:
        is_legend = not card.get("clubs_minutes")
        qid = resolve_qid(card)
        if is_legend:
            leg_total += 1
            if not qid:
                leg_no_qid += 1
                continue
            ent = cached_entity(qid)
            if ent is None:
                leg_no_cache += 1
                continue
            refs = run._referenced_qids(ent)
            label_map = {}
            for q in dict.fromkeys(refs):
                lab = cache.get("wikidata_labels", q)
                if lab is not None:
                    label_map[q] = lab
            career = run._legend_career_from_entity(ent, label_map)
            if not career:
                leg_empty += 1        # all-national / no titles — leave as-is, never null
                continue
            body = {}
            if career != card.get("legend_career"):
                body["legend_career"] = career
            new_pos = career.get("position")
            if new_pos and new_pos != card.get("position_ru"):
                body["position_ru"] = new_pos
            if body:
                patch(card["id"], body)
                leg_changed += 1
                if "position_ru" in body:
                    pos_fixed += 1
            else:
                leg_same += 1
        else:
            act_total += 1
            if not qid:
                act_no_qid += 1
                continue
            ent = cached_entity(qid)
            if ent is None:
                act_no_cache += 1
                act_potential += 1
                continue
            titles = run.legend_titles_from_claims(ent.get("claims", {}))
            if not titles:
                act_no_title += 1
                continue
            new = {"clubs": [], "titles": titles}
            if new != card.get("legend_career"):
                patch(card["id"], new)
                act_titled += 1
            else:
                act_same += 1

    print("=" * 60)
    print("LEGEND_CAREER REPROCESS (cache-only, 0 budget)")
    print("=" * 60)
    print("LEGENDS (clubs_minutes IS NULL):")
    print("  total            : {}".format(leg_total))
    print("  PATCHed (fixed)  : {}".format(leg_changed))
    print("    incl. position_ru fixed : {}".format(pos_fixed))
    print("  already correct  : {}".format(leg_same))
    print("  no QID           : {}".format(leg_no_qid))
    print("  entity not cached: {}".format(leg_no_cache))
    print("  empty/kept       : {}".format(leg_empty))
    print("-" * 60)
    print("ACTIVE players (clubs_minutes set) — titles (P166):")
    print("  total            : {}".format(act_total))
    print("  titles ADDED     : {}".format(act_titled))
    print("  already had same : {}".format(act_same))
    print("  no qualifying title: {}".format(act_no_title))
    print("  no QID           : {}".format(act_no_qid))
    print("  entity NOT cached (budgeted top-up could fetch): {}".format(act_potential))
    print("=" * 60)


if __name__ == "__main__":
    main()
