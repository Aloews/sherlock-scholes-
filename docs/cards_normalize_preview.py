"""READ-ONLY preview: normalize scraped card names to the manual-card format.

Does NOT write to the database. It:
  1. GETs every card (id, name, category, pageviews) from Supabase.
  2. Classifies each card as NEW (scraped) or OLD (manual).
  3. Builds a normalized name for the new ones:
        "Андре (футболист, 2001)" -> "Андре"      (drop "(...)")
        "Лукаку, Ромелу"          -> "Ромелу Лукаку" (flip "Surname, Name")
        stray commas / double spaces collapsed.
  4. Splits the new cards into:
        - RENAME : normalized name is genuinely new -> UPDATE name
        - DELETE : normalized name collapses onto an existing OLD card
                   (canonical_key match) -> duplicate, must be removed, not renamed
  5. Writes a SQL preview file (UPDATEs + a commented DELETE block). NOTHING is
     executed against the DB.

Run from football_scraper/ so scraper.dedup is importable:
    python ../docs/cards_normalize_preview.py
"""
import os
import sys

import requests
from dotenv import load_dotenv

# Reuse the deck's own notion of "same card" (word-order- and translit-
# invariant) so duplicate detection matches how --to-cards already dedups,
# and the SAME display normalizer that --to-cards now applies at insert time.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "football_scraper"))
from scraper.dedup import canonical_key, normalize_display_name  # noqa: E402
from scraper.supabase_writer import build_forbidden_words  # noqa: E402

normalize_card_name = normalize_display_name


def is_new_card(card):
    """A card is from the scraped wave (--to-cards) only if it is a PLAYER and
    carries a scraped marker: pageviews set, OR a "Surname, Name" comma, OR a
    disambiguation parenthetical. Restricting to category='player' is essential:
    manual CLUB cards like "Арсенал (Лондон)" use a MEANINGFUL city in
    parentheses — they are not scraped junk and must not be normalized."""
    if card.get("category") != "player":
        return False
    name = card.get("name") or ""
    return (
        card.get("pageviews") is not None
        or "," in name
        or "(" in name
        or "[" in name
    )


def fetch_all_cards(url, key, page_size=1000):
    endpoint = url.rstrip("/") + "/rest/v1/cards"
    headers = {"apikey": key, "Authorization": "Bearer " + key}
    rows, offset = [], 0
    while True:
        resp = requests.get(
            endpoint, headers=headers,
            params={"select": "id,name,category,pageviews",
                    "order": "name.asc", "limit": page_size, "offset": offset},
            timeout=30,
        )
        resp.raise_for_status()
        batch = resp.json()
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def sql_quote(text):
    return "'" + (text or "").replace("'", "''") + "'"


def main():
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "football_scraper", ".env"))
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY not set (.env)")

    cards = fetch_all_cards(url, key)
    new_cards = [c for c in cards if is_new_card(c)]
    old_cards = [c for c in cards if not is_new_card(c)]

    # canonical keys of the stable (manual) cards = the dedup reference set.
    old_keys = {}
    for c in old_cards:
        k = canonical_key(c["name"])
        if k:
            old_keys.setdefault(k, c["name"])

    renames, deletes, intra = [], [], []
    seen_norm_keys = {}          # normalized-new key -> first card kept for rename
    for c in new_cards:
        norm = normalize_card_name(c["name"])
        if norm == c["name"]:
            continue             # already in manual format, nothing to change
        nk = canonical_key(norm)
        if nk and nk in old_keys:
            deletes.append((c, norm, old_keys[nk]))      # dup of an OLD card
        elif nk and nk in seen_norm_keys:
            intra.append((c, norm, seen_norm_keys[nk]))  # dup of another NEW card
        else:
            if nk:
                seen_norm_keys[nk] = c["name"]
            renames.append((c, norm))

    # ---- console report -------------------------------------------------
    print("=" * 64)
    print("CARDS NORMALIZE — PREVIEW (read-only, nothing written)")
    print("=" * 64)
    print("total cards            : {}".format(len(cards)))
    print("  classified NEW       : {}".format(len(new_cards)))
    print("  classified OLD       : {}".format(len(old_cards)))
    print("    new with pageviews : {}".format(
        sum(1 for c in new_cards if c.get("pageviews") is not None)))
    print("    new with comma     : {}".format(
        sum(1 for c in new_cards if "," in (c.get("name") or ""))))
    print("    new with parens    : {}".format(
        sum(1 for c in new_cards if "(" in (c.get("name") or ""))))
    print("-" * 64)
    print("RENAME (UPDATE name)   : {}".format(len(renames)))
    print("DELETE (dup of OLD)    : {}".format(len(deletes)))
    print("DELETE (dup of NEW)    : {}".format(len(intra)))
    print("=" * 64)

    print("\n30 RENAME examples  (было -> стало):")
    for c, norm in renames[:30]:
        print("  {!r:40} -> {!r}".format(c["name"], norm))

    print("\nDUP-of-OLD examples (new -> normalized = existing OLD):")
    for c, norm, old_name in deletes[:30]:
        print("  {!r:40} -> {!r}  == OLD {!r}".format(c["name"], norm, old_name))

    # ---- SQL preview file (NOT executed) --------------------------------
    out = os.path.join(os.path.dirname(__file__), "cards_normalize_preview.sql")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write("-- PREVIEW ONLY — do not run until approved.\n")
        fh.write("-- {} UPDATE (rename), {} DELETE (dup of OLD), {} DELETE (dup of NEW)\n\n"
                 .format(len(renames), len(deletes), len(intra)))
        fh.write("BEGIN;\n\n-- 1) RENAME scraped cards to manual format "
                 "(forbidden_words rebuilt from the normalized name)\n")
        for c, norm in renames:
            fw = "ARRAY[" + ",".join(sql_quote(w) for w in build_forbidden_words(norm)) + "]::text[]"
            fh.write("UPDATE cards SET name = {}, forbidden_words = {} WHERE id = '{}';  -- was {}\n"
                     .format(sql_quote(norm), fw, c["id"], c["name"]))
        fh.write("\n-- 2) DELETE scraped cards that become exact duplicates of OLD cards\n")
        for c, norm, old_name in deletes:
            fh.write("DELETE FROM cards WHERE id = '{}';  -- {} -> {} == OLD {}\n"
                     .format(c["id"], c["name"], norm, old_name))
        fh.write("\n-- 3) DELETE scraped cards that duplicate ANOTHER scraped card after normalize\n")
        for c, norm, kept in intra:
            fh.write("DELETE FROM cards WHERE id = '{}';  -- {} -> {} (kept {})\n"
                     .format(c["id"], c["name"], norm, kept))
        fh.write("\nCOMMIT;  -- применится сразу; проверьте примеры ПЕРЕД запуском\n")
    print("\nSQL preview written to: {}".format(out))


if __name__ == "__main__":
    main()
