"""APPLY docs/cards_fill_photo_url_preview.sql via Supabase REST (PostgREST).

There is no direct Postgres connection in .env (only SUPABASE_URL/KEY), so the
previewed SQL is executed as equivalent PATCH requests: each
    UPDATE cards SET photo_url = '...' WHERE id = '...' AND photo_url IS NULL;
becomes
    PATCH /rest/v1/cards?id=eq.<id>&photo_url=is.null   {"photo_url": "..."}
The photo_url IS NULL guard is preserved, so a re-run changes nothing
(idempotent). Not transactional like BEGIN/COMMIT, but every single update is
guarded and a partial run can simply be re-run.

Run:
    python docs/cards_fill_photo_url_apply.py
"""
import os
import re

import requests
from dotenv import load_dotenv

SQL_PATH = os.path.join(os.path.dirname(__file__), "cards_fill_photo_url_preview.sql")
UPDATE_RE = re.compile(
    r"^UPDATE cards SET photo_url = '(?P<url>(?:[^']|'')*)' "
    r"WHERE id = '(?P<id>[^']+)' AND photo_url IS NULL;"
)


def main():
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "football_scraper", ".env"))
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY not set (.env)")

    updates = []
    with open(SQL_PATH, encoding="utf-8") as fh:
        for line in fh:
            m = UPDATE_RE.match(line.strip())
            if m:
                updates.append((m.group("id"), m.group("url").replace("''", "'")))
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
    for i, (card_id, photo) in enumerate(updates, 1):
        try:
            resp = requests.patch(
                endpoint,
                headers=headers,
                params={"id": "eq." + card_id, "photo_url": "is.null"},
                json={"photo_url": photo},
                timeout=30,
            )
            resp.raise_for_status()
            rows = resp.json()
        except Exception as exc:  # noqa: BLE001 — log, keep applying the rest
            errors += 1
            print("[{}/{}] id {} — ERROR: {}".format(i, len(updates), card_id, exc),
                  flush=True)
            continue
        if rows:
            applied += 1
        else:
            skipped += 1  # already filled (guard hit) or id missing
        if i % 100 == 0:
            print("[{}/{}] applied={} skipped={} errors={}".format(
                i, len(updates), applied, skipped, errors), flush=True)

    print("=" * 64)
    print("APPLY SUMMARY (cards.photo_url)")
    print("  updates in SQL : {}".format(len(updates)))
    print("  applied        : {}".format(applied))
    print("  skipped (guard): {}".format(skipped))
    print("  errors         : {}".format(errors))
    print("=" * 64)


if __name__ == "__main__":
    main()
