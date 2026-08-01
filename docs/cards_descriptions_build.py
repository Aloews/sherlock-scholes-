"""Build cards.descriptions (JSONB {ru,en}) for the non-player categories.

The end-of-game history renders a short blurb under the card name for any
card that has `descriptions` (see the summary list in TrainingScreen.tsx).
Terms and positions were filled by hand long ago; every other non-player
category — referees, commentators, stadiums, club nicknames, derbies, eras,
trophies, and the clubs/coaches themselves — has none, so those cards show
a bare name.

Source: the Wikipedia REST summary endpoint, whose `extract` opens with a
definition sentence in a very predictable shape:

    "Реал Мадрид — испанский футбольный клуб из Мадрида, основанный в 1902…"
    "Real Madrid CF is a Spanish professional football club based in Madrid."

The card already shows the name, so repeating it wastes the line. Stripping
the "NAME —" / "NAME is" lead-in turns that sentence into exactly the short
definition phrase the existing rows use:

    "Испанский футбольный клуб из Мадрида, основан в 1902"

HOUSE STYLE, measured off the 102 rows already in the table: 10-64 chars,
32 on average, and NOT ONE ends in a period. normalize() enforces that —
first sentence only, lead-in stripped, no trailing period, capped at
MAX_LEN on a word boundary.

Complements docs/cards_club_coach_titles_build.py, which fills
facts.titles (the gold 🏆 line) for clubs and coaches. The two are
independent: this one writes `descriptions`, that one writes `facts`.

OUTPUT — DRY-RUN by default: fetches, computes, prints coverage and a
sample, writes NOTHING. Then either:
    SQL_OUT=docs/cards_descriptions.sql   emit a reviewable migration
    APPLY=1                               PATCH cards.descriptions directly
    LIMIT=10                              smoke-test over the first N cards
    CATEGORIES=stadium,derby              restrict to certain categories

Idempotent: a card is only touched when its description actually changes,
and cards that already have one are skipped unless FORCE=1.

SETUP + RUN — identical to cards_club_coach_titles_build.py; both read
football_scraper/.env for SUPABASE_URL / SUPABASE_KEY and share the cache.

    cd football_scraper
    python ../docs/cards_descriptions_build.py                 # dry-run
    SQL_OUT=../docs/cards_descriptions.sql \
        python ../docs/cards_descriptions_build.py             # migration

Needs outbound access to ru.wikipedia.org / en.wikipedia.org. Calls are
paced and cached, so a dry run followed by a real run costs one pass.
"""
import os
import sys
import re
import json
import time
from urllib.parse import quote

import requests
from dotenv import load_dotenv

HERE = os.path.dirname(os.path.abspath(__file__))
SCRAPER = os.path.join(HERE, "..", "football_scraper")
sys.path.insert(0, SCRAPER)
from scraper.cache import FileCache  # noqa: E402

APPLY = os.environ.get("APPLY") == "1"
SQL_OUT = os.environ.get("SQL_OUT")
FORCE = os.environ.get("FORCE") == "1"
LIMIT = int(os.environ.get("LIMIT") or 0)

UA = ("SherlockScholesBot/0.1 (card descriptions; "
      "contact: giafreec@gmail.com)")
PAUSE = 0.4          # Wikipedia REST is generous, but stay polite
MAX_LEN = 120        # existing rows top out at 64; allow some headroom
REST = "https://{lang}.wikipedia.org/api/rest_v1/page/summary/{title}"

# Every non-player category. term/position already have descriptions and are
# skipped by the has-one check unless FORCE=1.
DEFAULT_CATEGORIES = [
    "club", "coach", "referee", "commentator", "stadium",
    "club_nickname", "derby", "era", "trophy",
]
CATEGORIES = [c.strip() for c in (os.environ.get("CATEGORIES") or "").split(",") if c.strip()] \
    or DEFAULT_CATEGORIES

# "Реал Мадрид — испанский клуб…" / "Реал Мадрид (исп. …) — испанский клуб…"
RU_LEAD = re.compile(r"^.{0,80}?\s+[—–-]\s+", re.S)
# "Real Madrid CF is a Spanish club…" / "… was an English referee…"
EN_LEAD = re.compile(r"^.{0,80}?\s+(?:is|was|are|were)\s+", re.S | re.I)
# Wikipedia footnote/pronunciation parentheticals bloat the first sentence.
PARENS = re.compile(r"\s*\([^)]{0,120}\)")


def http_json(url, headers=None, timeout=30):
    h = {"User-Agent": UA, "Accept": "application/json"}
    h.update(headers or {})
    for attempt in range(1, 4):
        time.sleep(PAUSE)
        try:
            r = requests.get(url, headers=h, timeout=timeout)
            if r.status_code == 404:
                return {}
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(min(2 ** attempt, 20))
                continue
            r.raise_for_status()
            return r.json()
        except requests.RequestException:
            if attempt == 3:
                return {}
            time.sleep(min(2 ** attempt, 20))
    return {}


def first_sentence(text):
    """First sentence, without breaking on the dots inside 'т. д.' / 'C.F.'."""
    t = " ".join((text or "").split())
    if not t:
        return ""
    # A sentence ends at . ! ? followed by a space + capital / end of string.
    m = re.search(r"(?<=[.!?])\s+(?=[A-ZА-ЯЁ])", t)
    return (t[:m.start()] if m else t).strip()


def normalize(extract, lang):
    """Wikipedia's opening sentence -> a short house-style definition phrase.

    Returns None when nothing usable is left (too short, or the lead-in ate
    the whole thing) so the caller can skip the card rather than write junk.
    """
    s = first_sentence(PARENS.sub("", extract or ""))
    if not s:
        return None
    lead = RU_LEAD if lang == "ru" else EN_LEAD
    stripped = lead.sub("", s, count=1)
    # If the pattern matched nothing the sentence keeps its subject — still
    # usable, just longer. If it ate everything, fall back to the sentence.
    s = stripped if len(stripped) >= 12 else s
    s = s.rstrip(" .!?").strip()
    if len(s) < 10:
        return None
    if len(s) > MAX_LEN:
        cut = s[:MAX_LEN].rsplit(" ", 1)[0].rstrip(" ,;:—–-")
        s = cut + "…"
    return s[0].upper() + s[1:]


def summary_extract(cache, lang, title):
    """Wikipedia summary `extract` for an article title, cached (misses too)."""
    ck = f"{lang}|{title}"
    hit = cache.get("wiki_summary", ck)
    if hit is not None:
        return hit.get("extract")
    url = REST.format(lang=lang, title=quote(title.replace(" ", "_"), safe=""))
    data = http_json(url)
    # Disambiguation pages define nothing — treat them as a miss.
    extract = None if data.get("type") == "disambiguation" else data.get("extract")
    cache.set("wiki_summary", ck, {"extract": extract})
    return extract


def fetch_all(url, key, table, sel, extra=None):
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


def main():
    load_dotenv(os.path.join(SCRAPER, ".env"))
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not url or not key:
        sys.exit("SUPABASE_URL / SUPABASE_KEY missing — see the docstring.")
    cache = FileCache(os.path.join(SCRAPER, "cache"), True)

    # Fail early rather than writing 631 empty results.
    if not summary_extract(cache, "ru", "Реал Мадрид"):
        sys.exit("Cannot reach ru.wikipedia.org — check the network before running.")

    cards = fetch_all(url, key, "cards", "id,name,name_en,category,descriptions",
                      {"category": f"in.({','.join(CATEGORIES)})", "active": "eq.true"})
    todo = [c for c in cards if FORCE or not c.get("descriptions")]
    if LIMIT:
        todo = todo[:LIMIT]
    print(f"{len(cards)} cards in {len(CATEGORIES)} categories, "
          f"{len(todo)} without a description{' (LIMIT)' if LIMIT else ''}")

    changed, missed = [], []
    for i, c in enumerate(todo, 1):
        desc = {}
        ru = normalize(summary_extract(cache, "ru", c["name"]), "ru")
        if ru:
            desc["ru"] = ru
        if c.get("name_en"):
            en = normalize(summary_extract(cache, "en", c["name_en"]), "en")
            if en:
                desc["en"] = en
        if not desc:
            missed.append(c["name"])
        elif desc != (c.get("descriptions") or {}):
            changed.append((c, desc))
        if i % 25 == 0:
            print(f"  {i}/{len(todo)}")

    by_cat = {}
    for c, _ in changed:
        by_cat[c["category"]] = by_cat.get(c["category"], 0) + 1
    print(f"\nresolved {len(changed)}/{len(todo)}  ({len(missed)} with no usable article)")
    for cat, n in sorted(by_cat.items(), key=lambda kv: -kv[1]):
        print(f"  {cat:<15} {n}")
    print("\nsample:")
    for c, d in changed[:12]:
        print(f"  {c['name'][:26]:<26} {d.get('ru', '')}")
    if missed:
        print(f"\nno article ({len(missed)}): {', '.join(missed[:20])}"
              + (" …" if len(missed) > 20 else ""))

    if SQL_OUT:
        path = SQL_OUT if os.path.isabs(SQL_OUT) else os.path.join(os.getcwd(), SQL_OUT)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(
                "-- cards.descriptions for the non-player categories.\n"
                "-- Generated by docs/cards_descriptions_build.py — do not\n"
                "-- hand-edit; adjust normalize() and re-run.\n"
                "-- Source: Wikipedia REST summary, opening sentence with the\n"
                "-- 'NAME —' lead-in stripped to match the existing rows.\n\n"
                "begin;\n\n"
            )
            for c, d in changed:
                payload = json.dumps(d, ensure_ascii=False).replace("'", "''")
                fh.write(
                    f"-- {c['name']} ({c['category']})\n"
                    f"update cards set descriptions = '{payload}'::jsonb "
                    f"where id = '{c['id']}';\n"
                )
            fh.write("\ncommit;\n")
        print(f"\nwrote {path} ({len(changed)} statements) — review, then apply")

    if APPLY:
        patch_h = {"apikey": key, "Authorization": "Bearer " + key,
                   "Content-Type": "application/json", "Prefer": "return=minimal"}
        for c, d in changed:
            r = requests.patch(url.rstrip("/") + "/rest/v1/cards", headers=patch_h,
                               params={"id": "eq." + c["id"]},
                               json={"descriptions": d}, timeout=30)
            r.raise_for_status()
        print(f"PATCHed {len(changed)} cards")
    elif not SQL_OUT:
        print("\nDRY-RUN (no writes) — set SQL_OUT=... or APPLY=1")


if __name__ == "__main__":
    main()
