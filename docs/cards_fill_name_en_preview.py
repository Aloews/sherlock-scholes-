"""READ-ONLY preview: backfill cards.name_en from players_meta.

Player cards inserted by --to-cards BEFORE the name_en column was wired up
have name_en IS NULL, so the EN language toggle can't show them. This script:
  1. GETs every player card (id, name, name_en) from Supabase.
  2. GETs every players_meta row (name_en, name_ru).
  3. For each card with name_en IS NULL, finds the meta player by
     exact name_ru match first, then by canonical_key(name_ru) — the same
     word-order/translit-invariant key the dedup pipeline uses.
  4. Skips matches where one key points at several DIFFERENT name_en values
     (ambiguous — needs a human), and reports cards with no match at all.
  5. Writes a SQL preview file of UPDATEs. NOTHING is executed against the DB.

Run:
    python docs/cards_fill_name_en_preview.py
"""
import os
import sys

import requests
from dotenv import load_dotenv

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "football_scraper"))
from scraper.dedup import canonical_key  # noqa: E402


def fetch_all(url, key, table, select, page_size=1000):
    endpoint = url.rstrip("/") + "/rest/v1/" + table
    headers = {"apikey": key, "Authorization": "Bearer " + key}
    rows, offset = [], 0
    while True:
        resp = requests.get(
            endpoint, headers=headers,
            params={"select": select, "order": "id.asc",
                    "limit": page_size, "offset": offset},
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


AMBIGUOUS = object()  # sentinel: key maps to >1 distinct name_en


def add_key(mapping, k, name_en):
    if not k:
        return
    existing = mapping.get(k)
    if existing is None:
        mapping[k] = name_en
    elif existing is not AMBIGUOUS and existing != name_en:
        mapping[k] = AMBIGUOUS


def main():
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "football_scraper", ".env"))
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY not set (.env)")

    cards = fetch_all(url, key, "cards", "id,name,category,name_en")
    meta = fetch_all(url, key, "players_meta", "id,name_en,name_ru")

    players = [c for c in cards if c.get("category") == "player"]
    targets = [c for c in players if c.get("name_en") is None]

    # name_ru -> name_en lookups: exact string first, canonical key as fallback.
    exact, canon = {}, {}
    meta_with_ru = 0
    for m in meta:
        ru, en = m.get("name_ru"), m.get("name_en")
        if not (ru and en):
            continue
        meta_with_ru += 1
        add_key(exact, ru.strip(), en)
        add_key(canon, canonical_key(ru), en)

    matched, ambiguous, unmatched = [], [], []
    for c in targets:
        name = (c.get("name") or "").strip()
        hit, how = exact.get(name), "exact"
        if hit is None:
            hit, how = canon.get(canonical_key(name)), "canonical"
        if hit is AMBIGUOUS:
            ambiguous.append(c)
        elif hit is None:
            unmatched.append(c)
        else:
            matched.append((c, hit, how))

    # ---- console report -------------------------------------------------
    print("=" * 64)
    print("CARDS name_en BACKFILL — PREVIEW (read-only, nothing written)")
    print("=" * 64)
    print("player cards total       : {}".format(len(players)))
    print("  name_en already set    : {}".format(len(players) - len(targets)))
    print("  name_en IS NULL        : {}".format(len(targets)))
    print("players_meta rows        : {} ({} with name_ru+name_en)".format(
        len(meta), meta_with_ru))
    print("-" * 64)
    print("WILL FILL (UPDATE)       : {}".format(len(matched)))
    print("  via exact name_ru      : {}".format(
        sum(1 for _, _, how in matched if how == "exact")))
    print("  via canonical_key      : {}".format(
        sum(1 for _, _, how in matched if how == "canonical")))
    print("AMBIGUOUS (skipped)      : {}".format(len(ambiguous)))
    print("NO MATCH (left NULL)     : {}".format(len(unmatched)))
    print("=" * 64)

    print("\n10 examples (card name -> name_en):")
    for c, en, how in matched[:10]:
        print("  {!r:40} -> {!r}  [{}]".format(c["name"], en, how))

    if ambiguous:
        print("\nAMBIGUOUS examples (one RU name, several EN candidates):")
        for c in ambiguous[:10]:
            print("  {!r}".format(c["name"]))

    if unmatched:
        print("\nNO-MATCH examples (not found in players_meta):")
        for c in unmatched[:15]:
            print("  {!r}".format(c["name"]))

    # ---- SQL preview file (NOT executed) --------------------------------
    out = os.path.join(os.path.dirname(__file__), "cards_fill_name_en_preview.sql")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write("-- PREVIEW ONLY — do not run until approved.\n")
        fh.write("-- Backfill cards.name_en from players_meta for player cards "
                 "where name_en IS NULL.\n")
        fh.write("-- {} UPDATE; {} ambiguous skipped; {} without a match.\n\n"
                 .format(len(matched), len(ambiguous), len(unmatched)))
        fh.write("BEGIN;\n\n")
        for c, en, how in matched:
            fh.write("UPDATE cards SET name_en = {} WHERE id = '{}' AND name_en IS NULL;"
                     "  -- {} [{}]\n".format(sql_quote(en), c["id"], c["name"], how))
        if ambiguous:
            fh.write("\n-- AMBIGUOUS (one RU name -> several EN names), resolve manually:\n")
            for c in ambiguous:
                fh.write("-- id {}  name {}\n".format(c["id"], c["name"]))
        if unmatched:
            fh.write("\n-- NO MATCH in players_meta (stay NULL):\n")
            for c in unmatched:
                fh.write("-- id {}  name {}\n".format(c["id"], c["name"]))
        fh.write("\nROLLBACK;  -- change to COMMIT only after manual review\n")
    print("\nSQL preview written to: {}".format(out))


if __name__ == "__main__":
    main()
