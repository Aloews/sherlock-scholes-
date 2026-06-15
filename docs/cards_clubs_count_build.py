"""Fill facts.clubs_count from Wikidata P54 (member of sports team) by QID.

Counts CAREER CLUBS only — national teams and youth/U-NN/women/Olympic squads
are excluded from the count (same rule used for the legend careers). Merges
clubs_count INTO the existing facts JSONB (other facts untouched). Idempotent:
only cards whose facts.clubs_count is missing AND that have a QID are touched;
PATCH guarded so a re-run is a no-op.

Budget: shared photos_budget.json (1 P54 call + 1 labels call per uncached
player). DRY-RUN by default; APPLY=1 to PATCH.

Run from football_scraper/:  python ../docs/cards_clubs_count_build.py
                             APPLY=1 python ../docs/cards_clubs_count_build.py
"""
import os, sys, re, json
import requests
from dotenv import load_dotenv

HERE = os.path.dirname(__file__)
SCRAPER = os.path.join(HERE, "..", "football_scraper")
sys.path.insert(0, SCRAPER)
import importlib.util  # noqa: E402
spec = importlib.util.spec_from_file_location("run", os.path.join(SCRAPER, "run.py"))
run = importlib.util.module_from_spec(spec); sys.modules["run"] = run; spec.loader.exec_module(run)
from scraper.cache import FileCache  # noqa: E402
from scraper.wikidata import WikidataEnricher  # noqa: E402

ck = run.canonical_key
APPLY = os.environ.get("APPLY") == "1"

# National teams and youth/non-club squads — excluded from the CLUB count.
NAT_RE = re.compile(r"national.*team|сборн", re.I)
YOUTH_RE = re.compile(r"under|U-?\d|олимп|olympic|молод|youth|B national|women|женск", re.I)


def fetch_all(url, key, table, select, extra=None):
    rows, off = [], 0
    while True:
        p = {"select": select, "order": "id.asc", "limit": 1000, "offset": off}
        p.update(extra or {})
        r = requests.get(url.rstrip("/") + "/rest/v1/" + table,
                         headers={"apikey": key, "Authorization": "Bearer " + key},
                         params=p, timeout=60)
        r.raise_for_status(); b = r.json(); rows += b
        if len(b) < 1000:
            break
        off += 1000
    return rows


def main():
    load_dotenv(os.path.join(SCRAPER, ".env"))
    url, key = os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"]
    patch_h = {"apikey": key, "Authorization": "Bearer " + key,
               "Content-Type": "application/json", "Prefer": "return=minimal"}
    cfg = json.load(open(os.path.join(SCRAPER, "config.json"), encoding="utf-8"))
    cache = FileCache(os.path.join(SCRAPER, "cache"), True)
    budget = run.WikimediaBudget(
        cfg.get("photos", {}).get("daily_request_budget", 5000),
        os.path.join(SCRAPER, "cache", "photos_budget.json"))
    wd = WikidataEnricher(cfg["wikidata"], cache)

    cards = fetch_all(url, key, "cards", "id,name,name_en,facts",
                      {"category": "eq.player"})
    meta = fetch_all(url, key, "players_meta", "name_ru,name_en,wikidata_qid")
    qmap = {}
    for m in meta:
        q = (m.get("wikidata_qid") or "").strip()
        if not q:
            continue
        for k in (ck(m.get("name_ru")), ck(m.get("name_en"))):
            if k:
                qmap.setdefault(k, q)

    def qid_for(c):
        return qmap.get(ck(c.get("name"))) or qmap.get(ck(c.get("name_en")))

    def labels(qids):
        if not qids:
            return {}
        if cache.get("wikidata_labels", qids[0]) is None:
            budget.consume()
        return wd.labels_for_qids(qids)

    empty = [c for c in cards if not (c.get("facts") or {}).get("clubs_count")]
    with_qid = [c for c in empty if qid_for(c)]
    print("clubs_count empty: %d  | with QID: %d  | APPLY=%s"
          % (len(empty), len(with_qid), APPLY), flush=True)

    filled = patched = no_clubs = 0
    dist = {}
    examples = []
    for idx, c in enumerate(with_qid, 1):
        q = qid_for(c)
        try:
            if cache.get("wikidata_p54", q) is None:
                budget.consume()
            teams = wd.claim_item_ids(q, "P54")
        except RuntimeError:
            print("BUDGET EXHAUSTED at %d/%d — stopping." % (idx, len(with_qid)), flush=True)
            break
        if not teams:
            no_clubs += 1
            continue
        lab = labels(list(dict.fromkeys(teams)))
        clubs = set()
        for tq in teams:
            nm = (lab.get(tq) or {})
            name = (nm.get("ru") or nm.get("en") or "")
            if name and (NAT_RE.search(name) or YOUTH_RE.search(name)):
                continue  # national / youth -> not a club
            clubs.add(tq)
        n = len(clubs)
        if n == 0:
            no_clubs += 1
            continue
        filled += 1
        dist[n] = dist.get(n, 0) + 1
        if len(examples) < 12:
            examples.append((c.get("name"), n))
        if APPLY:
            new_facts = dict(c.get("facts") or {})
            new_facts["clubs_count"] = n
            rr = requests.patch(url.rstrip("/") + "/rest/v1/cards", headers=patch_h,
                                params={"id": "eq." + str(c["id"])},
                                json={"facts": new_facts}, timeout=30)
            rr.raise_for_status()
            patched += 1
        if idx % 100 == 0:
            print("  ...%d/%d filled=%d (budget %d/%d)"
                  % (idx, len(with_qid), filled, budget.used, budget.limit), flush=True)

    print("=" * 56)
    print("CLUBS_COUNT %s" % ("APPLY" if APPLY else "DRY-RUN"))
    print("  empty clubs_count    : %d" % len(empty))
    print("  with QID (reachable) : %d" % len(with_qid))
    print("  WOULD fill           : %d" % filled)
    print("  P54 empty / 0 clubs  : %d" % no_clubs)
    print("  no QID (ceiling)     : %d" % (len(empty) - len(with_qid)))
    if APPLY:
        print("  PATCHed              : %d" % patched)
    print("  budget used          : %d/%d" % (budget.used, budget.limit))
    print("  count distribution   : %s" % dict(sorted(dist.items())))
    print("  examples             : %s" % examples)
    print("=" * 56)


if __name__ == "__main__":
    main()
