"""APPLY docs/cards_fill_clubs_minutes.sql via Supabase REST (PostgREST).

Only the ALTER TABLE ... ADD COLUMN clubs_minutes JSONB line needs the SQL
Editor. The data UPDATEs are replayed here as guarded PATCH requests:
    UPDATE cards SET clubs_minutes = '<json>'::jsonb
      WHERE id = '<id>' AND clubs_minutes IS NULL;
becomes
    PATCH /rest/v1/cards?id=eq.<id>&clubs_minutes=is.null  {"clubs_minutes": [...]}
Guarded by clubs_minutes IS NULL, so a re-run is idempotent. A 400 "column
does not exist" means the ALTER has not been run yet.

Run:  python docs/cards_fill_clubs_minutes_apply.py
"""
import json
import os
import re

import requests
from dotenv import load_dotenv

SQL_PATH = os.path.join(os.path.dirname(__file__), "cards_fill_clubs_minutes.sql")
UPDATE_RE = re.compile(
    r"^UPDATE cards SET clubs_minutes = '(?P<json>.*)'::jsonb "
    r"WHERE id = '(?P<id>[^']+)' AND clubs_minutes IS NULL;")


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
                payload = json.loads(m.group("json").replace("''", "'"))
                updates.append((m.group("id"), payload))
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
    for i, (card_id, payload) in enumerate(updates, 1):
        try:
            resp = requests.patch(
                endpoint, headers=headers,
                params={"id": "eq." + card_id, "clubs_minutes": "is.null"},
                json={"clubs_minutes": payload}, timeout=30)
            if resp.status_code == 400 and "does not exist" in resp.text:
                raise SystemExit(
                    "cards.clubs_minutes не существует — выполните строку "
                    "ALTER TABLE из docs/cards_fill_clubs_minutes.sql, затем "
                    "перезапустите.")
            resp.raise_for_status()
            rows = resp.json()
        except SystemExit:
            raise
        except Exception as exc:  # noqa: BLE001
            errors += 1
            print("[{}/{}] id {} — ERROR: {}".format(i, len(updates), card_id, exc),
                  flush=True)
            continue
        applied += 1 if rows else 0
        skipped += 0 if rows else 1
        if i % 200 == 0:
            print("[{}/{}] applied={} skipped={} errors={}".format(
                i, len(updates), applied, skipped, errors), flush=True)

    print("=" * 64)
    print("APPLY SUMMARY (cards.clubs_minutes)")
    print("  updates in SQL : {}".format(len(updates)))
    print("  applied        : {}".format(applied))
    print("  skipped (guard): {}".format(skipped))
    print("  errors         : {}".format(errors))
    print("=" * 64)


if __name__ == "__main__":
    main()
