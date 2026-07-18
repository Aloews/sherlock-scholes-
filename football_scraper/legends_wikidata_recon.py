"""READ-ONLY recon: what Wikidata really holds for our LEGEND player cards
(category='player' absent from the API-Football cache). No writes, no
collection — just a fill-rate report on a sample, to decide which 2-3 fields
are worth showing on legend cards. Wikidata/Wikipedia only.

Fields probed per QID (from the cached resolver QIDs):
  P54  member of sports team  -> club + P580/P582 (years), P1350 matches,
       P1351 goals qualifiers; national teams flagged by label.
  P413 position on team
  P166 award received (Ballon d'Or = Q166177 highlighted)
  P2031/P2032 work period (start/end)

Run:  python legends_wikidata_recon.py
"""
import io
import os
import sys
import time
import collections

import requests
from dotenv import load_dotenv

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, BASE)
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

from run import cards_photos_candidates  # noqa: E402
from scraper.cache import FileCache  # noqa: E402

load_dotenv(os.path.join(BASE, ".env"))
URL, KEY = os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"]
HDR = {"apikey": KEY, "Authorization": "Bearer " + KEY}
UA = "SherlockScholesBot/1.0 (recon; giafreec@gmail.com)"
WD = "https://www.wikidata.org/w/api.php"
BALLON_DOR = "Q166177"
SAMPLE = 40

# Famous legends to seed the sample (resolved by name where present).
SEED = [
    "Марадона", "Зидан", "Роналдиньо", "Рауль", "Пеле", "Кройф", "Платини",
    "Марко ван Бастен", "Паоло Мальдини", "Роберто Баджо", "Габриэл Батистута",
    "Яшин", "Лев Яшин", "Олег Блохин", "Ринат Дасаев", "Игорь Беланов",
    "Андрей Шевченко", "Георгий Кинкладзе", "Валерий Лобановский",
    "Эйсебио", "Бобби Чарльтон", "Франц Беккенбауэр", "Герд Мюллер",
    "Мишель Платини", "Лотар Маттеус", "Роналдо", "Ромарио", "Кака",
    "Тьерри Анри", "Алессандро Дель Пьеро", "Франческо Тотти",
    "Андрей Аршавин", "Роман Павлюченко", "Игорь Акинфеев",
]


def fetch_all(table, select, extra=None):
    rows, off = [], 0
    while True:
        p = {"select": select, "order": "id.asc", "limit": 1000, "offset": off}
        p.update(extra or {})
        r = requests.get(URL + "/rest/v1/" + table, headers=HDR, params=p, timeout=30)
        r.raise_for_status()
        b = r.json()
        rows += b
        if len(b) < 1000:
            break
        off += 1000
    return rows


def wd_get(qids, props):
    out = {}
    for i in range(0, len(qids), 40):
        chunk = qids[i:i + 40]
        for attempt in range(3):
            try:
                r = requests.get(WD, params={
                    "action": "wbgetentities", "ids": "|".join(chunk),
                    "props": props, "languages": "en|ru", "format": "json"},
                    headers={"User-Agent": UA}, timeout=30)
                r.raise_for_status()
                out.update(r.json().get("entities", {}))
                break
            except requests.RequestException:
                time.sleep(2 * (attempt + 1))
        time.sleep(0.3)
    return out


def label(ent):
    labs = ent.get("labels", {})
    return (labs.get("ru", {}) or labs.get("en", {}) or {}).get("value") or ent.get("id")


def claim_items(ent, prop):
    out = []
    for c in ent.get("claims", {}).get(prop, []):
        try:
            out.append((c["mainsnak"]["datavalue"]["value"]["id"], c.get("qualifiers", {})))
        except (KeyError, TypeError):
            out.append((None, c.get("qualifiers", {})))
    return out


def qual_year(quals, prop):
    try:
        t = quals[prop][0]["datavalue"]["value"]["time"]  # +1998-00-00T..
        return t[1:5]
    except (KeyError, IndexError, TypeError):
        return None


def qual_amount(quals, prop):
    try:
        return quals[prop][0]["datavalue"]["value"]["amount"].lstrip("+")
    except (KeyError, IndexError, TypeError):
        return None


def main():
    from scraper.dedup import canonical_key
    cache = FileCache(os.path.join(BASE, "cache"), True)
    # Legends = player cards WITHOUT clubs_minutes (not in API-Football).
    cards = fetch_all("cards", "id,name,name_en,category",
                      {"category": "eq.player", "clubs_minutes": "is.null"})
    meta = fetch_all("players_meta", "name_ru,name_en,wikidata_qid")

    # Card name -> players_meta wikidata_qid (the free QID source).
    qid_by_key = {}
    for m in meta:
        qid = (m.get("wikidata_qid") or "").strip()
        if not qid:
            continue
        for k in (canonical_key(m.get("name_ru")), canonical_key(m.get("name_en"))):
            if k:
                qid_by_key.setdefault(k, qid)

    # legend cards -> QID: players_meta first, then the cached ruwiki resolver.
    legend_qid = {}
    for c in cards:
        qid = qid_by_key.get(canonical_key(c.get("name"))) \
            or qid_by_key.get(canonical_key(c.get("name_en")))
        if not qid:
            for title in cards_photos_candidates(c):
                info = cache.get("ruwiki_pageprops", title)
                if info and info.get("qid") and not info.get("disambig"):
                    qid = info["qid"]
                    break
        if qid:
            legend_qid[c["name"]] = qid

    # build sample: seeds first (if present), then fill to SAMPLE
    chosen = {}
    for name in SEED:
        if name in legend_qid:
            chosen[name] = legend_qid[name]
    for name, qid in legend_qid.items():
        if len(chosen) >= SAMPLE:
            break
        chosen.setdefault(name, qid)
    print("Легенд с QID в кеше: {} (выборка {})".format(len(legend_qid), len(chosen)))

    ents = wd_get(list(chosen.values()), "claims|labels")

    # collect referenced QIDs (clubs, positions, awards) for labels
    ref = set()
    per = {}
    for name, qid in chosen.items():
        e = ents.get(qid, {})
        p54 = claim_items(e, "P54")
        p413 = claim_items(e, "P413")
        p166 = claim_items(e, "P166")
        for q, _ in p54 + p413 + p166:
            if q:
                ref.add(q)
        per[name] = {"qid": qid, "p54": p54, "p413": p413, "p166": p166,
                     "p2031": claim_items(e, "P2031"), "p2032": claim_items(e, "P2032")}
    labels = wd_get(list(ref), "labels")

    def lab(q):
        return label(labels.get(q, {"id": q})) if q else "?"

    # fill-rate counters
    fld = collections.Counter()
    natl_have_caps = 0
    for name, d2 in per.items():
        if d2["p54"]:
            fld["P54 клубы"] += 1
        if d2["p413"]:
            fld["P413 позиция"] += 1
        if d2["p166"]:
            fld["P166 награды"] += 1
        if any(q == BALLON_DOR for q, _ in d2["p166"]):
            fld["└ Золотой мяч"] += 1
        # years on any P54
        if any(qual_year(ql, "P580") for _, ql in d2["p54"]):
            fld["P54 годы (P580)"] += 1
        # national team caps: P54 value labelled '...national...' with P1350
        natl = False
        for q, ql in d2["p54"]:
            lname = lab(q).lower()
            if "сборн" in lname or "national" in lname:
                if qual_amount(ql, "P1350"):
                    natl = True
        if natl:
            natl_have_caps += 1
        if any(qual_amount(ql, "P1350") for _, ql in d2["p54"]):
            fld["P1350 матчи (квал.)"] += 1
        if d2["p2031"]:
            fld["P2031 годы актив."] += 1

    n = len(per)
    print("\n" + "=" * 60)
    print("FILL-RATE по выборке ({} легенд)".format(n))
    print("=" * 60)
    order = ["P54 клубы", "P54 годы (P580)", "P413 позиция", "P166 награды",
             "└ Золотой мяч", "P1350 матчи (квал.)", "P2031 годы актив."]
    for k in order:
        v = fld.get(k, 0)
        print("  {:<22} {:>4}/{:<3} ({:>3.0f}%)".format(k, v, n, 100 * v / n))
    print("  нац.сборная с матчами  {:>4}/{:<3} ({:>3.0f}%)".format(
        natl_have_caps, n, 100 * natl_have_caps / n))

    print("\n" + "=" * 60)
    print("5 ПРИМЕРОВ — что вышло бы на карточке")
    print("=" * 60)
    shown = 0
    for name, d2 in per.items():
        if shown >= 5:
            break
        if not (d2["p54"] or d2["p166"]):
            continue
        shown += 1
        print("\n• {} ({})".format(name, d2["qid"]))
        clubs = []
        for q, ql in d2["p54"][:6]:
            yrs = qual_year(ql, "P580")
            yre = qual_year(ql, "P582")
            caps = qual_amount(ql, "P1350")
            span = ("{}–{}".format(yrs or "?", yre or "?") if (yrs or yre) else "")
            extra = " {} матч.".format(caps) if caps else ""
            clubs.append("{} {}{}".format(lab(q), span, extra).strip())
        if clubs:
            print("   клубы/сборная: " + "; ".join(clubs))
        if d2["p413"]:
            print("   позиция: " + ", ".join(lab(q) for q, _ in d2["p413"] if q))
        if d2["p166"]:
            aw = ", ".join(lab(q) for q, _ in d2["p166"][:5] if q)
            print("   награды: " + aw)


if __name__ == "__main__":
    main()
