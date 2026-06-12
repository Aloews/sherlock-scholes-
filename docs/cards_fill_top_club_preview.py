"""READ-ONLY generator: cards.top_club / cards.top_minutes backfill SQL.

The summary history wants "club + minutes" under a player's name. Neither
players_meta nor player_seasons stores team/minutes — but the LOCAL
API-Football cache (football_scraper/cache/api_football/*.json, the raw
get=players responses) carries per-season statistics: team.name and
games.minutes. No network calls to API-Football are made here.

This script (mirrors docs/cards_fill_photo_url_preview.py):
  1. Walks the local api_football cache: for every player id collects all
     (minutes, team) season rows and keeps the row with MAXIMUM minutes.
  2. GETs players_meta (api_football_id -> name_ru/name_en) and cards.
  3. Matches player cards to meta by exact name_ru, canonical_key(name_ru),
     exact name_en, canonical_key(name_en) — first hit wins; keys pointing
     at several different players are AMBIGUOUS and skipped.
  4. The API team name is English ("Zenit"); the deck's club cards now have
     name_en, so a unique token-subset match maps it to the RUSSIAN club
     card name ("Зенит") for display. No unique match -> the API name
     is kept as-is.
  5. Writes docs/cards_fill_top_club.sql: ALTER TABLE (idempotent) + one
     guarded UPDATE per matched card. NOTHING is executed against the DB —
     the user runs the file in the Supabase SQL Editor.

Run:
    python docs/cards_fill_top_club_preview.py
"""
import io
import json
import os
import re
import sys

import requests
from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "football_scraper"))
from scraper.dedup import canonical_key  # noqa: E402

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

CACHE_DIR = os.path.join(
    os.path.dirname(__file__), "..", "football_scraper", "cache", "api_football")
OUT_SQL = os.path.join(os.path.dirname(__file__), "cards_fill_top_club.sql")

# Generic club-name tokens ignored when matching the API team name against a
# club card's name_en ("FC Bayern Munich" vs "Bayern Munich").
CLUB_STOP_TOKENS = frozenset((
    "fc", "cf", "afc", "ac", "as", "ssc", "sc", "us", "cd", "rcd", "rc",
    "fk", "sk", "bk", "if", "club", "de", "futbol", "calcio",
))


def fetch_all(url, key, table, select, params=None, page_size=1000):
    endpoint = url.rstrip("/") + "/rest/v1/" + table
    headers = {"apikey": key, "Authorization": "Bearer " + key}
    rows, offset = [], 0
    while True:
        q = {"select": select, "order": "id.asc",
             "limit": page_size, "offset": offset}
        q.update(params or {})
        resp = requests.get(endpoint, headers=headers, params=q, timeout=30)
        resp.raise_for_status()
        batch = resp.json()
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def sql_quote(text):
    return "'" + (text or "").replace("'", "''") + "'"


AMBIGUOUS = object()


def add_key(mapping, k, value):
    if not k:
        return
    existing = mapping.get(k)
    if existing is None:
        mapping[k] = value
    elif existing is not AMBIGUOUS and existing != value:
        mapping[k] = AMBIGUOUS


def club_tokens(name):
    tokens = re.findall(r"[a-z0-9]+", (name or "").lower())
    return frozenset(t for t in tokens if t not in CLUB_STOP_TOKENS)


def best_season_rows():
    """player api id -> {"minutes", "team", "season", "league"} with the
    season-row of MAXIMUM minutes across every cached get=players response."""
    best = {}
    files = [f for f in os.listdir(CACHE_DIR) if f.endswith(".json")]
    for fname in files:
        with open(os.path.join(CACHE_DIR, fname), encoding="utf-8") as fh:
            data = json.load(fh)
        if data.get("get") != "players":
            continue
        for entry in data.get("response") or []:
            pid = ((entry.get("player") or {}).get("id"))
            if not pid:
                continue
            for stat in entry.get("statistics") or []:
                minutes = ((stat.get("games") or {}).get("minutes"))
                team = ((stat.get("team") or {}).get("name") or "").strip()
                if not minutes or not team:
                    continue
                season = ((stat.get("league") or {}).get("season"))
                cur = best.get(pid)
                if cur is None or minutes > cur["minutes"]:
                    best[pid] = {
                        "minutes": int(minutes), "team": team,
                        "season": season,
                        "league": ((stat.get("league") or {}).get("name")),
                    }
    return best, len(files)


def main():
    load_dotenv(os.path.join(
        os.path.dirname(__file__), "..", "football_scraper", ".env"))
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY not set (.env)")

    best, n_files = best_season_rows()

    meta = fetch_all(url, key, "players_meta",
                     "id,api_football_id,name_ru,name_en")
    cards = fetch_all(url, key, "cards", "id,name,name_en,category")
    players = [c for c in cards if c.get("category") == "player"]
    clubs = [c for c in cards if c.get("category") == "club"]

    # players_meta -> the player's best season stats (via api_football_id).
    stats_by_meta = {}
    for m in meta:
        api_id = m.get("api_football_id")
        if api_id and api_id in best:
            stats_by_meta[m["id"]] = best[api_id]

    # Card-name lookups into meta (same scheme as the photo backfill):
    # exact/canonical over name_ru AND name_en; ambiguous keys are skipped.
    exact_ru, canon_ru, exact_en, canon_en = {}, {}, {}, {}
    for m in meta:
        if m["id"] not in stats_by_meta:
            continue
        ru, en = (m.get("name_ru") or "").strip(), (m.get("name_en") or "").strip()
        add_key(exact_ru, ru, m["id"])
        add_key(canon_ru, canonical_key(ru), m["id"])
        add_key(exact_en, en.lower(), m["id"])
        add_key(canon_en, canonical_key(en), m["id"])

    # API team name (en) -> unique RUSSIAN club card name, by token subset.
    club_by_tokens = []
    for c in clubs:
        tokens = club_tokens(c.get("name_en"))
        if tokens:
            club_by_tokens.append((tokens, (c.get("name") or "").strip()))

    def ru_club(team_en):
        api_tokens = club_tokens(team_en)
        if not api_tokens:
            return None
        hits = {name for tokens, name in club_by_tokens
                if api_tokens <= tokens or tokens <= api_tokens}
        return hits.pop() if len(hits) == 1 else None

    matched, ambiguous, unmatched = [], [], []
    ru_named = 0
    for c in players:
        name = (c.get("name") or "").strip()
        name_en = (c.get("name_en") or "").strip()
        hit = exact_ru.get(name)
        if hit is None:
            hit = canon_ru.get(canonical_key(name))
        if hit is None and name_en:
            hit = exact_en.get(name_en.lower())
        if hit is None and name_en:
            hit = canon_en.get(canonical_key(name_en))
        if hit is AMBIGUOUS:
            ambiguous.append(c)
            continue
        if hit is None:
            unmatched.append(c)
            continue
        stat = stats_by_meta[hit]
        club = ru_club(stat["team"])
        if club:
            ru_named += 1
        else:
            club = stat["team"]
        matched.append((c, club, stat))

    print("=" * 64)
    print("CARDS top_club/top_minutes BACKFILL — PREVIEW (read-only)")
    print("=" * 64)
    print("api_football cache files : {} (players with minutes: {})".format(
        n_files, len(best)))
    print("players_meta rows        : {} (with cached stats: {})".format(
        len(meta), len(stats_by_meta)))
    print("player cards total       : {}".format(len(players)))
    print("-" * 64)
    print("WILL FILL (UPDATE)       : {}".format(len(matched)))
    print("  клуб по-русски (из колоды): {}".format(ru_named))
    print("  клуб как в API (латиница): {}".format(len(matched) - ru_named))
    print("AMBIGUOUS (skipped)      : {}".format(len(ambiguous)))
    print("NO MATCH (stay NULL)     : {} (легенды без меты и т.п.)".format(
        len(unmatched)))
    print("=" * 64)
    print("\n10 examples:")
    for c, club, stat in matched[:10]:
        print("  {!r:32} -> {} · {} мин (сезон {}, {})".format(
            c["name"], club, stat["minutes"], stat["season"], stat["league"]))

    with open(OUT_SQL, "w", encoding="utf-8") as fh:
        fh.write(
            "-- ============================================================\n"
            "-- SHERLOCK SCHOLES — cards.top_club / top_minutes\n"
            "-- Club + minutes of the player's best season (max minutes\n"
            "-- across the seasons cached from API-Football), shown in the\n"
            "-- quick-game summary history. Generated by\n"
            "-- docs/cards_fill_top_club_preview.py — run THIS FILE in the\n"
            "-- Supabase SQL Editor.\n"
            "-- pick_random_cards() needs no change: RETURNS SETOF cards\n"
            "-- picks the new columns up automatically.\n"
            "-- {} UPDATE; {} ambiguous skipped; {} cards stay NULL.\n"
            "-- ============================================================\n\n"
            .format(len(matched), len(ambiguous), len(unmatched)))
        fh.write("ALTER TABLE cards ADD COLUMN IF NOT EXISTS top_club TEXT;\n")
        fh.write("ALTER TABLE cards ADD COLUMN IF NOT EXISTS top_minutes INT;\n\n")
        fh.write("BEGIN;\n\n")
        for c, club, stat in matched:
            fh.write("UPDATE cards SET top_club = {}, top_minutes = {} "
                     "WHERE id = '{}' AND top_club IS NULL;  -- {}\n"
                     .format(sql_quote(club), stat["minutes"], c["id"],
                             c["name"]))
        fh.write("\nCOMMIT;\n")
        if ambiguous:
            fh.write("\n-- AMBIGUOUS (skipped):\n")
            for c in ambiguous:
                fh.write("-- id {}  name {}\n".format(c["id"], c["name"]))
        fh.write("\nNOTIFY pgrst, 'reload schema';\n")
    print("\nSQL written to: {}".format(OUT_SQL))


if __name__ == "__main__":
    main()
