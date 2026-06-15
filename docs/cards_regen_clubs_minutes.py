"""Regenerate cards.clubs_minutes EXCLUDING friendly matches.

The first fill summed games.minutes across ALL competitions, so pre-season
friendlies inflated the totals (e.g. a club where a player only played
friendlies showed up with real-looking minutes). This recomputes from the
SAME local API-Football cache but skips friendly leagues, then OVERWRITES the
stored value for every currently-filled player card:
  * still has >=1 competitive club -> new [{club, minutes}] array;
  * no competitive minutes left    -> clubs_minutes set back to NULL.

No API budget (local cache + Supabase REST). Dry-run by default; pass --apply
to write. Idempotent: re-running --apply yields the same result.
"""
import io
import os
import re
import sys
import json
import collections

import requests
from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "football_scraper"))
from scraper.dedup import canonical_key  # noqa: E402
from scraper.history import is_friendly_league  # noqa: E402

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

CACHE_DIR = os.path.join(
    os.path.dirname(__file__), "..", "football_scraper", "cache", "api_football")
TOP_N = 4
CLUB_STOP_TOKENS = frozenset((
    "fc", "cf", "afc", "ac", "as", "ssc", "sc", "us", "cd", "rcd", "rc",
    "fk", "sk", "bk", "if", "club", "de", "futbol", "calcio",
))


def fetch_all(url, key, table, select):
    endpoint = url.rstrip("/") + "/rest/v1/" + table
    headers = {"apikey": key, "Authorization": "Bearer " + key}
    rows, off = [], 0
    while True:
        r = requests.get(endpoint, headers=headers,
                         params={"select": select, "order": "id.asc",
                                 "limit": 1000, "offset": off}, timeout=30)
        r.raise_for_status()
        b = r.json()
        rows += b
        if len(b) < 1000:
            break
        off += 1000
    return rows


def club_tokens(name):
    return frozenset(t for t in re.findall(r"[a-z0-9]+", (name or "").lower())
                     if t not in CLUB_STOP_TOKENS)


def clubs_minutes_by_api_id():
    """api id -> [(club_en, minutes), ...] top-N by summed COMPETITIVE minutes
    (friendlies excluded)."""
    agg = collections.defaultdict(collections.Counter)
    for fname in os.listdir(CACHE_DIR):
        if not fname.endswith(".json"):
            continue
        data = json.load(open(os.path.join(CACHE_DIR, fname), encoding="utf-8"))
        if data.get("get") != "players":
            continue
        for entry in data.get("response") or []:
            pid = (entry.get("player") or {}).get("id")
            if not pid:
                continue
            for st in entry.get("statistics") or []:
                if is_friendly_league((st.get("league") or {}).get("name")):
                    continue
                mins = (st.get("games") or {}).get("minutes") or 0
                team = ((st.get("team") or {}).get("name") or "").strip()
                if team and mins:
                    agg[pid][team] += int(mins)
    out = {}
    for pid, c in agg.items():
        ranked = [(club, m) for club, m in c.most_common() if m > 0][:TOP_N]
        if ranked:
            out[pid] = ranked
    return out


def main():
    apply = "--apply" in sys.argv
    load_dotenv(os.path.join(
        os.path.dirname(__file__), "..", "football_scraper", ".env"))
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY not set")

    by_api = clubs_minutes_by_api_id()
    meta = fetch_all(url, key, "players_meta", "api_football_id,name_ru,name_en")
    cards = fetch_all(url, key, "cards", "id,name,name_en,category,clubs_minutes")
    players = [c for c in cards if c.get("category") == "player"]
    clubs = [c for c in cards if c.get("category") == "club"]

    AMBIG = object()

    def add_key(m, k, v):
        if not k:
            return
        cur = m.get(k)
        m[k] = v if cur is None else (AMBIG if (cur is not AMBIG and cur != v) else cur)

    eru, cru, een, cen = {}, {}, {}, {}
    for m in meta:
        api = m.get("api_football_id")
        if not api or api not in by_api:
            continue
        ru, en = (m.get("name_ru") or "").strip(), (m.get("name_en") or "").strip()
        add_key(eru, ru, api); add_key(cru, canonical_key(ru), api)
        add_key(een, en.lower(), api); add_key(cen, canonical_key(en), api)

    club_by_tokens = [(club_tokens(c.get("name_en")), (c.get("name") or "").strip())
                      for c in clubs if club_tokens(c.get("name_en"))]

    def ru_club(team_en):
        toks = club_tokens(team_en)
        if not toks:
            return team_en
        hits = {n for t, n in club_by_tokens if toks <= t or t <= toks}
        return hits.pop() if len(hits) == 1 else team_en

    def api_for(card):
        nm, en = (card.get("name") or "").strip(), (card.get("name_en") or "").strip()
        for mp, k in ((eru, nm), (cru, canonical_key(nm)),
                      (een, en.lower()), (cen, canonical_key(en))):
            hit = mp.get(k) if k else None
            if hit is not None and hit is not AMBIG:
                return hit
        return None

    updated = nulled = unchanged = multi = 0
    endpoint = url.rstrip("/") + "/rest/v1/cards"
    wh = {"apikey": key, "Authorization": "Bearer " + key,
          "Content-Type": "application/json", "Prefer": "return=minimal"}

    examples = []
    for c in players:
        had = c.get("clubs_minutes")
        api = api_for(c)
        new = None
        if api and api in by_api:
            merged = collections.Counter()
            for club, m in by_api[api]:
                merged[ru_club(club)] += m
            new = [{"club": club, "minutes": m}
                   for club, m in merged.most_common()[:TOP_N]]
            if len(new) >= 2:
                multi += 1
        # Decide change relative to current stored value.
        if new and had == new:
            unchanged += 1
            continue
        if not new and had is None:
            continue
        if new:
            updated += 1
            if len(examples) < 8 and had != new:
                examples.append((c["name"], had, new))
        else:
            nulled += 1
        if apply:
            requests.patch(endpoint, headers=wh,
                           params={"id": "eq." + c["id"]},
                           json={"clubs_minutes": new}, timeout=30
                           ).raise_for_status()

    print("=" * 64)
    print("REGEN clubs_minutes (без Friendlies) — {}".format(
        "APPLIED" if apply else "DRY RUN (--apply чтобы записать)"))
    print("=" * 64)
    print("  изменено (перезапись): {}".format(updated))
    print("    из них с 2+ клубами: {}".format(multi))
    print("  обнулено (были только товарищеские): {}".format(nulled))
    print("  без изменений        : {}".format(unchanged))
    print("=" * 64)
    print("Примеры изменений (старое -> новое):")
    for name, had, new in examples:
        h = ", ".join("{} {}".format(x["club"], x["minutes"]) for x in (had or [])) or "—"
        n = ", ".join("{} {}".format(x["club"], x["minutes"]) for x in (new or [])) or "—"
        print("  {}: [{}] -> [{}]".format(name, h, n))


if __name__ == "__main__":
    main()
