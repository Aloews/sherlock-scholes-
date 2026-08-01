"""Recompute cards.fame + everything derived from it (tier, the 'legend' tag)
by calling the refresh_card_fame() RPC (supabase/migrations/deck_fame.sql).

fame is a PERCENTILE — a card's rank against the rest of its family (player /
non-player) by pageviews. That rank is relative, so it drifts every time an
import changes the underlying numbers: new cards inserted, pageviews or
pageviews_i18n refreshed, or a card's `active` flag flipped. Skipping this
step after such a run leaves fame (and the tier frame + Pro 'legend' tag it
drives) describing a scale that no longer matches the data.

0 Wikidata budget — pure DB RPC call, always safe to run.

Run from football_scraper/:  python ../docs/cards_fame_refresh.py
"""
import os

import requests
from dotenv import load_dotenv

HERE = os.path.dirname(__file__)
SCRAPER = os.path.join(HERE, "..", "football_scraper")


def main():
    load_dotenv(os.path.join(SCRAPER, ".env"))
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY not set (.env)")

    r = requests.post(
        url.rstrip("/") + "/rest/v1/rpc/refresh_card_fame",
        headers={"apikey": key, "Authorization": "Bearer " + key,
                  "Content-Type": "application/json"},
        json={}, timeout=60)
    r.raise_for_status()

    print("=" * 64)
    print("CARD FAME REFRESH")
    print("=" * 64)
    for row in r.json():
        print("  {family:8}: {n_cards:5} cards, {no_data:4} with no fame data".format(**row))


if __name__ == "__main__":
    main()
