"""Tag deck players who are in a 2026 FIFA World Cup squad with 'wc2026'.

Source: the English Wikipedia article "2026 FIFA World Cup squads" (one page,
all 48 squads). We take every article link on that page, canonicalise it (the
same word-order + Latin->Cyrillic + punctuation key the scraper dedup uses) and
intersect with the deck's player/woman cards. Matches get the 'wc2026' tag,
which the onboarding floor (pro_onboarding.sql) lets ALWAYS pass — current WC
players stay in the easy pool.

Read-only PREVIEW by default (prints count + sample, writes nothing).
Set APPLY=1 to PATCH the tag onto matched cards.

Run from anywhere; reads SUPABASE_URL / SUPABASE_KEY from football_scraper/.env.
    python docs/cards_wc2026_build.py            # preview
    APPLY=1 python docs/cards_wc2026_build.py     # write tags
"""
import os
import sys
import time
import requests
from dotenv import load_dotenv

HERE = os.path.dirname(__file__)
SCRAPER = os.path.join(HERE, "..", "football_scraper")
sys.path.insert(0, SCRAPER)
load_dotenv(os.path.join(SCRAPER, ".env"))
from scraper.dedup import canonical_key  # noqa: E402

APPLY = os.environ.get("APPLY") == "1"
WIKI_TITLE = "2026 FIFA World Cup squads"
WIKI_API = "https://en.wikipedia.org/w/api.php"
UA = "SherlockScholesBot/1.0 (giafreec@gmail.com) wc2026-squad-tagger"


def fetch_squad_links():
    """All namespace-0 article titles linked from the squads page."""
    titles, plcontinue = [], None
    while True:
        params = {
            "action": "query", "prop": "links", "titles": WIKI_TITLE,
            "plnamespace": 0, "pllimit": "max", "format": "json", "redirects": 1,
        }
        if plcontinue:
            params["plcontinue"] = plcontinue
        r = requests.get(WIKI_API, params=params, headers={"User-Agent": UA}, timeout=30)
        r.raise_for_status()
        data = r.json()
        pages = data.get("query", {}).get("pages", {})
        for page in pages.values():
            if "missing" in page:
                raise SystemExit(f"Wikipedia page not found: {WIKI_TITLE!r}")
            for link in page.get("links", []):
                titles.append(link["title"])
        cont = data.get("continue", {})
        plcontinue = cont.get("plcontinue")
        if not plcontinue:
            break
        time.sleep(1)  # be polite
    return titles


def fetch_deck_players(url, key):
    H = {"apikey": key, "Authorization": "Bearer " + key}
    out, off = [], 0
    while True:
        r = requests.get(url + "/rest/v1/cards", headers=H, params={
            "select": "id,name,name_en,tags",
            "active": "eq.true",
            "category": "in.(player,woman)",
            "order": "id", "limit": 1000, "offset": off,
        }, timeout=60)
        r.raise_for_status()
        b = r.json(); out.extend(b)
        if len(b) < 1000:
            break
        off += 1000
    return out


def main():
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_KEY"]

    print(f"Fetching '{WIKI_TITLE}' links from Wikipedia…")
    links = fetch_squad_links()
    link_keys = {canonical_key(t) for t in links}
    link_keys.discard("")
    print(f"  squad-page article links: {len(links)}  (unique canonical keys: {len(link_keys)})")

    cards = fetch_deck_players(url, key)
    print(f"  deck player/woman cards: {len(cards)}")

    matched = []
    for c in cards:
        for nm in (c.get("name_en"), c.get("name")):
            k = canonical_key(nm)
            if k and k in link_keys:
                matched.append(c)
                break

    already = [c for c in matched if "wc2026" in (c.get("tags") or [])]
    todo = [c for c in matched if "wc2026" not in (c.get("tags") or [])]
    print(f"\nMATCHED deck players in a 2026 squad: {len(matched)}")
    print(f"  already tagged wc2026: {len(already)}")
    print(f"  to tag now:            {len(todo)}")
    print("\nsample matches:")
    for c in matched[:25]:
        print(f"  {c.get('name')}  ({c.get('name_en')})")

    if not APPLY:
        print(f"\nPREVIEW only — nothing written. Re-run with APPLY=1 to tag {len(todo)} cards.")
        return

    H = {"apikey": key, "Authorization": "Bearer " + key,
         "Content-Type": "application/json", "Prefer": "return=minimal"}
    print(f"\nAPPLY: tagging {len(todo)} cards with wc2026…")
    for i, c in enumerate(todo, 1):
        new_tags = sorted(set((c.get("tags") or []) + ["wc2026"]))
        r = requests.patch(url + "/rest/v1/cards", headers=H,
                           params={"id": "eq." + str(c["id"])},
                           json={"tags": new_tags}, timeout=30)
        r.raise_for_status()
        if i % 50 == 0:
            print(f"  {i}/{len(todo)}")
    print(f"Done. Tagged {len(todo)} cards wc2026.")


if __name__ == "__main__":
    main()
