"""Collect STAR WOMEN footballers from Wikidata (by QID) -> category='woman'
cards with the same shape as men: facts (JSONB) + tags (TEXT[]) +
legend_career (clubs with years) + name_en + country (ISO) + continent +
photo (P18). NO API-Football (its women coverage is full of holes) — Wikidata
only, free, by QID resolved from the player's name.

Pipeline per name (RU given; EN guessed for a reliable search):
  1. wbsearchentities (EN then RU) -> candidate QIDs, disambiguated to a
     FEMALE (P21=Q6581072) FOOTBALLER (P106=Q937857). Resolved QID cached per
     query, so a re-run resolves for free.
  2. wbgetentities claims+labels (cached: wikidata_entity) -> the source.
  3. one batched labels pass (cached: wikidata_labels) for referenced
     P54/P413/P166/P1344/P27 QIDs.
  4. build:
       facts          position, height_cm, birth_year, clubs_count,
                      years_active, national_team, national_caps,
                      tournaments[] (women's WC/Euro/Olympics), titles[]
                      (Ballon d'Or Féminin Q66815410, FIFA/UEFA women player
                      of the year, women's WC/Euro/UCL won)
       legend_career  {clubs:[{club,years}], position?, titles?}
       tags           woman + goalkeeper + ballon_dor + world_cup
       country/continent  from P27 country of citizenship
       photo_url      Commons P18
       name_en        en label / enwiki sitelink / the EN guess
  Politeness: the WikidataEnricher paces every call >=1s; the resolve/entity/
  label results are all cached, so re-runs make no network calls. Does NOT
  touch the shared photos_budget (those are wbgetclaims for the big photo
  backfill; this is a tiny one-off).

DRY-RUN by default — prints how many QIDs resolved, what was collected, who is
empty, 5 example cards, and writes docs/cards_women_insert.sql (idempotent
INSERT ... WHERE NOT EXISTS). Set APPLY=1 to write via PostgREST (POST new /
PATCH existing by canonical_key — idempotent).

Run from football_scraper/:  python ../docs/cards_women_build.py
"""
import os
import sys
import re
import json
import datetime

THIS_YEAR = datetime.date.today().year

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

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
from scraper.supabase_writer import build_forbidden_words  # noqa: E402

ck = run.canonical_key
APPLY = os.environ.get("APPLY") == "1"

CATEGORY = "woman"
CATEGORY_RU = "Женщины"

FOOTBALLER = "Q937857"   # association football player (P106)
FEMALE = "Q6581072"      # female (P21)
GK = "Q172964"           # goalkeeper (P413)
BALLON_FEM = "Q66815410"  # Ballon d'Or Féminin (P166)

# (name_ru AUTHORITATIVE, name_en guess for the search, qid_override).
# qid_override pins a QID for common-name needles search can't find (e.g.
# Sophia Smith plays as "Sophia Wilson" on Wikidata since her 2024 marriage and
# is buried under namesakes). None means "resolve by search".
PLAYERS = [
    ("Айтана Бонмати", "Aitana Bonmatí", None),
    ("Алексия Путельяс", "Alexia Putellas", None),
    ("Ада Хегерберг", "Ada Hegerberg", None),
    ("Меган Рапино", "Megan Rapinoe", None),
    ("Марта", "Marta Vieira da Silva", None),
    ("Кристин Синклер", "Christine Sinclair", None),
    ("Люси Бронз", "Lucy Bronze", None),
    ("Мариона Кальдентей", "Mariona Caldentey", None),
    ("Патри Гихарро", "Patri Guijarro", None),
    ("Ханна Хэмптон", "Hannah Hampton", None),
    ("Хлоя Келли", "Chloe Kelly", None),
    ("Эва Пайор", "Ewa Pajor", None),
    ("Алессия Руссо", "Alessia Russo", None),
    ("Леа Уильямсон", "Leah Williamson", None),
    ("Линда Кайседо", "Linda Caicedo", None),
    ("Мельши Дюморне", "Melchie Dumornay", None),
    ("Темва Чавинга", "Temwa Chawinga", None),
    ("Сэм Керр", "Sam Kerr", None),
    ("Алекс Морган", "Alex Morgan", None),
    ("Венди Реннард", "Wendie Renard", None),
    ("Кейра Уолш", "Keira Walsh", None),
    ("Бет Мид", "Beth Mead", None),
    ("Фридолина Рольфё", "Fridolina Rolfö", None),
    ("Каролина Грэм Хансен", "Caroline Graham Hansen", None),
    ("Триня Спонсер", None, None),  # unidentifiable from the given spelling
    ("Софья Смит", "Sophia Smith", "Q29074804"),  # plays as "Sophia Wilson"
    ("Деббинья", "Debinha", None),
    ("Гуру Рейтен", "Guro Reiten", None),
    ("Кэтлин Демайер", None, None),  # unidentifiable from the given spelling
    ("Лена Обердорф", "Lena Oberdorf", None),
]

# ---- women-specific label classifiers --------------------------------------
NAT_RE = re.compile(r"national.*team|сборн", re.I)
YOUTH_RE = re.compile(r"under|U-?\d{2}|юнош|молод|youth", re.I)
WWC_RE = re.compile(r"women'?s world cup|чемпионат мира.*женщин|"
                    r"женск\w*\s+чемпионат мира", re.I)
WEURO_RE = re.compile(r"women'?s (championship|euro)|"
                      r"чемпионат европы.*женщин", re.I)
OLY_RE = re.compile(r"olympic|олимп", re.I)
YEAR_RE = re.compile(r"(\d{4})")

# P166 prestige titles for women, most important first: (regex, short RU).
# Matched against the award's RU/EN label (we fetch those labels anyway).
WOMEN_TITLE_ORDER = (
    (re.compile(r"ballon d'?or f[ée]minin|женский золотой мяч", re.I), "Золотой мяч"),
    (re.compile(r"best fifa women'?s player|fifa women'?s world player|"
                r"fifa.*women.*player of the year|игрок года фифа.*женщин|"
                r"женщин.*игрок года фифа", re.I), "Игрок года ФИФА"),
    (re.compile(r"uefa women'?s player of the year|uefa women'?s footballer", re.I),
     "Игрок года УЕФА"),
    (WWC_RE, "ЧМ"),
    (WEURO_RE, "ЧЕ"),
    (re.compile(r"women'?s champions league|женск\w*.*лига чемпионов", re.I),
     "Лига чемпионов"),
)
TITLE_MAX = 3
CLUB_MAX = run.LEGEND_MAX_CLUBS
NOT_CLUB_RE = run.LEGEND_NOT_CLUB_RE

# When a player's P413 lists several positions (Wikidata order is unreliable —
# Keira Walsh is [forward, midfielder] yet a midfielder), pick the most
# central/defensive bucket: a "forward + midfielder" is a midfielder, a
# "defender + forward" a defender. A genuine forward carries only the forward
# tag, so pure strikers stay forwards.
POS_PRIORITY = {"Вратарь": 0, "Защитник": 1, "Полузащитник": 2, "Нападающий": 3}

# en-only club labels carry women's-football service tails the ru label drops
# ("Stanford Cardinal women's soccer", "Stabæk Fotball Kvinner"). Strip them so
# the chip reads like a normal club; ru labels (preferred) are already clean.
_CLUB_TAIL_RE = re.compile(
    r"\bwomen'?s\s+(soccer|football)\b|\bwomen'?s\b|"
    r"\b(kvinner|kvinnER|damer|damen|femen[íi]|femenino|f[ée]minines?|"
    r"feminine|femminile|frauen|ladies)\b|\(\s*w(omen)?\s*\)",
    re.I)


def clean_en_club(en):
    s = en or ""
    s = _CLUB_TAIL_RE.sub("", s)
    s = re.sub(r"\s{2,}", " ", s).strip(" -–·")
    return s


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


def iq(claims, prop):
    """[(qid, qualifiers)] for an item-valued property."""
    out = []
    for st in (claims or {}).get(prop, []):
        try:
            out.append((st["mainsnak"]["datavalue"]["value"]["id"],
                        st.get("qualifiers", {}) or {}))
        except (KeyError, TypeError):
            pass
    return out


def qty(quals, prop):
    try:
        return int(float(quals[prop][0]["datavalue"]["value"]["amount"]))
    except (KeyError, IndexError, TypeError, ValueError):
        return None


def short_nat(name):
    """National-team label -> short country name (RU genitive kept as-is)."""
    s = name or ""
    s = re.sub(r"женская\s+", "", s, flags=re.I)
    s = re.sub(r"^сборная\s+", "", s, flags=re.I)
    s = re.sub(r"\s+по футболу.*$", "", s, flags=re.I)
    s = re.sub(r"\s+women'?s national.*team.*$", "", s, flags=re.I)
    s = re.sub(r"\s+national football team.*$", "", s, flags=re.I)
    s = re.sub(r"\s+national.*team.*$", "", s, flags=re.I)
    return s.strip()


def main():
    load_dotenv(os.path.join(SCRAPER, ".env"))
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY not set (.env)")
    patch_h = {"apikey": key, "Authorization": "Bearer " + key,
               "Content-Type": "application/json", "Prefer": "return=minimal"}
    post_h = {"apikey": key, "Authorization": "Bearer " + key,
              "Content-Type": "application/json", "Prefer": "return=representation"}

    cfg = json.load(open(os.path.join(SCRAPER, "config.json"), encoding="utf-8"))
    cache = FileCache(os.path.join(SCRAPER, "cache"), True)
    wd = WikidataEnricher(cfg["wikidata"], cache)

    # ---- QID resolution (cached per query so re-runs are free) -------------
    def is_female_footballer(entity):
        p106 = [q for q, _ in iq(entity.get("claims", {}), "P106")]
        p21 = [q for q, _ in iq(entity.get("claims", {}), "P21")]
        return (FOOTBALLER in p106, FEMALE in p21)

    def search_resolve(query, lang):
        search = wd._api({"action": "wbsearchentities", "search": query,
                          "language": lang, "uselang": lang,
                          "type": "item", "limit": 10})
        ids = [c["id"] for c in search.get("search", []) if c.get("id")]
        if not ids:
            return None
        ents = wd._api({"action": "wbgetentities", "ids": "|".join(ids),
                        "props": "claims"}).get("entities", {})
        female_footballer = footballer = None
        for qid in ids:  # search relevance order
            ent = ents.get(qid)
            if not ent:
                continue
            is_fb, is_f = is_female_footballer(ent)
            if is_fb and is_f and female_footballer is None:
                female_footballer = qid
            elif is_fb and footballer is None:
                footballer = qid
        return female_footballer or footballer

    def resolve_qid(name_ru, name_en, qid_override=None):
        if qid_override:
            return qid_override
        for query, lang in ((name_en, "en"), (name_ru, "ru")):
            if not query:
                continue
            ckey = "{}|{}".format(lang, query)
            cached = cache.get("women_qid", ckey)
            if cached is not None:
                if cached.get("qid"):
                    return cached["qid"]
                continue
            qid = search_resolve(query, lang)
            cache.set("women_qid", ckey, {"qid": qid})
            if qid:
                return qid
        return None

    # ---- pass 1: resolve + fetch entities, gather label QIDs --------------
    resolved = []   # (name_ru, name_en_guess, qid, entity)
    empty = []      # name_ru with no QID
    need = set()
    for name_ru, name_en, qid_override in PLAYERS:
        qid = resolve_qid(name_ru, name_en, qid_override)
        if not qid:
            empty.append(name_ru)
            continue
        ent = wd.entity_claims_labels(qid)
        if not ent:
            empty.append(name_ru)
            continue
        resolved.append((name_ru, name_en, qid, ent))
        cl = ent.get("claims", {}) or {}
        for prop in ("P54", "P413", "P166", "P1344", "P27"):
            for q, _ in iq(cl, prop):
                need.add(q)

    wd.labels_for_qids(sorted(need))

    def lab(qid):
        r = cache.get("wikidata_labels", qid) or {}
        return r.get("ru") or r.get("en") or ""

    def lab_en(qid):
        r = cache.get("wikidata_labels", qid) or {}
        return r.get("en") or r.get("ru") or ""

    def club_display(qid):
        """Russian club label when Wikidata has one (already clean), else the
        en label with women's-football service tails stripped."""
        r = cache.get("wikidata_labels", qid) or {}
        return (r.get("ru") or clean_en_club(r.get("en"))).strip()

    # ---- pass 2: build cards ----------------------------------------------
    cards = []
    for name_ru, name_en_guess, qid, ent in resolved:
        cl = ent.get("claims", {}) or {}
        labels = ent.get("labels", {}) or {}
        f = {}

        # name_en: en label -> enwiki sitelink -> guess
        name_en = (labels.get("en", {}) or {}).get("value")
        if not name_en:
            name_en = wd.titles_for_qid(qid).get("enwiki")
        if not name_en:
            name_en = name_en_guess

        # height (P2048, metres -> cm)
        for st in cl.get("P2048", []):
            try:
                a = float(st["mainsnak"]["datavalue"]["value"]["amount"])
                f["height_cm"] = int(a * 100 if a < 3 else a)
                break
            except (KeyError, TypeError, ValueError):
                pass
        # birth year (P569)
        for st in cl.get("P569", []):
            try:
                f["birth_year"] = int(st["mainsnak"]["datavalue"]["value"]["time"][1:5])
                break
            except (KeyError, TypeError, ValueError):
                pass

        # position (P413) -> most central RU bucket across all listed positions
        p413_buckets = [b for b in (run.position_ru_from_label(lab(q))
                                    for q, _ in iq(cl, "P413")) if b]
        position = (min(p413_buckets, key=lambda b: POS_PRIORITY[b])
                    if p413_buckets else None)
        if position:
            f["position"] = position
        has_gk = position == "Вратарь" or GK in [q for q, _ in iq(cl, "P413")]

        # clubs (P54) — national/youth dropped; spans merged; longest tenures
        spans = {}
        nat = {}
        for q, ql in iq(cl, "P54"):
            raw = lab(q)
            if not raw:
                continue
            if NAT_RE.search(raw):
                if YOUTH_RE.search(raw):
                    continue
                caps = qty(ql, "P1350") or 0
                nat[raw] = max(nat.get(raw, 0), caps)
                continue
            if NOT_CLUB_RE.search(raw):
                continue
            name = club_display(q)
            if not name:
                continue
            s = run._wd_year(ql, "P580")
            e = run._wd_year(ql, "P582")
            cur = spans.get(name)
            ns = min(int(s), cur[0]) if (s and cur and cur[0]) else (
                int(s) if s else (cur[0] if cur else None))
            ne = max(int(e), cur[1]) if (e and cur and cur[1]) else (
                int(e) if e else (cur[1] if cur else None))
            spans[name] = (ns, ne)
        clubs = []
        for name, (s, e) in spans.items():
            years = "{}–{}".format(s, e) if (s and e) else (
                "{}–".format(s) if s else "")
            # Active players: an ongoing stint (start, no end) is the CURRENT
            # club — rank it by tenure to today, not as "unknown" (else the
            # defining club, e.g. Hegerberg's Lyon, drops off the top-N).
            dur = (e - s) if (s and e) else ((THIS_YEAR - s) if s else -1)
            clubs.append({"club": name, "years": years, "_s": s or 9999, "_d": dur})
        clubs.sort(key=lambda c: (-c["_d"], c["_s"]))
        clubs = clubs[:CLUB_MAX]
        for c in clubs:
            del c["_s"], c["_d"]
        if clubs:
            f["clubs_count"] = len(spans)
            starts = [s for s, _ in spans.values() if s]
            ends = [e for _, e in spans.values() if e]
            ongoing = any(s and not e for s, e in spans.values())
            if starts:
                lo = min(starts)
                if ongoing or not ends:
                    f["years_active"] = "{}–".format(lo)
                else:
                    f["years_active"] = "{}–{}".format(lo, max(ends))

        # national team + caps
        if nat:
            team = max(nat, key=lambda k: nat[k])
            f["national_team"] = short_nat(team)
            if nat[team]:
                f["national_caps"] = nat[team]

        # tournaments (P1344 participant) — women's WC / Euro / Olympics
        tours = []
        for q, _ in iq(cl, "P1344"):
            nm = lab(q)
            if not nm or YOUTH_RE.search(nm):
                continue
            mt = YEAR_RE.search(nm)
            y = mt.group(1) if mt else None
            if WWC_RE.search(nm):
                tours.append("ЧМ-{}".format(y) if y else "ЧМ")
            elif WEURO_RE.search(nm):
                tours.append("Евро-{}".format(y) if y else "Евро")
            elif OLY_RE.search(nm):
                tours.append("ОИ-{}".format(y) if y else "ОИ")
        tours = sorted(set(tours))
        if tours:
            f["tournaments"] = tours

        # titles (P166) — women's prestige awards, priority-ordered
        years_by = {}  # short_ru -> [years]
        has_ballon = False
        for q, ql in iq(cl, "P166"):
            nm_ru, nm_en = lab(q), lab_en(q)
            text = "{} {}".format(nm_ru, nm_en)
            if q == BALLON_FEM:
                has_ballon = True
            for rx, short in WOMEN_TITLE_ORDER:
                if rx.search(text):
                    if short == "Золотой мяч":
                        has_ballon = True
                    years_by.setdefault(short, []).append(
                        run._wd_year(ql, "P585"))
                    break
        titles = []
        seen = set()
        for _rx, short in WOMEN_TITLE_ORDER:
            if short in seen or short not in years_by or len(titles) >= TITLE_MAX:
                continue
            seen.add(short)
            ys = sorted(y for y in years_by[short] if y)
            n = len(years_by[short])
            if n > 1:
                titles.append("{} ×{}".format(short, n))
            elif ys:
                titles.append("{} {}".format(short, ys[0]))
            else:
                titles.append(short)
        if titles:
            f["titles"] = titles

        # country (P27) -> ISO + continent
        country = continent = None
        for q, _ in iq(cl, "P27"):
            cname = lab_en(q)
            code = run.COUNTRY_ISO.get((cname or "").lower())
            if code:
                country = code
                continent = run.continent_for_country(cname)
                break

        # photo (P18, Commons)
        photo = None
        fn = wd.media_filename_for_qid(qid, "P18")
        if fn:
            photo = commons_filepath_url(fn, cfg["photos"]["width"],
                                         cfg["photos"]["filepath_base"])

        # legend_career (clubs with years; women have no API minutes)
        lc = {"clubs": clubs}
        if position:
            lc["position"] = position
        if titles:
            lc["titles"] = titles

        # tags: woman + shared special categories
        tags = ["woman"]
        if has_gk:
            tags.append("goalkeeper")
        if has_ballon:
            tags.append("ballon_dor")
        if any(t.startswith("ЧМ") or t.startswith("Евро") for t in tours):
            tags.append("world_cup")

        cards.append({
            "name": name_ru, "name_en": name_en, "qid": qid,
            "category": CATEGORY, "category_ru": CATEGORY_RU,
            "forbidden_words": build_forbidden_words(name_ru),
            "photo_url": photo, "country": country, "continent": continent,
            "position_ru": position, "facts": f, "tags": tags,
            "legend_career": lc, "active": True,
        })

    # ---- dedup against the live deck (canonical_key) ----------------------
    existing = fetch_all(url, key, "cards", "id,name,category")
    by_key = {}
    for c in existing:
        k = ck(c.get("name"))
        if k and k not in by_key:
            by_key[k] = c
    new_cards, dup_cards = [], []
    for c in cards:
        ex = by_key.get(ck(c["name"]))
        if ex:
            dup_cards.append((c, ex))
        else:
            new_cards.append(c)

    # ---- report -----------------------------------------------------------
    print("=" * 64)
    print("STAR WOMEN — Wikidata collect (DRY-RUN)" if not APPLY
          else "STAR WOMEN — Wikidata collect (APPLY)")
    print("=" * 64)
    print("requested            : {}".format(len(PLAYERS)))
    print("QID resolved         : {}".format(len(resolved)))
    print("QID NOT resolved     : {}".format(len(empty)))
    if empty:
        for nm in empty:
            print("    ! no QID: {}".format(nm))
    print("-" * 64)
    print("already in deck (skip): {}".format(len(dup_cards)))
    for c, ex in dup_cards:
        print("    = {} -> existing «{}» [{}] id={}".format(
            c["name"], ex.get("name"), ex.get("category"), ex.get("id")))
    print("NEW to insert        : {}".format(len(new_cards)))
    print("-" * 64)

    # facts fill across all resolved
    keys = ("position", "height_cm", "birth_year", "clubs_count",
            "years_active", "national_team", "national_caps",
            "tournaments", "titles")
    n = len(cards)
    print("FACTS fill (of {} resolved):".format(n))
    for k in keys:
        got = sum(1 for c in cards if c["facts"].get(k))
        print("  {:14}: {} ({}%)".format(k, got, 100 * got // max(n, 1)))
    print("  {:14}: {}".format("photo_url", sum(1 for c in cards if c["photo_url"])))
    print("  {:14}: {}".format("country", sum(1 for c in cards if c["country"])))
    print("  {:14}: {}".format("continent", sum(1 for c in cards if c["continent"])))
    tagc = {}
    for c in cards:
        for t in c["tags"]:
            tagc[t] = tagc.get(t, 0) + 1
    print("  tags          : " + ", ".join("{}={}".format(t, tagc[t])
                                            for t in sorted(tagc)))
    # who came back nearly empty (resolved but thin)
    thin = [c["name"] for c in cards
            if not c["facts"].get("titles") and not c["legend_career"]["clubs"]]
    if thin:
        print("  thin (no clubs & no titles): " + ", ".join(thin))

    # ---- 5 example cards --------------------------------------------------
    print("\n" + "=" * 64)
    print("5 EXAMPLE CARDS (before write)")
    print("=" * 64)
    for c in cards[:5]:
        print(json.dumps(c, ensure_ascii=False, indent=2))
        print("-" * 64)

    # ---- write idempotent SQL --------------------------------------------
    def q(v):
        return "NULL" if v is None or v == "" else "'" + str(v).replace("'", "''") + "'"

    def arr(words):
        return "ARRAY[" + ",".join(q(w) for w in words) + "]::text[]"

    def jb(obj):
        if not obj:
            return "NULL"
        return "'" + json.dumps(obj, ensure_ascii=False).replace("'", "''") + "'::jsonb"

    out = os.path.join(HERE, "cards_women_insert.sql")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write("-- STAR WOMEN cards (category='woman') from Wikidata. "
                 "Idempotent:\n-- each row inserts only when no card with that "
                 "name exists yet.\n")
        fh.write("-- {} new of {} requested ({} already in deck, {} unresolved)."
                 "\n\n".format(len(new_cards), len(PLAYERS),
                               len(dup_cards), len(empty)))
        for c in new_cards:
            fh.write(
                "INSERT INTO cards (name, name_en, category, category_ru, "
                "forbidden_words, photo_url, country, continent, position_ru, "
                "facts, tags, legend_career, active)\n"
                "SELECT {}, {}, 'woman', 'Женщины', {}, {}, {}, {}, {}, {}, {}, "
                "{}, true\n"
                "WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = "
                "lower({}));\n\n".format(
                    q(c["name"]), q(c["name_en"]), arr(c["forbidden_words"]),
                    q(c["photo_url"]), q(c["country"]), q(c["continent"]),
                    q(c["position_ru"]), jb(c["facts"]), arr(c["tags"]),
                    jb(c["legend_career"]), q(c["name"])))
        fh.write("NOTIFY pgrst, 'reload schema';\n")
    print("\nSQL written to: docs/cards_women_insert.sql "
          "({} new rows)".format(len(new_cards)))

    # ---- APPLY (optional) -------------------------------------------------
    if not APPLY:
        print("\nDRY-RUN — nothing written to the DB. Set APPLY=1 to write.")
        return

    inserted = patched = 0
    enrich_cols = ("name_en", "category", "category_ru", "photo_url", "country",
                   "continent", "position_ru", "facts", "tags", "legend_career")
    for c in cards:
        ex = by_key.get(ck(c["name"]))
        if ex:
            body = {k: c[k] for k in enrich_cols if c[k] not in (None, "", [])}
            r = requests.patch(url.rstrip("/") + "/rest/v1/cards",
                               headers=patch_h,
                               params={"id": "eq." + str(ex["id"])},
                               json=body, timeout=30)
            r.raise_for_status()
            patched += 1
        else:
            body = {
                "name": c["name"], "name_en": c["name_en"],
                "category": c["category"], "category_ru": c["category_ru"],
                "forbidden_words": c["forbidden_words"],
                "photo_url": c["photo_url"], "country": c["country"],
                "continent": c["continent"], "position_ru": c["position_ru"],
                "facts": c["facts"], "tags": c["tags"],
                "legend_career": c["legend_career"], "active": True,
            }
            r = requests.post(url.rstrip("/") + "/rest/v1/cards",
                              headers=post_h, json=body, timeout=30)
            r.raise_for_status()
            inserted += 1
    print("\nAPPLIED — inserted {} new, patched {} existing.".format(
        inserted, patched))


if __name__ == "__main__":
    main()
