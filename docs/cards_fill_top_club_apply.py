"""APPLY docs/cards_fill_top_club.sql via Supabase REST (PostgREST).

Only the table-altering part of the .sql needs the SQL Editor (two
ALTER TABLE ... ADD COLUMN lines). The 1340 data UPDATEs are replayed here
as guarded PATCH requests, exactly like docs/cards_fill_photo_url_apply.py:
    UPDATE cards SET top_club = '...', top_minutes = N
      WHERE id = '...' AND top_club IS NULL;
becomes
    PATCH /rest/v1/cards?id=eq.<id>&top_club=is.null   {"top_club":..,"top_minutes":..}
The top_club IS NULL guard is preserved, so a re-run changes nothing
(idempotent). A 400 "column ... does not exist" means the ALTER lines have
not been run yet — do that first (see the file header).

Run:
    python docs/cards_fill_top_club_apply.py
"""
import os
import re

import requests
from dotenv import load_dotenv

SQL_PATH = os.path.join(os.path.dirname(__file__), "cards_fill_top_club.sql")
UPDATE_RE = re.compile(
    r"^UPDATE cards SET top_club = '(?P<club>(?:[^']|'')*)', "
    r"top_minutes = (?P<min>\d+) "
    r"WHERE id = '(?P<id>[^']+)' AND top_club IS NULL;"
)


def main():
    load_dotenv(os.path.join(
        os.path.dirname(__file__), "..", "football_scraper", ".env"))
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY not set (.env)")

    updates = []
    with open(SQL_PATH, encoding="utf-8") as fh:
        for line in fh:
            m = UPDATE_RE.match(line.strip())
            if m:
                updates.append((
                    m.group("id"),
                    m.group("club").replace("''", "'"),
                    int(m.group("min")),
                ))
    if not updates:
        raise SystemExit("No UPDATE statements found in " + SQL_PATH)

    endpoint = url.rstrip("/") + "/rest/v1/cards"
    headers = {
        "apikey": key,
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }

    applied, skipped, errors = 0, 0, 0
    for i, (card_id, club, minutes) in enumerate(updates, 1):
        try:
            resp = requests.patch(
                endpoint,
                headers=headers,
                params={"id": "eq." + card_id, "top_club": "is.null"},
                json={"top_club": club, "top_minutes": minutes},
                timeout=30,
            )
            if resp.status_code == 400 and "does not exist" in resp.text:
                raise SystemExit(
                    "cards.top_club/top_minutes не существуют — выполните "
                    "две строки ALTER TABLE из docs/cards_fill_top_club.sql "
                    "в Supabase SQL Editor, затем перезапустите.")
            resp.raise_for_status()
            rows = resp.json()
        except SystemExit:
            raise
        except Exception as exc:  # noqa: BLE001 — log, keep applying the rest
            errors += 1
            print("[{}/{}] id {} — ERROR: {}".format(
                i, len(updates), card_id, exc), flush=True)
            continue
        if rows:
            applied += 1
        else:
            skipped += 1  # already filled (guard hit) or id missing
        if i % 200 == 0:
            print("[{}/{}] applied={} skipped={} errors={}".format(
                i, len(updates), applied, skipped, errors), flush=True)

    print("=" * 64)
    print("APPLY SUMMARY (cards.top_club / top_minutes)")
    print("  updates in SQL : {}".format(len(updates)))
    print("  applied        : {}".format(applied))
    print("  skipped (guard): {}".format(skipped))
    print("  errors         : {}".format(errors))
    print("=" * 64)


if __name__ == "__main__":
    main()
