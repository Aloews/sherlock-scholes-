# One-off READ-ONLY helper: check 20 candidate player cards against the deck
# by canonical_key and write SQL INSERTs for the new ones to
# docs/cards_insert_new_players.sql. Never writes to the database.
# Run from anywhere: python docs/cards_insert_new_players_preview.py
import sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import os

DOCS_DIR = os.path.dirname(os.path.abspath(__file__))
SCRAPER_DIR = os.path.join(os.path.dirname(DOCS_DIR), "football_scraper")
sys.path.insert(0, SCRAPER_DIR)

from dotenv import load_dotenv

load_dotenv(os.path.join(SCRAPER_DIR, ".env"))

from scraper.dedup import canonical_key
from scraper.supabase_writer import CardsClient, build_forbidden_words

PLAYERS = [
    ("Хвича Кварацхелия", "Khvicha Kvaratskhelia"),
    ("Жорж Микаутадзе", "Georges Mikautadze"),
    ("Гиорги Кочорашвили", "Giorgi Kochorashvili"),
    ("Зурико Давиташвили", "Zuriko Davitashvili"),
    ("Абдукодир Хусанов", "Abdukodir Khusanov"),
    ("Элдор Шомуродов", "Eldor Shomurodov"),
    ("Аббосбек Файзуллаев", "Abbosbek Fayzullaev"),
    ("Жалолиддин Машарипов", "Jaloliddin Masharipov"),
    ("Дастан Сатпаев", "Dastan Satpaev"),
    ("Бахтиёр Зайнутдинов", "Bakhtiyor Zaynutdinov"),
    ("Галымжан Кенжебек", "Galymzhan Kenzhebek"),
    ("Валерий Громыко", "Valery Gromyko"),
    ("Эдуард Сперцян", "Eduard Spertsyan"),
    ("Рустам Ятимов", "Rustam Yatimov"),
    ("Эхсони Панджшанбе", "Ehsoni Panjshanbe"),
    ("Парвизджон Умарбоев", "Parvizdzhon Umarboev"),
    ("Алишер Джалилов", "Alisher Dzhalilov"),
    ("Гулжигит Алыкулов", "Gulzhigit Alykulov"),
    ("Валерий Кичин", "Valery Kichin"),
    ("Жоэль Кожо", "Joel Kojo"),
]


def sql_quote(text):
    return "'" + text.replace("'", "''") + "'"


def sql_array(words):
    return "ARRAY[" + ",".join(sql_quote(w) for w in words) + "]::text[]"


client = CardsClient(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])
print("Читаю cards (read-only, только name/category)...", flush=True)
existing = client.fetch_cards_for_dedup()
by_key = {}
for c in existing:
    k = canonical_key(c.get("name"))
    if k and k not in by_key:
        by_key[k] = c

skipped = []
new = []
for name, name_en in PLAYERS:
    key = canonical_key(name)
    if key in by_key:
        skipped.append((name, by_key[key]))
    else:
        new.append((name, name_en))

print()
print("УЖЕ В БАЗЕ — ПРОПУЩЕНЫ ({}):".format(len(skipped)))
for name, card in skipped:
    print("  - {:<24} -> существующая карточка «{}» [{}] id={}".format(
        name, card.get("name"), card.get("category"), card.get("id")))

print()
print("НОВЫЕ — SQL ({}):".format(len(new)))
print()

lines = []
lines.append("-- INSERT new player cards (checked against the deck by "
             "canonical_key on {} cards; duplicates skipped)".format(
                 len(existing)))
lines.append("INSERT INTO cards (name, name_en, category, category_ru, "
             "forbidden_words) VALUES")
values = []
for name, name_en in new:
    values.append("  ({}, {}, 'player', 'игроки', {})".format(
        sql_quote(name), sql_quote(name_en),
        sql_array(build_forbidden_words(name))))
lines.append(",\n".join(values) + ";")
sql = "\n".join(lines)
print(sql)

out_path = os.path.join(DOCS_DIR, "cards_insert_new_players.sql")
with open(out_path, "w", encoding="utf-8") as fh:
    fh.write(sql + "\n")
print()
print("SQL сохранён в docs/cards_insert_new_players.sql (НЕ выполнялся).")
