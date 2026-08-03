# -*- coding: utf-8 -*-
"""Build real trophies for player cards from the ru-Wikipedia «Достижения»
section — WITH counts, so a card can say «Чемпион Испании ×9».

WHY THIS EXISTS. The dossier's "Трофеи" list was `facts.titles` +
`facts.tournaments` concatenated, and only **39 of 2524** active players have
any `facts.titles` at all. So for 98.5 % of the deck the trophy list was made
of tournaments a player merely APPEARED at — the app was crediting real
footballers with honours they never won. Splitting the two (shared/lib/
honours.ts) made the list honest but empty; this fills it for real.

WHY WIKIPEDIA AND NOT A STATS API. It is the source the rest of this pipeline
already uses: free, open-licence, no request budget to buy, no ToS grey area,
and it carries the one thing paid football APIs charge most for — a curated,
human-checked honours list per player. One request per player (~2500 total)
fits the existing nightly Wikimedia budget of 5000.

WHAT IT PARSES. ru-wiki wikitext, section «== Достижения ==», its «Командные»
and «Личные» subsections. Lines look like

    * [[Чемпионат Испании по футболу|Чемпион Испании]] ('''9'''): [[…|2004/05]], …

so the title, the count (bold or plain parens) and the kind all come out. Wiki
markup, templates, refs and HTML are stripped; a parenthetical that is not a
number — «Чемпион MLS (обладатель Кубка MLS)» — is left alone.

RESOLUTION. cards.name is passed straight to the API with redirects=1: ru-wiki
redirects «Садио Мане» to «Мане, Садио», so no separate title lookup is
needed. Verified on Mané, Ronaldo, Lunin, Seaman.

OUTPUT. Dry run by default: prints per-player counts and writes
docs/cards_honours.sql, which is NOT executed. Nothing is written to the
database from here — apply the SQL after reading it, the same way
dups_exact.sql works.

    python docs/cards_honours_build.py --limit 20      # dry run, 20 players
    python docs/cards_honours_build.py --limit 0       # whole deck

Needs SUPABASE_URL + SUPABASE_KEY (anon is enough — it only reads).
"""
import argparse
import io
import json
import os
import re
import sys
import time
import urllib.parse

import requests
from dotenv import load_dotenv

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
SCRAPER = os.path.join(os.path.dirname(HERE), "football_scraper")
OUT_SQL = os.path.join(HERE, "cards_honours.sql")

# Wikimedia asks for a real contact in the User-Agent and throttles anonymous
# scrapers hard without one. See players-db-methodology.md §6.
UA = "SherlockScholesBot/1.0 (giafreec@gmail.com)"
API = "https://ru.wikipedia.org/w/api.php"
PAUSE_S = 0.4          # polite: well under the 1 req/s ceiling for bursts

LINK = re.compile(r"\[\[(?:[^\]|]*\|)?([^\]|]+)\]\]")
COUNT = re.compile(r"\(\s*'{0,3}(\d+)'{0,3}\s*\)")


def strip_markup(s: str) -> str:
    s = LINK.sub(r"\1", s)
    s = re.sub(r"\{\{[^{}]*\}\}", "", s)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.S)
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("'''", "").replace("''", "")
    s = re.sub(r"\s+", " ", s)
    return s.strip(" .;:—–-*")


def fetch_wikitext(title: str, session: requests.Session) -> str | None:
    r = session.get(API, params={
        "action": "parse", "page": title, "prop": "wikitext",
        "format": "json", "formatversion": "2", "redirects": "1",
    }, timeout=30)
    if r.status_code != 200:
        return None
    return r.json().get("parse", {}).get("wikitext")


# ru-wiki does not use one heading for this. Real examples from the deck:
# «Достижения» (Iniesta), «Титулы» (Pelé), «Награды и достижения» (Beckham),
# and Zidane has TWO — «Достижения в качестве игрока» and «…в качестве
# тренера» — so every matching section is read, not just the first.
HONOUR_HEADING = re.compile(r"^==\s*([^=]*(?:достижени|титул|награ)[^=]*?)\s*==\s*$",
                            re.M | re.I)


def _sections(wikitext: str) -> list[str]:
    bodies = []
    for head in HONOUR_HEADING.finditer(wikitext):
        rest = wikitext[head.end():]
        nxt = re.search(r"^==[^=]", rest, re.M)
        bodies.append(rest[:nxt.start()] if nxt else rest)
    return bodies


def parse_honours(wikitext: str) -> list[dict]:
    """[{title, count, kind}] from every honours-shaped section, in order."""
    out, kind = [], None
    for line in "\n".join(_sections(wikitext)).splitlines():
        sub = re.match(r"^===\s*([^=]+?)\s*===", line)
        if sub:
            k = sub.group(1).lower()
            kind = "team" if "командн" in k else ("personal" if "личн" in k else kind)
            continue
        if not line.lstrip().startswith("*"):
            continue
        item = line.lstrip("* ").strip()
        if not item:
            continue

        count, m = 1, COUNT.search(item)
        if m:
            count = int(m.group(1))
            item = item[:m.start()] + item[m.end():]

        # Everything before the first colon is the honour; after it are years.
        title = strip_markup(item.split(":", 1)[0])
        if len(title) < 3:
            continue
        out.append({"title": title, "count": count, "kind": kind or "team"})

    # Two honour sections can repeat an entry (player vs manager lists);
    # keep the higher count rather than showing the same trophy twice.
    merged: dict[tuple, dict] = {}
    for h in out:
        k = (h["title"], h["kind"])
        if k not in merged or h["count"] > merged[k]["count"]:
            merged[k] = h
    return list(merged.values())


def fetch_cards(url: str, key: str, limit: int) -> list[dict]:
    endpoint = url.rstrip("/") + "/rest/v1/cards"
    headers = {"apikey": key, "Authorization": "Bearer " + key}
    rows, offset, page = [], 0, 1000
    while True:
        r = requests.get(endpoint, headers=headers, params={
            "select": "id,name,fame,facts", "category": "eq.player",
            "active": "eq.true", "order": "fame.desc.nullslast",
            "limit": page, "offset": offset,
        }, timeout=60)
        r.raise_for_status()
        batch = r.json()
        rows.extend(batch)
        if len(batch) < page or (limit and len(rows) >= limit):
            break
        offset += page
    return rows[:limit] if limit else rows


def sql_quote(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=20, help="players to process (0 = all)")
    args = ap.parse_args()

    load_dotenv(os.path.join(SCRAPER, ".env"))
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY not set (.env)")

    cards = fetch_cards(url, key, args.limit)
    session = requests.Session()
    session.headers["User-Agent"] = UA

    lines = [
        "-- Real trophies parsed from ru-Wikipedia «Достижения»",
        "-- (docs/cards_honours_build.py). NOT EXECUTED — read it first.",
        "--",
        "-- Only 39 of 2524 active players had any facts.titles, so the dossier's",
        "-- trophy list was almost entirely tournament APPEARANCES. This fills the",
        "-- real thing, with counts.",
        "",
    ]
    found = missing = 0
    total_honours = 0

    for i, c in enumerate(cards, 1):
        wt = fetch_wikitext(c["name"], session)
        time.sleep(PAUSE_S)
        honours = parse_honours(wt) if wt else []
        if not honours:
            missing += 1
            print(f"  {i:4}/{len(cards)}  {c['name'][:34]:34}  —")
            continue
        found += 1
        total_honours += len(honours)
        team = [h for h in honours if h["kind"] == "team"]
        top = sorted(team, key=lambda h: -h["count"])[:3]
        print(f"  {i:4}/{len(cards)}  {c['name'][:34]:34}  {len(honours):3} "
              + ", ".join(f"{h['title']}×{h['count']}" for h in top))
        lines.append(
            f"UPDATE cards SET facts = coalesce(facts, '{{}}'::jsonb) || "
            f"jsonb_build_object('honours', {sql_quote(json.dumps(honours, ensure_ascii=False))}::jsonb) "
            f"WHERE id = '{c['id']}';  -- {c['name']}")

    with open(OUT_SQL, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")

    print("\n" + "=" * 64)
    print(f"players processed     : {len(cards)}")
    print(f"  with honours        : {found}")
    print(f"  none found          : {missing}")
    print(f"  honours total       : {total_honours}")
    if found:
        print(f"  average per player  : {total_honours / found:.1f}")
    print(f"\nSQL written to {OUT_SQL} (NOT executed).")


if __name__ == "__main__":
    main()
