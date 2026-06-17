"""Find FAMOUS men footballers MISSING from the deck and emit INSERT SQL.

Why: the deck already covers top-5 leagues (2022-24) + legends + WC2026 squads +
women, but well-known players can still be missing — stars who moved OUTSIDE the
top-5 (Saudi / MLS / Turkey / Brazil), 2025/26 breakouts, and a few past greats.

Method (matches docs/players-db-methodology.md):
  * candidates are given by EN name (curated below, grouped by bucket);
  * each is resolved on Wikidata to a FOOTBALLER (P106=Q937857); the RU name is
    taken from the ruwiki SITELINK (reliable — NOT transliteration), via the
    existing WikidataEnricher.enrich();
  * deduped against the LIVE deck by canonical_key on BOTH name and name_en
    (canonical_key folds Latin->Cyrillic + sorts tokens, so EN candidates match
    RU deck cards);
  * the MISSING ones get a MINIMAL insert (name, name_en, category, category_ru,
    forbidden_words) — exactly like docs/cards_insert_new_players.py. The rich
    fields (photo, facts, clubs_minutes, tier, continent...) are filled afterby
    the normal backfill scripts.

READ-ONLY / DRY-RUN: never writes to the DB. Reports buckets + writes
docs/cards_famous_insert.sql (idempotent INSERT ... WHERE NOT EXISTS).

Run from anywhere (reads football_scraper/.env):
    python docs/cards_missing_famous_build.py
"""
import os
import sys
import re
import json

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import requests
from dotenv import load_dotenv

HERE = os.path.dirname(os.path.abspath(__file__))
SCRAPER = os.path.join(os.path.dirname(HERE), "football_scraper")
sys.path.insert(0, SCRAPER)
load_dotenv(os.path.join(SCRAPER, ".env"))

from scraper.dedup import canonical_key            # noqa: E402
from scraper.cache import FileCache                # noqa: E402
from scraper.wikidata import WikidataEnricher      # noqa: E402
from scraper.supabase_writer import build_forbidden_words  # noqa: E402

CATEGORY, CATEGORY_RU = "player", "игроки"

# Candidate famous players by bucket — EN name (and optional full name for a
# more reliable Wikidata search). Generous on purpose: anyone already in the
# deck is dropped by the dedup, so the OUTPUT is the real gap list.
CANDIDATES = {
    "Вне топ-5 лиг (Saudi / MLS / др.)": [
        ("Karim Benzema", None), ("Sadio Mané", None), ("Riyad Mahrez", None),
        ("N'Golo Kanté", None), ("Roberto Firmino", None), ("Aymeric Laporte", None),
        ("Rúben Neves", None), ("Kalidou Koulibaly", None),
        ("Sergej Milinković-Savić", None), ("Aleksandar Mitrović", None),
        ("Ivan Toney", None), ("Moussa Diaby", None), ("Steven Bergwijn", None),
        ("Jhon Durán", None), ("Salem Al-Dawsari", None), ("Sandro Tonali", None),
        ("Luis Suárez", "Luis Alberto Suárez"), ("Jordi Alba", None),
        ("Sergio Busquets", None), ("Lorenzo Insigne", None),
        ("Marco Reus", None), ("Hugo Lloris", None), ("Olivier Giroud", None),
        ("Federico Bernardeschi", None), ("Denis Bouanga", None),
        ("Son Heung-min", None), ("Neymar", "Neymar da Silva Santos Júnior"),
        ("Memphis Depay", None), ("Óscar", "Óscar dos Santos Emboaba Júnior"),
        ("Edin Džeko", None), ("Mauro Icardi", None), ("Dries Mertens", None),
        ("Ciro Immobile", None), ("Anderson Talisca", None),
        ("Houssem Aouar", None), ("Allan Saint-Maximin", None),
    ],
    "Свежие звёзды 2025/26 (молодые/прорыв)": [
        ("Lamine Yamal", None), ("Désiré Doué", None), ("João Neves", None),
        ("Warren Zaïre-Emery", None), ("Kobbie Mainoo", None),
        ("Endrick", "Endrick Felipe"), ("Estêvão", "Estêvão Willian"),
        ("Pau Cubarsí", None), ("Arda Güler", None), ("Savinho", None),
        ("Geovany Quenda", None), ("Franco Mastantuono", None),
        ("Dean Huijsen", None), ("Rasmus Højlund", None), ("Benjamin Šeško", None),
        ("Hugo Ekitiké", None), ("Liam Delap", None), ("Omar Marmoush", None),
        ("Michael Olise", None), ("João Pedro", "João Pedro Junqueira de Jesus"),
        ("Antonio Nusa", None), ("Assane Diao", None), ("Lennart Karl", None),
        ("Alejandro Garnacho", None), ("Kenan Yıldız", None), ("Leny Yoro", None),
        ("Myles Lewis-Skelly", None), ("Ethan Nwaneri", None),
        ("Nico Paz", None), ("Ardon Jashari", None),
    ],
    "Обладатели/номинанты Ballon d'Or & The Best": [
        ("Rodri", "Rodrigo Hernández"), ("Ousmane Dembélé", None),
        ("Hristo Stoichkov", None), ("George Weah", None), ("Jean-Pierre Papin", None),
        ("Matthias Sammer", None), ("Pavel Nedvěd", None), ("Andriy Shevchenko", None),
        ("Fabio Cannavaro", None), ("Luís Figo", None), ("Michael Owen", None),
        ("Igor Belanov", None), ("Jean-Marc Bosman", None),
    ],
    "Молодые звёзды сборных (ЧМ-2026)": [
        ("Claudio Echeverri", None), ("Valentín Barco", None),
        ("Vitor Roque", None), ("Andrey Santos", None), ("Luis Guilherme", None),
        ("Wesley França", "Wesley Vinícius"), ("Mathys Tel", None),
        ("Rayan Cherki", None), ("Maghnes Akliouche", None), ("Bradley Barcola", None),
        ("Adam Wharton", None), ("Archie Gray", None), ("Jarrad Branthwaite", None),
        ("Fermín López", None), ("Marc Bernal", None), ("Nico Williams", None),
        ("Nick Woltemade", None), ("Paul Wanner", None), ("Brajan Gruda", None),
        ("Assan Ouédraogo", None), ("António Silva", "António Silva footballer"),
        ("Gonçalo Inácio", None), ("Francisco Conceição", None), ("Rodrigo Mora", None),
        ("Xavi Simons", None), ("Jorrel Hato", None), ("Giorgio Scalvini", None),
        ("Cesare Casadei", None), ("Can Uzun", None), ("Oscar Bobb", None),
        ("Bilal El Khannouss", None), ("Eliesse Ben Seghir", None),
        ("Abde Ezzalzouli", None), ("Kendry Páez", None), ("Ricardo Pepi", None),
        ("Facundo Pellistri", None), ("Lazar Samardžić", None), ("Milos Kerkez", None),
    ],
    "Легенды прошлого": [
        ("Diego Maradona", None), ("Ferenc Puskás", None), ("Just Fontaine", None),
        ("Gheorghe Hagi", None), ("Davor Šuker", None), ("Hidetoshi Nakata", None),
        ("Roberto Baggio", None), ("Hong Myung-bo", None), ("Bobby Moore", None),
        ("Dino Zoff", None), ("Gianluigi Buffon", None), ("Iker Casillas", None),
        ("Samuel Eto'o", None), ("Didier Drogba", None), ("Yaya Touré", None),
        ("Carlos Valderrama", None),
    ],
}


_PAREN_RE = re.compile(r"\s*\([^)]*\)")


def normalize_ru(name):
    """ruwiki article title -> natural display name matching the deck's style.
    Strip "(...)" disambiguators and flip "Фамилия, Имя" -> "Имя Фамилия"."""
    if not name:
        return name
    s = _PAREN_RE.sub("", name).strip()
    if s.count(",") == 1:
        a, b = (p.strip() for p in s.split(","))
        if a and b:
            s = b + " " + a
    return s


def fetch_deck(url, key):
    H = {"apikey": key, "Authorization": "Bearer " + key}
    out, off = [], 0
    while True:
        r = requests.get(url.rstrip("/") + "/rest/v1/cards", headers=H, params={
            "select": "id,name,name_en,category",
            "order": "id.asc", "limit": 1000, "offset": off,
        }, timeout=60)
        r.raise_for_status()
        b = r.json(); out.extend(b)
        if len(b) < 1000:
            break
        off += 1000
    return out


def sql_quote(t):
    return "NULL" if t is None or t == "" else "'" + str(t).replace("'", "''") + "'"


def sql_array(words):
    return "ARRAY[" + ",".join(sql_quote(w) for w in words) + "]::text[]"


def main():
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_KEY")
    if not (url and key):
        raise SystemExit("SUPABASE_URL / SUPABASE_KEY not set (football_scraper/.env)")

    cfg = json.load(open(os.path.join(SCRAPER, "config.json"), encoding="utf-8"))
    cache = FileCache(os.path.join(SCRAPER, "cache"), True)
    wd = WikidataEnricher(cfg["wikidata"], cache)

    print("Reading deck (read-only)…", flush=True)
    deck = fetch_deck(url, key)
    deck_keys = set()
    for c in deck:
        for fld in ("name", "name_en"):
            k = canonical_key(c.get(fld))
            if k:
                deck_keys.add(k)
    print(f"  deck cards: {len(deck)}  (canonical keys: {len(deck_keys)})\n")

    missing, in_deck, no_ru = [], [], []
    for bucket, names in CANDIDATES.items():
        for en, full in names:
            res = wd.enrich(en, full)
            name_ru = normalize_ru(res.get("name_ru"))
            qid = res.get("wikidata_qid")
            # dedup on whatever names we have (RU from wikidata + the EN query)
            cand_keys = {canonical_key(name_ru), canonical_key(en)}
            cand_keys.discard("")
            hit = next((c for c in deck
                        if canonical_key(c.get("name")) in cand_keys
                        or canonical_key(c.get("name_en")) in cand_keys), None)
            if hit:
                in_deck.append((bucket, en, hit))
            elif not name_ru:
                no_ru.append((bucket, en, qid))
            else:
                missing.append((bucket, name_ru, en, qid))

    # ---- report -----------------------------------------------------------
    print("=" * 70)
    print("MISSING FAMOUS PLAYERS — report (DRY-RUN)")
    print("=" * 70)
    by_bucket = {}
    for b, ru, en, qid in missing:
        by_bucket.setdefault(b, []).append((ru, en, qid))
    for bucket in CANDIDATES:
        rows = by_bucket.get(bucket, [])
        print(f"\n## {bucket} — MISSING: {len(rows)}")
        for ru, en, qid in rows:
            print(f"    + {ru:<28} ({en})  {qid}")

    print("\n" + "-" * 70)
    print(f"already in deck (skipped): {len(in_deck)}")
    for b, en, hit in in_deck:
        print(f"    = {en:<28} -> «{hit.get('name')}» [{hit.get('category')}] id={hit.get('id')}")
    if no_ru:
        print(f"\nresolved as footballer but NO ruwiki name ({len(no_ru)}) "
              "— add RU name by hand if you want them:")
        for b, en, qid in no_ru:
            print(f"    ? {en}  {qid or '(no QID)'}")

    total_cand = sum(len(v) for v in CANDIDATES.values())
    print("\n" + "=" * 70)
    print(f"candidates checked : {total_cand}")
    print(f"MISSING (new)      : {len(missing)}")
    print(f"already in deck    : {len(in_deck)}")
    print(f"unresolved/no RU   : {len(no_ru)}")
    print("=" * 70)

    # ---- write idempotent INSERT SQL -------------------------------------
    out_path = os.path.join(HERE, "cards_famous_insert.sql")
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write("-- Famous players missing from the deck (checked by canonical_key "
                 f"against {len(deck)} cards).\n")
        fh.write(f"-- {len(missing)} new players. Idempotent: each row inserts only "
                 "if no card with that name exists yet.\n")
        fh.write("-- After running: backfill the rest with the usual scripts "
                 "(photo_url, facts, clubs_minutes, tier, continent).\n\n")
        for bucket in CANDIDATES:
            rows = by_bucket.get(bucket, [])
            if not rows:
                continue
            fh.write(f"-- {bucket} ({len(rows)})\n")
            for ru, en, qid in rows:
                fh.write(
                    "INSERT INTO cards (name, name_en, category, category_ru, "
                    "forbidden_words, active)\n"
                    "SELECT {}, {}, 'player', 'игроки', {}, true\n"
                    "WHERE NOT EXISTS (SELECT 1 FROM cards WHERE lower(name) = lower({}));\n".format(
                        sql_quote(ru), sql_quote(en),
                        sql_array(build_forbidden_words(ru)), sql_quote(ru)))
            fh.write("\n")
        fh.write("NOTIFY pgrst, 'reload schema';\n")
    print(f"\nSQL written to docs/cards_famous_insert.sql ({len(missing)} rows). "
          "Nothing was written to the DB.")


if __name__ == "__main__":
    main()
