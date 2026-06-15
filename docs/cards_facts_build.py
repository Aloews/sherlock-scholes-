"""Build cards.facts (JSONB) + cards.tags (TEXT[]) from Wikidata, by QID.

Source: players_meta.wikidata_qid (+ cached ruwiki_pageprops fallback) -> the
cached wikidata_entity (full claims). One batched labels pass classifies P54
(club vs national team) and P1344 (World Cup / Euro). Budget = shared
photos_budget.json, stops at the cap, resumable (labels cached).

DRY-RUN by default: computes everything and prints fill % + category counts,
writes NOTHING. Set APPLY=1 to PATCH cards.facts/tags (needs the ALTER:
facts JSONB, tags TEXT[]). Idempotent — PATCH only when the value changed.

Facts per card (keys present only when known):
  position, height_cm, birth_year, clubs_count, years_active,
  national_team, national_caps, tournaments[], titles[]
Tags: goalkeeper, world_cup, ballon_dor, veteran (>15y), wanderer (>8 clubs)

Run from football_scraper/:  python ../docs/cards_facts_build.py
"""
import os, sys, re, json, datetime
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
THIS_YEAR = datetime.date.today().year
GK_QID = "Q172964"

WC_RE   = re.compile(r"FIFA World Cup|чемпионат мира по футболу", re.I)
EURO_RE = re.compile(r"UEFA Euro|European Football Championship|"
                     r"European Championship|чемпионат Европы по футболу", re.I)
# exclude club/youth/women editions from "played at WC/Euro"
NOT_SENIOR_RE = re.compile(r"club|клубн|women|женск|under|U-?\d|юнош|молод|"
                           r"олимп|olympic|beach|futsal|qualif|отбор", re.I)
NAT_RE   = re.compile(r"national.*team|сборн", re.I)
YOUTH_RE = re.compile(r"under|U-?\d|олимп|olympic|молод|youth|B national|"
                      r"women|женск", re.I)
YEAR_RE  = re.compile(r"(\d{4})")


def fetch_all(url, key, table, sel, extra=None):
    out, off = [], 0
    while True:
        p = {"select": sel, "limit": 1000, "offset": off}; p.update(extra or {})
        r = requests.get(url.rstrip("/") + f"/rest/v1/{table}", headers={"apikey": key,
            "Authorization": "Bearer " + key}, params=p, timeout=30)
        r.raise_for_status(); b = r.json(); out += b
        if len(b) < 1000: break
        off += 1000
    return out


def ids_quals(claims, prop):
    """[(qid, qualifiers_dict)] for an item-valued property."""
    out = []
    for st in (claims or {}).get(prop, []):
        try:
            out.append((st["mainsnak"]["datavalue"]["value"]["id"], st.get("qualifiers", {}) or {}))
        except (KeyError, TypeError):
            pass
    return out


def main():
    load_dotenv(os.path.join(SCRAPER, ".env"))
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    patch_h = {"apikey": key, "Authorization": "Bearer " + key,
               "Content-Type": "application/json", "Prefer": "return=minimal"}
    cfg = json.load(open(os.path.join(SCRAPER, "config.json"), encoding="utf-8"))
    cache = FileCache(os.path.join(SCRAPER, "cache"), True)
    budget = run.WikimediaBudget(cfg.get("photos", {}).get("daily_request_budget", 5000),
                                 os.path.join(SCRAPER, "cache", "photos_budget.json"))
    wd = WikidataEnricher(cfg["wikidata"], cache)

    meta = fetch_all(url, key, "players_meta", "name_ru,name_en,wikidata_qid")
    qmap = {}
    for m in meta:
        q = (m.get("wikidata_qid") or "").strip()
        if not q: continue
        for k in (ck(m.get("name_ru")), ck(m.get("name_en"))):
            if k: qmap.setdefault(k, q)
    # facts/tags exist only after the ALTER; in dry-run we don't need them.
    sel = "id,name,name_en,position_ru" + (",facts,tags" if APPLY else "")
    cards = fetch_all(url, key, "cards", sel, {"category": "eq.player"})

    def resolve_qid(c):
        q = qmap.get(ck(c.get("name"))) or qmap.get(ck(c.get("name_en")))
        if q: return q
        for t in (c.get("name"), f"{c.get('name')} (футболист)"):
            info = cache.get("ruwiki_pageprops", t) if t else None
            if info and info.get("qid") and not info.get("disambig"): return info["qid"]
        return None

    # pass 1: gather entities + the QIDs whose labels we need (P54, P1344)
    rows = []        # (card, claims)
    need = set()
    for c in cards:
        q = resolve_qid(c)
        if not q: continue
        ent = cache.get("wikidata_entity", "ru,en|" + q)
        if not ent: continue
        cl = ent.get("claims", {}) or {}
        rows.append((c, cl))
        for qid, _ in ids_quals(cl, "P54") + ids_quals(cl, "P1344"):
            need.add(qid)
    # batched labels (budget per uncached batch of 50)
    uncached = [q for q in need if cache.get("wikidata_labels", q) is None]
    print(f"players with cached entity: {len(rows)} | label QIDs needed: {len(need)} "
          f"(uncached {len(uncached)}) | budget {budget.used}/{budget.limit}")
    for i in range(0, len(uncached), 50):
        try: budget.consume()
        except RuntimeError:
            print(f"BUDGET cap during labels at {i}/{len(uncached)} — partial, resumable."); break
        wd.labels_for_qids(uncached[i:i+50])
    def lab(qid):
        rec = cache.get("wikidata_labels", qid) or {}
        return rec.get("ru") or rec.get("en") or ""

    def year(quals, prop):
        return run._wd_year(quals, prop)
    def qty(quals, prop):
        try: return int(float(quals[prop][0]["datavalue"]["value"]["amount"]))
        except (KeyError, IndexError, TypeError, ValueError): return None

    fill = {k: 0 for k in ("position","height_cm","birth_year","clubs_count",
                           "years_active","national_team","national_caps",
                           "tournaments","titles")}
    tagc = {k: 0 for k in ("goalkeeper","world_cup","ballon_dor","veteran","wanderer")}
    samples = {}
    changed = 0
    for c, cl in rows:
        f = {}
        # position
        pos = c.get("position_ru")
        if pos: f["position"] = pos
        # height (P2048, cm; metres -> *100)
        for st in cl.get("P2048", []):
            try:
                a = float(st["mainsnak"]["datavalue"]["value"]["amount"])
                f["height_cm"] = int(a*100 if a < 3 else a); break
            except (KeyError, TypeError, ValueError): pass
        # birth year
        for st in cl.get("P569", []):
            try: f["birth_year"] = int(st["mainsnak"]["datavalue"]["value"]["time"][1:5]); break
            except (KeyError, TypeError, ValueError): pass
        # clubs vs national from P54
        club_spans = []; nat = {}
        for qid, q in ids_quals(cl, "P54"):
            name = lab(qid)
            s, e = year(q, "P580"), year(q, "P582")
            if name and NAT_RE.search(name):
                if YOUTH_RE.search(name): continue
                caps = qty(q, "P1350") or 0
                cur = nat.get(name, 0); nat[name] = max(cur, caps) if caps else cur
            else:
                club_spans.append((int(s) if s else None, int(e) if e else None))
        clubs_count = len(set(q for q, _ in ids_quals(cl, "P54")
                              if not (lab(q) and NAT_RE.search(lab(q)))))
        if clubs_count: f["clubs_count"] = clubs_count
        starts = [s for s, e in club_spans if s]; ends = [e for s, e in club_spans if e]
        if starts:
            lo = min(starts); hi = max(ends) if ends else THIS_YEAR
            f["years_active"] = f"{lo}–{hi if hi != THIS_YEAR else ''}".rstrip("–") or str(lo)
            span = (hi - lo)
        else:
            span = 0
        if nat:
            team = max(nat, key=lambda k: nat[k]); f["national_team"] = team
            if nat[team]: f["national_caps"] = nat[team]
        # tournaments WC/Euro from P1344
        tours = []
        for qid, _ in ids_quals(cl, "P1344"):
            nm = lab(qid)
            if not nm or NOT_SENIOR_RE.search(nm): continue
            y = (YEAR_RE.search(nm) or [None,None])[1] if YEAR_RE.search(nm) else None
            if WC_RE.search(nm): tours.append(f"ЧМ-{y}" if y else "ЧМ")
            elif EURO_RE.search(nm): tours.append(f"Евро-{y}" if y else "Евро")
        tours = sorted(set(tours))
        if tours: f["tournaments"] = tours
        # titles (reuse hardcoded P166 prestige)
        titles = run.legend_titles_from_claims(cl)
        if titles: f["titles"] = titles
        # tally fill
        for k in fill:
            if f.get(k): fill[k] += 1
        # tags
        tags = []
        if (f.get("position") == "Вратарь") or (GK_QID in [q for q,_ in ids_quals(cl,"P413")]):
            tags.append("goalkeeper")
        if tours: tags.append("world_cup")
        if titles and any("Золотой мяч" in t for t in titles): tags.append("ballon_dor")
        if span and span > 15: tags.append("veteran")
        if clubs_count and clubs_count > 8: tags.append("wanderer")
        for t in tags: tagc[t] += 1
        # samples
        nm = c["name"]
        if nm in ("Лионель Месси","Икер Касильяс","Криштиану Роналду","Андреа Пирло","Гарет Бэйл"):
            samples[nm] = (f, tags)
        # apply
        if APPLY:
            body = {}
            if f != (c.get("facts") or {}): body["facts"] = f
            if sorted(tags) != sorted(c.get("tags") or []): body["tags"] = tags
            if body:
                requests.patch(url.rstrip("/")+"/rest/v1/cards", headers=patch_h,
                    params={"id": "eq."+str(c["id"])}, json=body, timeout=30).raise_for_status()
                changed += 1

    n = len(rows)
    print("\n=== FACTS FILL (of {} players with entity) ===".format(n))
    for k in fill: print(f"  {k:14}: {fill[k]} ({100*fill[k]//max(n,1)}%)")
    print("\n=== CATEGORY (tag) DRY-RUN COUNTS ===")
    labels = {"goalkeeper":"вратари","world_cup":"играли на ЧМ/Евро",
              "ballon_dor":"Золотой мяч","veteran":"ветераны (>15 лет)",
              "wanderer":"вечные странники (>8 клубов)"}
    for k in tagc: print(f"  {labels[k]:30}: {tagc[k]}")
    print("\n=== SAMPLE facts ===")
    for nm,(f,tags) in samples.items():
        print(f"  {nm}: {json.dumps(f, ensure_ascii=False)}  tags={tags}")
    print(f"\nbudget now: {budget.used}/{budget.limit}" + (f" | PATCHed {changed}" if APPLY else " | DRY-RUN (no writes)"))


if __name__ == "__main__":
    main()
