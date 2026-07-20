"""Build cards.career_stats (JSONB) for KNOWN veterans whose minutes are
unreliable — clubs + years + apps + goals from the Wikipedia infobox.

WHY: clubs_minutes only covers the 2022-24 API cache, so veterans show a
misleading tail (Walcott 490') or nothing. Wikipedia has NO minutes, but its
"Infobox football biography" has the full senior career as
"club | years | apps (goals)". We store the top clubs by apps so the card can
show "Арсенал 2006–18 · 270 матчей, 65 голов" instead of fake minutes.

SELECTION (per the agreed plan):
  * pool = players with legend_career OR a veteran-tail clubs_minutes
    (age>=33 & total<4500) — i.e. "known", no nonames;
  * gate = Wikipedia career richness: keep only if total senior apps >= 150
    (NOT tier/pageviews — those are unreliable for veterans, e.g. Walcott
     pv=289 from a name mismatch);
  * QID present  -> Wikidata sitelinks -> enwiki/ruwiki article;
  * QID MISSING  -> resolve name_en/name -> enwiki article directly (returns
     Giroud and other known players with no players_meta QID).

career_stats = [{club, years, apps, goals}] (top 4 by apps).

Budget: shared photos_budget.json (Wikipedia fetches), polite, resumable
(wikitext cached). DRY-RUN by default; APPLY=1 PATCHes cards.career_stats
guarded by IS NULL (idempotent). Needs the ALTER:
  alter table cards add column if not exists career_stats jsonb;

Run from football_scraper/:  python ../docs/cards_career_build.py
                             APPLY=1 python ../docs/cards_career_build.py
"""
import os, sys, re, json, time
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
NOW = 2026
MIN_APPS = 150          # Wikipedia career-richness gate
TOP_CLUBS = 4
UA = "SherlockScholesBot/0.1 (career_stats; giafreec@gmail.com)"


def fetch_all(url, key, table, select):
    rows, off = [], 0
    while True:
        r = requests.get(url.rstrip("/") + "/rest/v1/" + table,
                         headers={"apikey": key, "Authorization": "Bearer " + key},
                         params={"select": select, "order": "id.asc", "limit": 1000, "offset": off}, timeout=60)
        r.raise_for_status(); b = r.json(); rows += b
        if len(b) < 1000:
            break
        off += 1000
    return rows


# ---- infobox parsing (bracket-depth aware) ----
def split_params(ib):
    inner = ib[2:-2]
    parts, buf, bd, ld, i = [], [], 0, 0, 0
    while i < len(inner):
        two = inner[i:i + 2]
        if two == "{{": bd += 1; buf.append(two); i += 2; continue
        if two == "}}": bd -= 1; buf.append(two); i += 2; continue
        if two == "[[": ld += 1; buf.append(two); i += 2; continue
        if two == "]]": ld -= 1; buf.append(two); i += 2; continue
        ch = inner[i]
        if ch == "|" and bd == 0 and ld == 0:
            parts.append("".join(buf)); buf = []
        else:
            buf.append(ch)
        i += 1
    parts.append("".join(buf))
    params = {}
    for p in parts[1:]:
        if "=" in p:
            k, v = p.split("=", 1)
            params[k.strip()] = v.strip()
    return params


def extract_infobox(wt):
    low = wt.lower(); i = low.find("{{infobox football biography")
    if i < 0:
        return None
    depth, j = 0, i
    while j < len(wt):
        if wt[j:j + 2] == "{{": depth += 1; j += 2; continue
        if wt[j:j + 2] == "}}":
            depth -= 1; j += 2
            if depth == 0:
                break
            continue
        j += 1
    return wt[i:j]


def strip_markup(v):
    """Remove wiki footnote/template markup BEFORE we read a field's content:
      * <ref ...>...</ref> and self-closing <ref .../>  (re.S — refs span lines)
      * {{...}} templates, NESTED, by brace balance (regex can't match nesting)
      * any remaining <tags>
    This stops junk like 'Sacrofano<ref>{{Cite web…}}</ref>' leaking into
    career_stats."""
    v = re.sub(r"<ref[^>]*?/>", "", v, flags=re.S)        # self-closing <ref .../>
    v = re.sub(r"<ref.*?</ref>", "", v, flags=re.S)       # paired <ref>...</ref>
    # nested {{...}} — scan and drop balanced template spans
    out, depth, i = [], 0, 0
    while i < len(v):
        two = v[i:i + 2]
        if two == "{{":
            depth += 1; i += 2; continue
        if two == "}}" and depth > 0:
            depth -= 1; i += 2; continue
        if depth == 0:
            out.append(v[i])
        i += 1
    v = "".join(out)
    v = re.sub(r"<[^>]*>", "", v)                          # any leftover <tags>
    return v


def clean_club(v):
    v = strip_markup(v)
    v = re.sub(r"→|\(loan\)|''", "", v).strip()
    m = re.search(r"\[\[([^\]]+)\]\]", v)
    if m:
        v = m.group(1).split("|")[-1]
    return re.sub(r"\s+", " ", v).strip()


def clean_years(v):
    """Годы карьеры: после strip_markup оставляем только начальный
    «годоподобный» фрагмент (цифры, тире, слэш). Инфобоксы иногда несут
    непарный <ref> с голым URL — strip_markup такое не выпиливает, и
    '2015–2026<ref>https://…' утекал в career_stats (аудит FATAL)."""
    v = strip_markup(v).strip()
    m = re.match(r"[0-9][0-9–—\-/ ]*", v)
    return m.group().strip() if m else ""


def first_int(v):
    v = strip_markup(v)
    m = re.search(r"-?\d+", v.replace(" ", "").replace(",", ""))
    return int(m.group()) if m else None


def parse_birth_year(ib):
    """Birth year from the infobox (birth_date / dateofbirth) — used to verify
    name-resolved articles are the SAME person (not a namesake)."""
    p = split_params(ib)
    bd = p.get("birth_date") or p.get("dateofbirth") or ""
    m = re.search(r"\b(1[89]\d\d|20\d\d)\b", bd)
    return int(m.group(1)) if m else None


def parse_senior(ib):
    p = split_params(ib)
    rows = []
    for n in range(1, 30):
        club = p.get("clubs%d" % n)
        if club is None:
            continue
        c = clean_club(club)
        if not c or c.lower() in ("loan", "→"):
            continue
        rows.append({"club": c, "years": clean_years(p.get("years%d" % n) or ""),
                     "apps": first_int(p.get("caps%d" % n, "")),
                     "goals": first_int(p.get("goals%d" % n, ""))})
    return [r for r in rows if r["apps"]]


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

    def wikitext(title, lang):
        nskey = lang + "_wikitext"
        cached = cache.get(nskey, title)
        if cached is not None:
            return cached.get("wt")
        budget.consume()
        time.sleep(0.4)
        try:
            r = requests.get("https://%s.wikipedia.org/w/api.php" % lang,
                             params={"action": "query", "prop": "revisions", "rvprop": "content",
                                     "rvslots": "main", "format": "json", "titles": title, "redirects": 1},
                             headers={"User-Agent": UA}, timeout=30)
            wt = None
            for _, pg in r.json().get("query", {}).get("pages", {}).items():
                rev = pg.get("revisions")
                if rev:
                    wt = rev[0]["slots"]["main"]["*"]
            cache.set(nskey, title, {"wt": wt})
            return wt
        except Exception:
            return None

    def enwiki_search(name):
        """Resolve a name to an enwiki title that is a footballer article."""
        cached = cache.get("enwiki_titlesearch", name)
        if cached is not None:
            return cached.get("title")
        budget.consume()
        time.sleep(0.4)
        title = None
        try:
            r = requests.get("https://en.wikipedia.org/w/api.php",
                             params={"action": "query", "list": "search",
                                     "srsearch": name + " footballer", "srlimit": 1,
                                     "format": "json"}, headers={"User-Agent": UA}, timeout=30)
            hits = r.json().get("query", {}).get("search", [])
            if hits:
                title = hits[0]["title"]
        except Exception:
            pass
        cache.set("enwiki_titlesearch", name, {"title": title})
        return title

    cards = fetch_all(url, key, "cards",
                      "id,name,name_en,category,clubs_minutes,legend_career,facts,career_stats")

    # Самопочинка: у уже записанных career_stats вычищаем вики-разметку,
    # утёкшую до появления clean_years (аудит валит весь workflow как FATAL).
    repaired = 0
    for c in cards:
        cs = c.get("career_stats")
        if not cs:
            continue
        blob = json.dumps(cs, ensure_ascii=False)
        if "<ref" not in blob and "{{" not in blob and "http" not in blob:
            continue
        for row in cs:
            row["club"] = clean_club(str(row.get("club") or ""))
            row["years"] = clean_years(str(row.get("years") or ""))
        requests.patch(url.rstrip("/") + "/rest/v1/cards",
                       headers=patch_h, params={"id": "eq." + c["id"]},
                       data=json.dumps({"career_stats": cs}), timeout=30)
        repaired += 1
    if repaired:
        print("career_stats sanitized on %d card(s)" % repaired, flush=True)

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

    def tmin(c):
        return sum((cm.get("minutes") or 0) for cm in (c.get("clubs_minutes") or []))

    def age(c):
        by = (c.get("facts") or {}).get("birth_year"); return (NOW - by) if by else None

    def known_veteran(c):
        if c.get("category") != "player":
            return False
        if c.get("legend_career"):
            return True
        if c.get("clubs_minutes"):
            a = age(c)
            return a is not None and a >= 33 and tmin(c) < 4500
        return False

    pool = [c for c in cards if known_veteran(c)]
    print("POOL (known veterans): %d  | APPLY=%s | gate>=%d apps"
          % (len(pool), APPLY, MIN_APPS), flush=True)

    def career_for(c):
        """Return (rows, lang, via) or ([], None, reason)."""
        titles = []
        q = qid_for(c)
        if q:
            sl = wd.titles_for_qid(q) or {}
            titles = [("en", sl.get("enwiki")), ("ru", sl.get("ruwiki"))]
            via = "qid"
        else:
            # Group B — no QID: resolve the name to an enwiki article.
            t = c.get("name_en") or c.get("name")
            cand = []
            if t:
                cand.append(t)
            srch = enwiki_search(c.get("name_en") or c.get("name") or "")
            if srch:
                cand.append(srch)
            titles = [("en", x) for x in cand]
            via = "name"
        for lang, title in titles:
            if not title:
                continue
            wt = wikitext(title, lang)
            if not wt:
                continue
            ib = extract_infobox(wt)
            if not ib:
                continue
            rows = parse_senior(ib)
            if rows:
                return rows, lang, via, parse_birth_year(ib)
        return [], None, via, None

    filled = via_qid = via_name = patched = skipped_existing = 0
    thin = name_rejected = 0
    examples = {}
    WANT = {"Оливье Жиру", "Тео Уолкотт"}
    for idx, c in enumerate(pool, 1):
        if c.get("career_stats"):
            skipped_existing += 1
            continue
        try:
            rows, lang, via, wiki_birth = career_for(c)
        except RuntimeError:
            print("BUDGET EXHAUSTED at %d/%d — stopping, progress cached." % (idx, len(pool)), flush=True)
            break
        total_apps = sum(r["apps"] or 0 for r in rows)
        if not rows or total_apps < MIN_APPS:
            thin += 1
            if idx % 100 == 0:
                print("  ...%d/%d filled=%d rejected=%d" % (idx, len(pool), filled, name_rejected), flush=True)
            continue
        # Name-resolved (no QID): verify SAME person via birth year — the Wiki
        # infobox birth must match facts.birth_year, else it's likely a namesake.
        if via == "name":
            card_birth = (c.get("facts") or {}).get("birth_year")
            if not (wiki_birth and card_birth and wiki_birth == card_birth):
                name_rejected += 1
                if idx % 100 == 0:
                    print("  ...%d/%d filled=%d rejected=%d" % (idx, len(pool), filled, name_rejected), flush=True)
                continue
        rows = sorted(rows, key=lambda r: -(r["apps"] or 0))[:TOP_CLUBS]
        career = [{"club": r["club"], "years": r["years"], "apps": r["apps"], "goals": r["goals"]} for r in rows]
        filled += 1
        via_qid += via == "qid"
        via_name += via == "name"
        if c.get("name") in WANT:
            examples[c["name"]] = (career, lang)
        if APPLY:
            rr = requests.patch(url.rstrip("/") + "/rest/v1/cards", headers=patch_h,
                                params={"id": "eq." + str(c["id"]), "career_stats": "is.null"},
                                json={"career_stats": career}, timeout=30)
            rr.raise_for_status()
            patched += 1
        if idx % 100 == 0:
            print("  ...%d/%d filled=%d" % (idx, len(pool), filled), flush=True)

    print("=" * 60)
    print("CAREER_STATS %s" % ("APPLY" if APPLY else "DRY-RUN"))
    print("  pool                    : %d" % len(pool))
    print("  already had stats       : %d" % skipped_existing)
    print("  WOULD fill (>=%d apps)   : %d" % (MIN_APPS, filled))
    print("    via QID (trusted)     : %d" % via_qid)
    print("    via name + birth-check: %d" % via_name)
    print("  name-resolved REJECTED  : %d  (birth mismatch / no year — namesake)" % name_rejected)
    print("  thin/no infobox         : %d" % thin)
    if APPLY:
        print("  PATCHed                 : %d" % patched)
    print("  budget used          : %d/%d" % (budget.used, budget.limit))
    for nm in ("Тео Уолкотт", "Оливье Жиру"):
        if nm in examples:
            career, lang = examples[nm]
            print("\n%s (%swiki):" % (nm, lang))
            for r in career:
                print("   %-24s %-10s · %s матчей, %s голов" % (r["club"][:24], r["years"], r["apps"], r["goals"]))
    print("=" * 60)


if __name__ == "__main__":
    main()
