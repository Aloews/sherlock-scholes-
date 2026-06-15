"""READ-ONLY breakdown of the "Прочие" bucket (player cards, continent IS NULL).

Does NOT write to the DB and makes NO network calls beyond a plain GET of the
cards table. It:
  1. GETs every player card with continent IS NULL (id, name, country).
  2. Splits them into:
       A. country known + ISO maps to a continent bucket  -> backfillable NOW,
          for free, from country alone (grouped per bucket);
       B. country known but ISO has no bucket (Oceania: NZ/FJ/PG, or any
          unmapped ISO) -> reported separately so we can decide Oceania;
       C. no country at all -> truly source-less, needs Wikidata P27 later.
  3. Prints the numbers + the full list of group C (legends / historical
     national teams like the USSR).
  4. Writes docs/cards_fill_continent_from_country.sql — set-based UPDATEs
     (one per bucket, IN-list of ISO codes), guarded by continent IS NULL so a
     re-run is idempotent. NOTHING is executed.

ISO->continent is derived from run.py's COUNTRY_ISO + continent_for_country so
it carries the exact confederation overrides used by the original backfill
(ex-Soviet UEFA -> Europe, Australia -> Asia, Oceania -> NULL).

Run from football_scraper/ so `import run` resolves:
    python ../docs/cards_fill_continent_from_country_preview.py
"""
import os
import sys

import requests
from dotenv import load_dotenv

HERE = os.path.dirname(__file__)
SCRAPER = os.path.join(HERE, "..", "football_scraper")
sys.path.insert(0, SCRAPER)
import run  # noqa: E402  COUNTRY_ISO, continent_for_country, normalize_country

# Pacific/Oceania ISO codes that get a flag but no continent bucket today.
OCEANIA_ISO = {"NZ", "FJ", "PG"}

# Derive ISO 3166 code -> continent bucket from the two name-keyed maps, so the
# overrides (Russia/Kazakhstan -> europe, Australia -> asia) are preserved.
ISO_TO_CONTINENT = {}
for _name, _code in run.COUNTRY_ISO.items():
    _cont = run.continent_for_country(_name)
    if _cont:
        ISO_TO_CONTINENT.setdefault(_code, _cont)


def fetch_other_players(url, key, page_size=1000):
    """All player cards currently in 'Прочие' (continent IS NULL)."""
    endpoint = url.rstrip("/") + "/rest/v1/cards"
    headers = {"apikey": key, "Authorization": "Bearer " + key}
    rows, offset = [], 0
    while True:
        resp = requests.get(
            endpoint, headers=headers,
            params={"select": "id,name,country",
                    "category": "eq.player", "continent": "is.null",
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


def main():
    load_dotenv(os.path.join(SCRAPER, ".env"))
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY not set (.env)")

    cards = fetch_other_players(url, key)

    by_bucket = {}          # continent -> [cards]  (group A, backfillable)
    oceania = []            # group B: country known, Oceania (no bucket)
    unmapped_iso = []       # group B: country known, ISO not in our map at all
    no_country = []         # group C: no country -> Wikidata later
    for c in cards:
        country = (c.get("country") or "").strip()
        if not country:
            no_country.append(c)
            continue
        bucket = ISO_TO_CONTINENT.get(country)
        if bucket:
            by_bucket.setdefault(bucket, []).append(c)
        elif country in OCEANIA_ISO:
            oceania.append(c)
        else:
            unmapped_iso.append(c)

    backfillable = sum(len(v) for v in by_bucket.values())

    # ---- console report -------------------------------------------------
    print("=" * 64)
    print('"ПРОЧИЕ" BREAKDOWN — player cards with continent IS NULL (read-only)')
    print("=" * 64)
    print("total in 'Прочие'        : {}".format(len(cards)))
    print("-" * 64)
    print("A. country -> bucket NOW : {}".format(backfillable))
    for cont in sorted(by_bucket):
        print("     {:<14} : {}".format(cont, len(by_bucket[cont])))
    print("B. Oceania (NZ/FJ/PG)    : {}".format(len(oceania)))
    if unmapped_iso:
        print("B. country, unmapped ISO : {}".format(len(unmapped_iso)))
    print("C. no country (Wikidata) : {}".format(len(no_country)))
    print("=" * 64)

    if oceania:
        print("\nOceania players (decide: own bucket vs. fold into Asia):")
        for c in oceania:
            print("  {:<6} {}".format(c.get("country"), c["name"]))
    if unmapped_iso:
        print("\nCountry set but ISO not in continent map (investigate):")
        for c in unmapped_iso:
            print("  {:<6} {}".format(c.get("country"), c["name"]))

    print("\nC. NO source at all — stays in 'Прочие' until Wikidata P27 "
          "({} cards):".format(len(no_country)))
    for c in no_country:
        print("  {}".format(c["name"]))

    # ---- backfill SQL (NOT executed) ------------------------------------
    # Fold Oceania into Asia for now (matches the Australia->Asia precedent);
    # flip OCEANIA_BUCKET to 'oceania' here if we add the bucket instead.
    OCEANIA_BUCKET = "asia"
    sql_buckets = {cont: sorted({(c.get("country") or "").strip()
                                 for c in rows})
                   for cont, rows in by_bucket.items()}
    if oceania:
        sql_buckets.setdefault(OCEANIA_BUCKET, [])
        sql_buckets[OCEANIA_BUCKET] = sorted(
            set(sql_buckets[OCEANIA_BUCKET]) | OCEANIA_ISO)

    out = os.path.join(HERE, "cards_fill_continent_from_country.sql")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write("-- PREVIEW — country -> continent backfill for 'Прочие'.\n")
        fh.write("-- Read-only derivation; review then run in the SQL Editor.\n")
        fh.write("-- {} player cards move out of 'Прочие'; {} stay (no country, "
                 "need Wikidata P27).\n".format(
                     backfillable + len(oceania), len(no_country)))
        fh.write("-- Oceania (NZ/FJ/PG, {} cards) folded into '{}' "
                 "(Australia->Asia precedent).\n\n".format(
                     len(oceania), OCEANIA_BUCKET))
        fh.write("BEGIN;\n\n")
        for cont in sorted(sql_buckets):
            codes = sql_buckets[cont]
            if not codes:
                continue
            in_list = ", ".join("'" + code.replace("'", "''") + "'"
                                for code in codes)
            fh.write("UPDATE cards SET continent = '{}'\n"
                     "  WHERE category = 'player' AND continent IS NULL\n"
                     "    AND country IN ({});\n\n".format(cont, in_list))
        fh.write("COMMIT;\n")
        fh.write("NOTIFY pgrst, 'reload schema';\n")
    print("\nBackfill SQL written to: {}".format(out))


if __name__ == "__main__":
    main()
