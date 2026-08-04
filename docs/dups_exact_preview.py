# READ-ONLY: find duplicate cards by EXACT evidence, not by fuzzy name score,
# and write docs/dups_exact.sql. Never touches the database.
#
# WHY A SECOND PASS. dups_cleanup_preview.py scores Russian spellings against
# each other, which is the right tool for «Гетце»/«Гётце» but leaves the plain
# cases needing a human: «Садио Мане»/«Садьо Мане» scores 0.89 and lands in the
# review pile even though BOTH CARDS CARRY THE SAME PHOTO — that is, the same
# Wikidata entity. Fuzzy matching cannot see that; this pass keys on it.
#
# THE EVIDENCE, in order of how much it proves:
#   * identical name_en   — the enrichment resolved both cards to one article
#   * identical photo_url — and to one image on it (never NULL on both; two
#                           blanks are not a match)
#   * identical pageviews — and to one traffic series
# A group is CERTAIN when it shares name_en plus one of the other two, and all
# its cards are in the same category. Anything else is emitted commented out.
#
# Namesakes are the reason name_en alone is not enough: two different players
# really can share a name. What they do not share is one photo and one
# pageview count.
#
# WHY DEACTIVATION, NOT DELETE (same as dups_cleanup_preview.py):
# round_cards.card_id REFERENCES cards(id) with no ON DELETE CASCADE, so
# deleting a card that was ever played breaks the FK. active = false takes it
# out of the game and is reversible.
#
# KEEP-RULE: the card with more pageviews, then higher fame, then the older
# one. With the photo identical there is nothing to choose between them there.
#
# Run from anywhere:  python docs/dups_exact_preview.py
# Needs SUPABASE_URL + SUPABASE_KEY (anon is enough — it only reads).
import io
import os
import sys

import requests
from dotenv import load_dotenv

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
SCRAPER = os.path.join(os.path.dirname(HERE), "football_scraper")
OUT_SQL = os.path.join(HERE, "dups_exact.sql")


def fetch_all(url, key, select, page_size=1000):
    endpoint = url.rstrip("/") + "/rest/v1/cards"
    headers = {"apikey": key, "Authorization": "Bearer " + key}
    rows, offset = [], 0
    while True:
        r = requests.get(endpoint, headers=headers,
                         params={"select": select, "active": "eq.true",
                                 "order": "id.asc", "limit": page_size, "offset": offset},
                         timeout=60)
        r.raise_for_status()
        batch = r.json()
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def sort_key(card):
    """Best card first: more views, then better known, then older."""
    return (
        -(card.get("pageviews") or 0),
        -(card.get("fame") or 0),
        card.get("created_at") or "",
    )


def main():
    load_dotenv(os.path.join(SCRAPER, ".env"))
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY not set (.env)")

    cards = fetch_all(url, key, "id,name,name_en,category,pageviews,fame,photo_url,created_at")

    groups = {}
    for c in cards:
        if c.get("name_en"):
            groups.setdefault(c["name_en"], []).append(c)
    groups = {k: v for k, v in groups.items() if len(v) > 1}

    certain, review = [], []
    for name_en, members in sorted(groups.items()):
        members.sort(key=sort_key)
        categories = {m.get("category") for m in members}
        photos = [m.get("photo_url") for m in members]
        views = [m.get("pageviews") for m in members]

        same_photo = all(p for p in photos) and len(set(photos)) == 1
        same_views = all(v is not None for v in views) and len(set(views)) == 1
        (certain if (len(categories) == 1 and (same_photo or same_views)) else review).append(
            (name_en, members, same_photo, same_views, len(categories) == 1))

    lines = [
        "-- Duplicate cards found by EXACT evidence (docs/dups_exact_preview.py).",
        "-- Complements docs/dups_cleanup.sql, which scores fuzzy name similarity;",
        "-- these are pairs resolved to ONE Wikidata entity — same name_en plus the",
        "-- same photo and/or the same pageviews — so they are not a judgement call.",
        "--",
        "-- Deactivation, not DELETE: round_cards.card_id references cards(id).",
        "-- Keep-rule: more pageviews, then higher fame, then the older card.",
        "--",
        "-- NOT EXECUTED. Read it, then run it in the Supabase SQL editor.",
        "",
        "-- !! AFTER APPLYING, RECOMPUTE FAME !!",
        "--    python docs/cards_fame_refresh.py",
        "-- fame is a percentile, and a duplicate SPLITS one player's attention",
        "-- across two cards: «Жоау Моутиньо» sits at 70 and «Жоау Моутинью» at 35",
        "-- for the same man. Both are understated until the scale is rebuilt, which",
        "-- is also why the two halves of a pair can wear different rarity frames.",
        "",
        f"-- ============ CERTAIN: {len(certain)} groups ============",
    ]

    dropped = 0
    for name_en, members, same_photo, same_views, _ in certain:
        keep, *losers = members
        why = ", ".join(([f"same photo"] if same_photo else []) + (["same pageviews"] if same_views else []))
        lines.append(
            f"-- {name_en}: keep «{keep['name']}» [{keep.get('category')} | pv={keep.get('pageviews')} | "
            f"fame={keep.get('fame')}] — {why}")
        for loser in losers:
            dropped += 1
            lines.append(
                f"UPDATE cards SET active = false WHERE id = '{loser['id']}';"
                f"  -- «{loser['name']}» (fame={loser.get('fame')})")

    lines += ["", f"-- ============ REVIEW: {len(review)} groups — same name_en, nothing else agrees ============",
              "-- Different people can share a name. Uncomment only what you confirm."]
    for name_en, members, _, _, one_category in review:
        note = "" if one_category else "  [CROSS-CATEGORY]"
        lines.append(f"--   {name_en}{note}")
        for m in members:
            lines.append(
                f"--     «{m['name']}» [{m.get('category')} | pv={m.get('pageviews')} | "
                f"fame={m.get('fame')} | photo={'y' if m.get('photo_url') else 'n'}] {m['id']}")

    with open(OUT_SQL, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")

    print(f"groups with a shared name_en : {len(groups)}")
    print(f"  CERTAIN                    : {len(certain)}  ({dropped} cards would be deactivated)")
    print(f"  REVIEW                     : {len(review)}")
    print(f"\nSQL written to {OUT_SQL} (NOT executed).")


if __name__ == "__main__":
    main()
