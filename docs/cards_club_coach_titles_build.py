"""Build cards.facts.titles for CLUB and COACH cards.

Players got their honours from docs/cards_facts_build.py; clubs and coaches
were never covered, so their summary history shows only a name. This fills
the same `facts.titles[]` array the history already renders as the gold
"🏆 ..." line (see titlesLine() in src/screens/TrainingScreen.tsx) — no
frontend change is needed, only data.

Two sources, because Wikidata models the two very differently:

  CLUBS  — reliable and fully automatic. A competition EDITION carries
           P1346 (winner) -> the club, and P3450 (season of league or
           competition) -> the competition itself. Counting editions per
           competition gives "Лига чемпионов ×15" straight from the data.
           One SPARQL query per batch of clubs.

  COACHES — Wikidata is sparse and inconsistent for managers: honours won
           while managing live on club-season items, not on the person, and
           coverage is patchy. Rather than emit confident-looking noise, the
           33 coach cards use the curated COACH_TITLES table below (reviewed
           by hand); Wikidata P166 "award received" is merged in only as
           extra individual awards. Coaches missing from the table are
           reported so the gap is visible instead of silently empty.

Title strings follow the format the app already uses for players
(legend_career.titles / facts.titles): a short Russian label plus an
optional "×N" or year — "Лига чемпионов ×15", "ЧМ 1998". Labels that appear
in TITLE_KEYS in TrainingScreen.tsx are translated for non-Russian
interfaces; anything else stays Russian (see README note in the PR).

OUTPUT — DRY-RUN by default: fetches, computes, prints coverage, writes
NOTHING. Then either:
    SQL_OUT=docs/cards_club_coach_titles.sql   emit a reviewable migration
    APPLY=1                                    PATCH cards.facts directly

Both are idempotent: a card is only touched when its titles actually change.

SETUP
    cd football_scraper
    pip install -r requirements.txt          # requests, python-dotenv
    cat > .env <<'EOF'
    SUPABASE_URL=https://konoavrduynecxblqfvq.supabase.co
    SUPABASE_KEY=<service_role key — NOT the anon key, RLS blocks writes>
    EOF

RUN (needs outbound access to wikidata.org and query.wikidata.org)
    cd football_scraper
    python ../docs/cards_club_coach_titles_build.py                  # dry-run
    SQL_OUT=../docs/cards_club_coach_titles.sql \
        python ../docs/cards_club_coach_titles_build.py              # migration
    APPLY=1 python ../docs/cards_club_coach_titles_build.py          # direct

Wikidata calls are polite (>=1s apart, contact User-Agent) and cached under
football_scraper/cache/, so a dry-run followed by a real run costs one pass.
Re-running after a failure resumes from the cache.
"""
import os
import sys
import json
import time
import re

import requests
from dotenv import load_dotenv

HERE = os.path.dirname(os.path.abspath(__file__))
SCRAPER = os.path.join(HERE, "..", "football_scraper")
sys.path.insert(0, SCRAPER)
from scraper.cache import FileCache  # noqa: E402

APPLY = os.environ.get("APPLY") == "1"
SQL_OUT = os.environ.get("SQL_OUT")
# LIMIT=10 runs the whole pipeline over the first N clubs only — use it for a
# smoke test before committing to the full 432-card pass.
LIMIT = int(os.environ.get("LIMIT") or 0)

SPARQL_URL = "https://query.wikidata.org/sparql"
WD_API = "https://www.wikidata.org/w/api.php"
RUWIKI_API = "https://ru.wikipedia.org/w/api.php"
UA = ("SherlockScholesBot/0.1 (club+coach honours; "
      "contact: giafreec@gmail.com)")
PAUSE = 1.0            # seconds between Wikidata calls — do not weaken
SPARQL_BATCH = 40      # clubs per SPARQL query
MIN_PER_COMP = 1       # ignore a competition won fewer times than this
MAX_TITLES = 4         # the history line shows at most 3; keep a little slack

# Wikidata "instance of" values that make an item a football club / manager.
CLUB_QIDS = {"Q476028", "Q15944511", "Q17318786", "Q847017"}
COACH_QIDS = {"Q628099", "Q193391"}   # football manager, coach

# Competition label (ru or en, as SPARQL returns it) -> short label used in
# the card. Order matters: the first regex that matches wins, so put the
# more specific patterns first.
COMP_LABELS = [
    (r"Лига чемпионов УЕФА|UEFA Champions League|European Cup", "Лига чемпионов"),
    (r"Лига Европы УЕФА|UEFA Europa League|UEFA Cup", "Лига Европы"),
    (r"Лига конференций|UEFA Conference League", "Лига конференций"),
    (r"Суперкубок УЕФА|UEFA Super Cup", "Суперкубок УЕФА"),
    (r"Кубок обладателей кубков|Cup Winners.? Cup", "Кубок кубков"),
    (r"Клубный чемпионат мира|FIFA Club World Cup", "КЧМ"),
    (r"Межконтинентальный кубок|Intercontinental Cup", "Межконтинентальный кубок"),
    (r"Кубок Либертадорес|Copa Libertadores", "Кубок Либертадорес"),
    (r"Премьер-лига|Premier League|Football League First Division", "Чемпионат Англии"),
    (r"Ла Лига|La Liga|Primera Divisi", "Чемпионат Испании"),
    (r"Серия A|Serie A", "Чемпионат Италии"),
    (r"Бундеслига|Bundesliga", "Чемпионат Германии"),
    (r"Лига 1|Ligue 1|French Division 1", "Чемпионат Франции"),
    (r"Эредивизи|Eredivisie", "Чемпионат Нидерландов"),
    (r"Примейра|Primeira Liga", "Чемпионат Португалии"),
    (r"чемпионат России|Russian Premier League|Russian Football Championship",
     "Чемпионат России"),
    (r"чемпионат СССР|Soviet Top League", "Чемпионат СССР"),
    (r"Кубок Англии|FA Cup", "Кубок Англии"),
    (r"Кубок Испании|Copa del Rey", "Кубок Испании"),
    (r"Кубок Италии|Coppa Italia", "Кубок Италии"),
    (r"Кубок Германии|DFB-Pokal", "Кубок Германии"),
    (r"Кубок Франции|Coupe de France", "Кубок Франции"),
    (r"Кубок России|Russian Cup", "Кубок России"),
]

# Curated coach honours — see the module docstring for why these are not
# scraped. Keys are cards.name (Russian) exactly as stored.
COACH_TITLES = {
    "Алекс Фергюсон":        ["Лига чемпионов ×2", "Чемпионат Англии ×13", "Кубок Англии ×5"],
    "Арсен Венгер":          ["Чемпионат Англии ×3", "Кубок Англии ×7"],
    "Жозе Моуриньо":         ["Лига чемпионов ×2", "Лига Европы ×2", "Чемпионат Англии ×3"],
    "Юрген Клопп":           ["Лига чемпионов ×1", "Чемпионат Англии ×1", "Чемпионат Германии ×2"],
    "Марчелло Липпи":        ["ЧМ 2006", "Лига чемпионов ×1", "Чемпионат Италии ×5"],
    "Оттмар Хитцфельд":      ["Лига чемпионов ×2", "Чемпионат Германии ×7"],
    "Луи ван Гаал":          ["Лига чемпионов ×1", "Чемпионат Нидерландов ×3", "Чемпионат Испании ×2"],
    "Луис Фелипе Сколари":   ["ЧМ 2002", "Кубок Либертадорес ×1"],
    "Марио Загалло":         ["ЧМ 1970"],
    "Йоахим Лёв":            ["ЧМ 2014"],
    "Фернандо Сантуш":       ["ЧЕ 2016"],
    "Рафаэль Бенитес":       ["Лига чемпионов ×1", "Лига Европы ×2", "Чемпионат Испании ×1"],
    "Клаудио Раньери":       ["Чемпионат Англии ×1"],
    "Отто Рехагель":         ["ЧЕ 2004", "Чемпионат Германии ×2"],
    "Гус Хиддинк":           ["Лига чемпионов ×1", "Чемпионат Нидерландов ×6"],
    "Дик Адвокат":           ["Кубок УЕФА ×1", "Чемпионат Нидерландов ×2"],
    "Жерар Улье":            ["Лига Европы ×1", "Чемпионат Франции ×1"],
    "Лучано Спаллетти":      ["Чемпионат Италии ×1", "Кубок России ×1"],
    "Мануэль Пеллегрини":    ["Чемпионат Англии ×1"],
    "Томас Шааф":            ["Чемпионат Германии ×1", "Кубок Германии ×3"],
    "Курбан Бердыев":        ["Чемпионат России ×2", "Кубок России ×1"],
    "Артур Жорже":           ["Чемпионат Португалии ×2"],
    "Хуанде Рамос":          ["Лига Европы ×2"],
    "Мартин О'Нил":          ["Чемпионат Шотландии ×3"],
    "Зденек Земан":          [],
    "Джан Пьеро Гасперини":  [],
    "Ральф Рангник":         [],
    "Рой Ходжсон":           [],
    "Мартин Йол":            [],
    "Раймонд Доменек":       [],
    "Валерий Непомнящий":    [],
    "Валерий Петраков":      [],
    "Рашид Рахимов":         [],
}


def http_json(url, params, headers=None, method="get", timeout=60):
    """One polite, retrying request. Returns parsed JSON or {}."""
    h = {"User-Agent": UA, "Accept": "application/sparql-results+json"}
    h.update(headers or {})
    for attempt in range(1, 4):
        time.sleep(PAUSE)
        try:
            r = requests.request(method, url, params=params, headers=h, timeout=timeout)
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(min(2 ** attempt, 30))
                continue
            r.raise_for_status()
            return r.json()
        except requests.RequestException as e:
            if attempt == 3:
                print(f"  ! request failed: {e}")
                return {}
            time.sleep(min(2 ** attempt, 30))
    return {}


def fetch_all(url, key, table, sel, extra=None):
    """Paginated PostgREST read — the API caps a response at 1000 rows."""
    out, off = [], 0
    while True:
        p = {"select": sel, "limit": 1000, "offset": off}
        p.update(extra or {})
        r = requests.get(url.rstrip("/") + f"/rest/v1/{table}",
                         headers={"apikey": key, "Authorization": "Bearer " + key},
                         params=p, timeout=30)
        r.raise_for_status()
        b = r.json()
        out += b
        if len(b) < 1000:
            break
        off += 1000
    return out


def short_comp(label):
    """Competition label from Wikidata -> the short label used on a card."""
    for pattern, short in COMP_LABELS:
        if re.search(pattern, label, re.I):
            return short
    return None


def resolve_qid(cache, name, name_en, want):
    """QID for a club/coach card, or None. Cached including the miss."""
    ck = f"{want}|{name}|{name_en or ''}"
    hit = cache.get("club_coach_qid", ck)
    if hit is not None:
        return hit.get("qid")

    qid = None
    # 1) ruwiki article -> wikibase_item is the most precise route: the card
    #    name IS the Russian article title in almost every case.
    for title in filter(None, [name, name_en]):
        data = http_json(RUWIKI_API, {
            "action": "query", "prop": "pageprops", "ppprop": "wikibase_item",
            "titles": title, "redirects": 1, "format": "json",
        }, headers={"Accept": "application/json"})
        for page in (data.get("query", {}).get("pages", {}) or {}).values():
            got = (page.get("pageprops") or {}).get("wikibase_item")
            if got:
                qid = got
                break
        if qid:
            break

    # 2) fall back to entity search, keeping the first candidate whose P31
    #    (club) or P106 (manager) matches what we asked for.
    if not qid:
        for lang, term in (("ru", name), ("en", name_en)):
            if not term:
                continue
            res = http_json(WD_API, {
                "action": "wbsearchentities", "search": term, "language": lang,
                "uselang": lang, "limit": 5, "format": "json",
            }, headers={"Accept": "application/json"})
            for cand in res.get("search", []) or []:
                if entity_matches(cache, cand["id"], want):
                    qid = cand["id"]
                    break
            if qid:
                break

    cache.set("club_coach_qid", ck, {"qid": qid})
    return qid


def entity_claims(cache, qid):
    """claims dict for a QID, cached."""
    hit = cache.get("club_coach_entity", qid)
    if hit is not None:
        return hit.get("claims", {})
    data = http_json(WD_API, {
        "action": "wbgetentities", "ids": qid, "props": "claims", "format": "json",
    }, headers={"Accept": "application/json"})
    claims = ((data.get("entities", {}) or {}).get(qid, {}) or {}).get("claims", {}) or {}
    cache.set("club_coach_entity", qid, {"claims": claims})
    return claims


def entity_matches(cache, qid, want):
    """True when the entity is a football club / manager, per P31 / P106."""
    claims = entity_claims(cache, qid)
    prop = "P31" if want == "club" else "P106"
    allowed = CLUB_QIDS if want == "club" else COACH_QIDS
    for st in claims.get(prop, []) or []:
        try:
            if st["mainsnak"]["datavalue"]["value"]["id"] in allowed:
                return True
        except (KeyError, TypeError):
            pass
    return False


def club_titles_batch(qids):
    """{qid: [title, ...]} for a batch of club QIDs, via one SPARQL query.

    A competition edition carries P1346 (winner) and P3450 (the competition
    it is an edition of), so grouping editions by competition counts titles.
    """
    values = " ".join(f"wd:{q}" for q in qids)
    query = f"""
SELECT ?club ?compLabel (COUNT(DISTINCT ?edition) AS ?n) WHERE {{
  VALUES ?club {{ {values} }}
  ?edition wdt:P1346 ?club .
  ?edition wdt:P3450 ?comp .
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "ru,en". }}
}}
GROUP BY ?club ?compLabel
"""
    data = http_json(SPARQL_URL, {"query": query})
    out = {}
    for b in (data.get("results", {}) or {}).get("bindings", []) or []:
        qid = b["club"]["value"].rsplit("/", 1)[-1]
        short = short_comp(b["compLabel"]["value"])
        n = int(b["n"]["value"])
        if not short or n < MIN_PER_COMP:
            continue
        # Two Wikidata labels can collapse to one short label (e.g. the
        # old European Cup and the modern Champions League) — sum them.
        bucket = out.setdefault(qid, {})
        bucket[short] = bucket.get(short, 0) + n
    return {
        q: [f"{c} ×{n}" for c, n in
            sorted(comps.items(), key=lambda kv: -kv[1])[:MAX_TITLES]]
        for q, comps in out.items()
    }


def main():
    load_dotenv(os.path.join(SCRAPER, ".env"))
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not url or not key:
        sys.exit("SUPABASE_URL / SUPABASE_KEY missing — see the docstring.")
    cache = FileCache(os.path.join(SCRAPER, "cache"), True)

    # Fail loudly and early if Wikidata is unreachable — otherwise every QID
    # lookup silently returns None and the run "succeeds" with zero titles.
    probe = http_json(WD_API, {"action": "wbgetentities", "ids": "Q8682",
                               "props": "labels", "languages": "en", "format": "json"},
                      headers={"Accept": "application/json"})
    if not probe.get("entities"):
        sys.exit("Cannot reach wikidata.org — check the network/proxy before running.")

    cards = fetch_all(url, key, "cards", "id,name,name_en,category,facts",
                      {"category": "in.(club,coach)", "active": "eq.true"})
    clubs = [c for c in cards if c["category"] == "club"]
    coaches = [c for c in cards if c["category"] == "coach"]
    if LIMIT:
        clubs = clubs[:LIMIT]
        print(f"LIMIT={LIMIT} — smoke test over the first {len(clubs)} clubs only")
    print(f"cards: {len(clubs)} clubs, {len(coaches)} coaches")

    # ---- clubs: resolve QIDs, then one SPARQL round per batch -------------
    print("\nresolving club QIDs (cached; first run is the slow one)…")
    by_qid = {}
    for i, c in enumerate(clubs, 1):
        q = resolve_qid(cache, c["name"], c.get("name_en"), "club")
        if q:
            by_qid.setdefault(q, []).append(c)
        if i % 25 == 0:
            print(f"  {i}/{len(clubs)}")
    print(f"  resolved {len(by_qid)}/{len(clubs)}")

    titles = {}   # card id -> [titles]
    qids = list(by_qid)
    for i in range(0, len(qids), SPARQL_BATCH):
        batch = qids[i:i + SPARQL_BATCH]
        print(f"  SPARQL {i + 1}-{i + len(batch)} of {len(qids)}")
        for q, ts in club_titles_batch(batch).items():
            for c in by_qid.get(q, []):
                titles[c["id"]] = ts

    # ---- coaches: curated table -------------------------------------------
    missing = []
    for c in coaches:
        ts = COACH_TITLES.get(c["name"])
        if ts is None:
            missing.append(c["name"])
        elif ts:
            titles[c["id"]] = ts[:MAX_TITLES]

    # ---- report ------------------------------------------------------------
    club_hits = sum(1 for c in clubs if titles.get(c["id"]))
    coach_hits = sum(1 for c in coaches if titles.get(c["id"]))
    print(f"\nclubs with titles : {club_hits}/{len(clubs)}")
    print(f"coaches with titles: {coach_hits}/{len(coaches)}")
    if missing:
        print(f"coaches absent from COACH_TITLES ({len(missing)}): {', '.join(missing)}")
    for c in (clubs + coaches)[:15]:
        if titles.get(c["id"]):
            print(f"  {c['name']:<28} {' · '.join(titles[c['id']])}")

    # Only touch cards whose titles actually change.
    changed = []
    for c in clubs + coaches:
        new = titles.get(c["id"])
        if not new:
            continue
        old = ((c.get("facts") or {}).get("titles")) or []
        if list(old) != list(new):
            changed.append((c, new))
    print(f"\ncards needing an update: {len(changed)}")

    if SQL_OUT:
        path = SQL_OUT if os.path.isabs(SQL_OUT) else os.path.join(os.getcwd(), SQL_OUT)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(
                "-- cards.facts.titles for club + coach cards.\n"
                "-- Generated by docs/cards_club_coach_titles_build.py — do not\n"
                "-- hand-edit; change COACH_TITLES / COMP_LABELS and re-run.\n"
                "-- Clubs come from Wikidata (P1346 winner x P3450 competition),\n"
                "-- coaches from the curated table in that script.\n"
                "-- jsonb_set with create_missing keeps every other facts key.\n\n"
                "begin;\n\n"
            )
            for c, ts in changed:
                arr = json.dumps(ts, ensure_ascii=False)
                fh.write(
                    f"-- {c['name']}\n"
                    f"update cards set facts = jsonb_set("
                    f"coalesce(facts, '{{}}'::jsonb), '{{titles}}', "
                    f"'{arr}'::jsonb, true) where id = '{c['id']}';\n"
                )
            fh.write("\ncommit;\n")
        print(f"wrote {path} ({len(changed)} statements) — review, then apply")

    if APPLY:
        patch_h = {"apikey": key, "Authorization": "Bearer " + key,
                   "Content-Type": "application/json", "Prefer": "return=minimal"}
        for c, ts in changed:
            facts = dict(c.get("facts") or {})
            facts["titles"] = ts
            r = requests.patch(url.rstrip("/") + "/rest/v1/cards", headers=patch_h,
                               params={"id": "eq." + c["id"]},
                               json={"facts": facts}, timeout=30)
            r.raise_for_status()
        print(f"PATCHed {len(changed)} cards")
    elif not SQL_OUT:
        print("DRY-RUN (no writes) — set SQL_OUT=... or APPLY=1")


if __name__ == "__main__":
    main()
