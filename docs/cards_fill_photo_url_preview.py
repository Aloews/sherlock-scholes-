"""READ-ONLY preview: backfill cards.photo_url from players_meta.

Cards inserted before the photo pipeline existed have photo_url IS NULL.
Run this AFTER:
  1. supabase/migrations/photo_url.sql  (adds photo_url to both tables),
  2. football_scraper/run.py --photos   (fills players_meta.photo_url).

This script (mirrors docs/cards_fill_name_en_preview.py):
  1. GETs every player card (id, name, photo_url) from Supabase.
  2. GETs every players_meta row with a photo (name_ru, name_en, photo_url).
  3. For each card with photo_url IS NULL, finds the meta player by exact
     name_ru match first, then by canonical_key(name_ru).
  4. Skips matches where one key points at several DIFFERENT photo_url
     values (ambiguous), and reports cards with no match.
  5. Writes a SQL preview file of UPDATEs. NOTHING is executed against the DB.

Run:
    python docs/cards_fill_photo_url_preview.py
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


AMBIGUOUS = object()  # sentinel: key maps to >1 distinct photo_url


def add_key(mapping, k, value):
    if not k:
        return
    existing = mapping.get(k)
    if existing is None:
        mapping[k] = value
    elif existing is not AMBIGUOUS and existing != value:
        mapping[k] = AMBIGUOUS


def main():
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "football_scraper", ".env"))
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY not set (.env)")

    try:
        cards = fetch_all(url, key, "cards", "id,name,category,photo_url")
        meta = fetch_all(url, key, "players_meta", "id,name_en,name_ru,photo_url")
    except requests.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 400:
            raise SystemExit(
                "photo_url column missing — apply supabase/migrations/"
                "photo_url.sql first (and run `run.py --photos` to fill "
                "players_meta).")
        raise

    players = [c for c in cards if c.get("category") == "player"]
    targets = [c for c in players if c.get("photo_url") is None]

    # name_ru -> photo_url lookups: exact string first, canonical key fallback.
    exact, canon = {}, {}
    meta_with_photo = 0
    for m in meta:
        ru, photo = m.get("name_ru"), (m.get("photo_url") or "").strip()
        if not (ru and photo):
            continue
        meta_with_photo += 1
        add_key(exact, ru.strip(), photo)
        add_key(canon, canonical_key(ru), photo)

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
    print("CARDS photo_url BACKFILL — PREVIEW (read-only, nothing written)")
    print("=" * 64)
    print("player cards total       : {}".format(len(players)))
    print("  photo_url already set  : {}".format(len(players) - len(targets)))
    print("  photo_url IS NULL      : {}".format(len(targets)))
    print("players_meta rows        : {} ({} with name_ru+photo_url)".format(
        len(meta), meta_with_photo))
    print("-" * 64)
    print("WILL FILL (UPDATE)       : {}".format(len(matched)))
    print("  via exact name_ru      : {}".format(
        sum(1 for _, _, how in matched if how == "exact")))
    print("  via canonical_key      : {}".format(
        sum(1 for _, _, how in matched if how == "canonical")))
    print("AMBIGUOUS (skipped)      : {}".format(len(ambiguous)))
    print("NO MATCH (left NULL)     : {}".format(len(unmatched)))
    print("=" * 64)

    print("\n10 examples (card name -> photo_url):")
    for c, photo, how in matched[:10]:
        print("  {!r:36} -> {}  [{}]".format(c["name"], photo, how))

    if ambiguous:
        print("\nAMBIGUOUS examples (one RU name, several photos):")
        for c in ambiguous[:10]:
            print("  {!r}".format(c["name"]))

    # ---- SQL preview file (NOT executed) --------------------------------
    out = os.path.join(os.path.dirname(__file__), "cards_fill_photo_url_preview.sql")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write("-- PREVIEW ONLY — do not run until approved.\n")
        fh.write("-- Backfill cards.photo_url from players_meta for player "
                 "cards where photo_url IS NULL.\n")
        fh.write("-- {} UPDATE; {} ambiguous skipped; {} without a match.\n\n"
                 .format(len(matched), len(ambiguous), len(unmatched)))
        fh.write("BEGIN;\n\n")
        for c, photo, how in matched:
            fh.write("UPDATE cards SET photo_url = {} WHERE id = '{}' AND "
                     "photo_url IS NULL;  -- {} [{}]\n"
                     .format(sql_quote(photo), c["id"], c["name"], how))
        if ambiguous:
            fh.write("\n-- AMBIGUOUS (one RU name -> several photos), resolve "
                     "manually:\n")
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
