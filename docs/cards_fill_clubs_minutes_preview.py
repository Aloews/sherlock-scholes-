"""READ-ONLY generator: cards.clubs_minutes (JSONB) backfill SQL.

Expands the single top_club/top_minutes into a small per-player club table —
ONLY from our legal local API-Football cache (football_scraper/cache/
api_football/*.json). No network to API-Football, no Transfermarkt/WhoScored.

Per player id in the cache: sum games.minutes per team.name across EVERY
cached season, drop teams with 0 minutes, sort by minutes desc, take the top
4. The club name is mapped to the deck's RUSSIAN club card name (token
match on name_en) like the top_club backfill; unmapped clubs keep the API
(Latin) name.

COVERAGE CAVEAT: the cache holds only the seasons we collected (2022-2024 of
the gathered leagues). This is NOT a full career — legends and players from
other leagues/years will be partial or single-club.

Writes docs/cards_fill_clubs_minutes.sql:
  ALTER TABLE cards ADD COLUMN clubs_minutes JSONB;  (run by the user)
  one guarded UPDATE per player whose cache has >= 1 club.
The UPDATE value is a JSON array [{"club": "...", "minutes": N}, ...].

Run:
    python docs/cards_fill_clubs_minutes_preview.py
"""
import io
import json
import os
import re
import sys
import collections

import requests
from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "football_scraper"))
from scraper.dedup import canonical_key  # noqa: E402

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

CACHE_DIR = os.path.join(
    os.path.dirname(__file__), "..", "football_scraper", "cache", "api_football")
OUT_SQL = os.path.join(os.path.dirname(__file__), "cards_fill_clubs_minutes.sql")
TOP_N = 4

CLUB_STOP_TOKENS = frozenset((
    "fc", "cf", "afc", "ac", "as", "ssc", "sc", "us", "cd", "rcd", "rc",
    "fk", "sk", "bk", "if", "club", "de", "futbol", "calcio",
))


def fetch_all(url, key, table, select, page_size=1000):
    endpoint = url.rstrip("/") + "/rest/v1/" + table
    headers = {"apikey": key, "Authorization": "Bearer " + key}
    rows, offset = [], 0
    while True:
        resp = requests.get(endpoint, headers=headers,
                            params={"select": select, "order": "id.asc",
                                    "limit": page_size, "offset": offset},
                            timeout=30)
        resp.raise_for_status()
        batch = resp.json()
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def club_tokens(name):
    return frozenset(t for t in re.findall(r"[a-z0-9]+", (name or "").lower())
                     if t not in CLUB_STOP_TOKENS)


def clubs_minutes_by_api_id():
    """player api id -> [(club_en, minutes), ...] top TOP_N by summed minutes
    across every cached season (minutes > 0)."""
    agg = collections.defaultdict(lambda: collections.Counter())
    for fname in os.listdir(CACHE_DIR):
        if not fname.endswith(".json"):
            continue
        with open(os.path.join(CACHE_DIR, fname), encoding="utf-8") as fh:
            data = json.load(fh)
        if data.get("get") != "players":
            continue
        for entry in data.get("response") or []:
            pid = (entry.get("player") or {}).get("id")
            if not pid:
                continue
            for stat in entry.get("statistics") or []:
                minutes = (stat.get("games") or {}).get("minutes") or 0
                team = ((stat.get("team") or {}).get("name") or "").strip()
                if team and minutes:
                    agg[pid][team] += int(minutes)
    out = {}
    for pid, counter in agg.items():
        ranked = [(club, m) for club, m in counter.most_common() if m > 0][:TOP_N]
        if ranked:
            out[pid] = ranked
    return out


def main():
    load_dotenv(os.path.join(
        os.path.dirname(__file__), "..", "football_scraper", ".env"))
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY not set (.env)")

    by_api = clubs_minutes_by_api_id()
    meta = fetch_all(url, key, "players_meta", "id,api_football_id,name_ru,name_en")
    cards = fetch_all(url, key, "cards", "id,name,name_en,category")
    players = [c for c in cards if c.get("category") == "player"]
    clubs = [c for c in cards if c.get("category") == "club"]

    AMBIG = object()

    def add_key(mapping, k, value):
        if not k:
            return
        cur = mapping.get(k)
        if cur is None:
            mapping[k] = value
        elif cur is not AMBIG and cur != value:
            mapping[k] = AMBIG

    # card -> api_football_id via meta name match.
    exact_ru, canon_ru, exact_en, canon_en = {}, {}, {}, {}
    for m in meta:
        api_id = m.get("api_football_id")
        if not api_id or api_id not in by_api:
            continue
        ru, en = (m.get("name_ru") or "").strip(), (m.get("name_en") or "").strip()
        add_key(exact_ru, ru, api_id)
        add_key(canon_ru, canonical_key(ru), api_id)
        add_key(exact_en, en.lower(), api_id)
        add_key(canon_en, canonical_key(en), api_id)

    # API club name -> unique Russian club card name (token subset).
    club_by_tokens = [(club_tokens(c.get("name_en")), (c.get("name") or "").strip())
                      for c in clubs if club_tokens(c.get("name_en"))]

    def ru_club(team_en):
        toks = club_tokens(team_en)
        if not toks:
            return team_en
        hits = {name for t, name in club_by_tokens if toks <= t or t <= toks}
        return hits.pop() if len(hits) == 1 else team_en

    def api_id_for(card):
        name = (card.get("name") or "").strip()
        en = (card.get("name_en") or "").strip()
        for mp, k in ((exact_ru, name), (canon_ru, canonical_key(name)),
                      (exact_en, en.lower()), (canon_en, canonical_key(en))):
            hit = mp.get(k) if k else None
            if hit is not None and hit is not AMBIG:
                return hit
        return None

    matched = []          # (card, [{"club","minutes"}, ...])
    multi = 0             # players with 2+ clubs
    for c in players:
        api_id = api_id_for(c)
        if not api_id:
            continue
        rows = [{"club": ru_club(club), "minutes": m} for club, m in by_api[api_id]]
        # merge clubs that map to the same Russian name (sum, re-sort, re-cap)
        merged = collections.Counter()
        for r in rows:
            merged[r["club"]] += r["minutes"]
        rows = [{"club": club, "minutes": m}
                for club, m in merged.most_common()[:TOP_N]]
        if rows:
            matched.append((c, rows))
            if len(rows) >= 2:
                multi += 1

    print("=" * 64)
    print("CARDS clubs_minutes BACKFILL — PREVIEW (read-only, local cache)")
    print("=" * 64)
    print("cache players with minutes : {}".format(len(by_api)))
    print("player cards total         : {}".format(len(players)))
    print("WILL FILL clubs_minutes    : {}".format(len(matched)))
    print("  из них с 2+ клубами      : {}".format(multi))
    print("  только 1 клуб            : {}".format(len(matched) - multi))
    print("ПОКРЫТИЕ: только наши сезоны (2022-2024 собранных лиг) — НЕ вся "
          "карьера; у легенд/иностранных лиг частично.")
    print("=" * 64)
    print("\n10 примеров с 2+ клубами:")
    shown = 0
    for c, rows in matched:
        if len(rows) >= 2 and shown < 10:
            shown += 1
            tbl = ", ".join("{} {}".format(r["club"], r["minutes"]) for r in rows)
            print("  {!r:28} -> {}".format(c["name"], tbl))

    def sql_quote(text):
        return "'" + (text or "").replace("'", "''") + "'"

    with open(OUT_SQL, "w", encoding="utf-8") as fh:
        fh.write(
            "-- ============================================================\n"
            "-- SHERLOCK SCHOLES — cards.clubs_minutes (JSONB)\n"
            "-- Per-player club table [{{club, minutes}}] (top 4 by summed\n"
            "-- minutes) from our LEGAL local API-Football cache only.\n"
            "-- Coverage = collected seasons (2022-2024) — NOT full careers.\n"
            "-- Generated by docs/cards_fill_clubs_minutes_preview.py.\n"
            "-- Run THIS FILE in the Supabase SQL Editor (or let the apply\n"
            "-- script PATCH the rows after the ALTER).\n"
            "-- {} players filled ({} with 2+ clubs).\n"
            "-- ============================================================\n\n"
            .format(len(matched), multi))
        fh.write("ALTER TABLE cards ADD COLUMN IF NOT EXISTS clubs_minutes JSONB;\n\n")
        fh.write("BEGIN;\n\n")
        for c, rows in matched:
            payload = json.dumps(rows, ensure_ascii=False)
            fh.write("UPDATE cards SET clubs_minutes = {}::jsonb "
                     "WHERE id = '{}' AND clubs_minutes IS NULL;  -- {}\n"
                     .format(sql_quote(payload), c["id"], c["name"]))
        fh.write("\nCOMMIT;\n\nNOTIFY pgrst, 'reload schema';\n")
    print("\nSQL written to: {}".format(OUT_SQL))


if __name__ == "__main__":
    main()
