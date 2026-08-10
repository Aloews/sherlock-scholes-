"""READ-ONLY audit: which countries' notable footballers the deck is missing.

WHY THIS EXISTS. Counting the deck by country produces a signature that is not
subtle:

    country  cards  avg fame
    GB-ENG     157      70.3
    JP          14      81.3   <-- highest average of any country on the board
    KR           6      63.0
    CN           0         —

A country with fourteen players who are on average MORE famous than England's
hundred and fifty-seven does not have fourteen notable footballers. It has
fourteen that were impossible to miss. High average fame with a low count is
the fingerprint of a coverage gap, not of a country without players — and it
is the one measurement that tells them apart.

WHAT IT DOES. For each country: ask Wikidata for footballers of that
citizenship who HAVE A RUSSIAN WIKIPEDIA ARTICLE, ranked by how many language
editions carry them. Sitelink count is the fame proxy available before a card
exists; the real `fame` percentile is computed later, from pageviews, by the
enrichment chain.

WHY THE RU ARTICLE IS REQUIRED, not merely preferred: a card's `name` is what
`run.resolve_card_qid` looks up in ru.wikipedia to find everything else —
photo, country, career, pageviews. A name with no ru article resolves to
nothing and the card stays bare forever. So the ru sitelink is the gate, and
its TITLE is the name we store (flipped out of "Surname, Given" by the same
normalize_display_name the scraper uses, so it matches the deck's format).

WHAT IT DELIBERATELY DOES NOT DO: write anything. It prints the gap and
emits SQL to docs/cards_insert_missing_players.sql, which dedupes against the
live deck IN THE DATABASE — see the header of the generated file for why the
dedupe cannot be done here.

    python docs/cards_missing_by_country_preview.py
    python docs/cards_missing_by_country_preview.py --limit 60 --countries JP,KR
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "football_scraper"))

from scraper.dedup import normalize_display_name  # noqa: E402

ENDPOINT = "https://query.wikidata.org/sparql"
# Wikimedia asks for a real identifier; an anonymous agent gets rate-limited
# into uselessness and deserves to be.
UA = "sherlock-scholes-deck-audit/1.0 (https://github.com/Aloews/sherlock-scholes-)"

# ISO code -> (Wikidata item, human name). The set is the coverage gap the
# count above found, plus the two American countries whose fixture list is
# far bigger than their card count.
COUNTRIES = {
    "JP": ("Q17",  "Япония"),
    "KR": ("Q884", "Южная Корея"),
    "CN": ("Q148", "Китай"),
    "US": ("Q30",  "США"),
    "MX": ("Q96",  "Мексика"),
}

# Q937857 = association football player. P21/Q6581097 = male: women have their
# OWN category in this deck (`woman`, built by cards_women_build.py), and
# dropping them into `player` would put them in the wrong half of the picker.
# A separate run of this script could fill that category the same way.
#
# THE OTHER TWO CLAUSES ARE NOT DECORATION. `P106 = footballer` alone, ranked
# by sitelinks, hands you the people who are famous for something else and
# played a bit: the first US answer it gave was Charles Sherrington, the Nobel
# physiologist, followed by two actors. They are not wrong — Sherrington really
# did turn out for Ipswich — they are simply not football cards, and sitelink
# count rewards exactly that kind of person.
#
#   P54 -> a team whose P641 is association football  (not the NFL, not futsal)
#   P413  a playing position
#
# A position is the thing a footballer's item always carries and a novelist's
# never does, so the pair removes the whole class in one clause instead of
# by a blacklist of professions that would need a new entry every time.
#
# THE ENGLISH NAME COMES FROM THE ARTICLE TITLE, not from rdfs:label, and only
# falls back to the label. Labels are free-text and drift: Wikidata calls
# 浅野拓磨 "Takuma ano" (the "As" is simply missing) and Rafael Márquez
# "Rafael Márquez El piojo". Both would have entered the deck as a card's
# permanent `name_en`, and the second would have slipped past the duplicate
# check against the Rafael Márquez already in it. Article titles are policed
# by editors; labels are not.
QUERY = """
SELECT ?item ?ruTitle ?enTitle ?enLabel (COUNT(DISTINCT ?sl) AS ?links) WHERE {
  ?item wdt:P106 wd:Q937857 ; wdt:P27 wd:%(country)s ; wdt:P21 wd:Q6581097 ;
        wdt:P54 ?team ; wdt:P413 ?pos .
  ?team wdt:P641 wd:Q2736 .
  ?ruArt schema:about ?item ;
         schema:isPartOf <https://ru.wikipedia.org/> ;
         schema:name ?ruTitle .
  ?sl schema:about ?item .
  OPTIONAL {
    ?enArt schema:about ?item ;
           schema:isPartOf <https://en.wikipedia.org/> ;
           schema:name ?enTitle .
  }
  OPTIONAL { ?item rdfs:label ?enLabel FILTER(lang(?enLabel) = 'en') }
}
GROUP BY ?item ?ruTitle ?enTitle ?enLabel
ORDER BY DESC(?links)
LIMIT %(limit)d
"""


def sparql(query, attempts=3):
    url = ENDPOINT + "?format=json&query=" + urllib.parse.quote(query)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(req, timeout=120) as response:
                return json.load(response)["results"]["bindings"]
        except Exception as err:  # noqa: BLE001 — the endpoint throttles by design
            if attempt == attempts - 1:
                raise
            wait = 5 * (attempt + 1)
            print(f"  … {err}; повтор через {wait}s", flush=True)
            time.sleep(wait)
    return []


def sql_quote(text):
    return "'" + str(text).replace("'", "''") + "'"



def english_name(binding):
    """The card's name_en.

    Title first, label second (see QUERY), but with one correction: a title
    carries its disambiguator ("Alan (footballer, born 1989)") and
    normalize_display_name strips it, which for a MONONYM leaves the single
    word "Alan" — a name_en so generic it would fuzzy-match half the deck and
    be useless on a card. When stripping leaves one word and the label has
    more, the label is the better name.
    """
    title = normalize_display_name(binding.get("enTitle", {}).get("value", "")).strip()
    label = normalize_display_name(binding.get("enLabel", {}).get("value", "")).strip()
    if title and len(title.split()) == 1 and len(label.split()) > 1:
        return label
    return title or label


def drop_display_collisions(rows):
    """Two people, one Russian name — keep the better-known one.

    Korean transliteration collapses names that ru.wikipedia keeps apart only
    by a disambiguator: "Чон У Ён (футболист, 1989)" and "…(футболист, 1999)"
    are Jung Woo-young and Jeong Woo-yeong, and stripping the suffix makes
    them one string. Inserting both would put two cards in the deck under the
    same visible name, resolving to the same article and racing to own it.

    `rows` must already be sorted with the most-linked first.
    """
    seen, out = set(), []
    for row in rows:
        key = row["name"].casefold()
        if key in seen:
            print(f"  × {row['name']} ({row['name_en']}) — то же ру-имя, что у более известного")
            continue
        seen.add(key)
        out.append(row)
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=80,
                        help="сколько кандидатов запрашивать на страну")
    parser.add_argument("--countries", default=",".join(COUNTRIES),
                        help="ISO-коды через запятую")
    parser.add_argument("--out", default=os.path.join(HERE, "cards_insert_missing_players.sql"))
    args = parser.parse_args()

    wanted = [c.strip().upper() for c in args.countries.split(",") if c.strip()]
    unknown = [c for c in wanted if c not in COUNTRIES]
    if unknown:
        parser.error(f"нет в COUNTRIES: {', '.join(unknown)}")

    rows = []
    for iso in wanted:
        qid, label = COUNTRIES[iso]
        print(f"{iso} ({label}) …", flush=True)
        found = sparql(QUERY % {"country": qid, "limit": args.limit})
        for binding in found:
            ru = normalize_display_name(binding["ruTitle"]["value"])
            en = english_name(binding)
            if not ru or not en:
                continue
            rows.append({
                "country": iso,
                "name": ru,
                "name_en": en,
                "links": int(binding["links"]["value"]),
            })
        print(f"  {len(found)} кандидатов с ру-статьёй", flush=True)

    rows.sort(key=lambda r: -r["links"])
    rows = drop_display_collisions(rows)
    rows.sort(key=lambda r: (r["country"], -r["links"]))
    print(f"\nВсего кандидатов: {len(rows)}")

    values = ",\n  ".join(
        "({}, {}, {})".format(
            sql_quote(r["name"]), sql_quote(r["name_en"]), sql_quote(r["country"]))
        for r in rows
    )

    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(HEADER)
        fh.write("with candidate (name, name_en, country) as (values\n  ")
        fh.write(values)
        fh.write("\n)\n")
        fh.write(TAIL)
    print(f"SQL записан: {args.out}")


HEADER = """-- Bare player cards for the countries the deck under-covers.
-- GENERATED by docs/cards_missing_by_country_preview.py — do not hand-edit;
-- re-run the script instead.
--
-- WHY THE DEDUPE IS IN SQL AND NOT IN THE GENERATOR. The deck spells the same
-- person more than one way: "Кейсуке Хонда" is already a card, ru.wikipedia
-- titles him "Кэйсукэ Хонда", and an exact key over either string treats them
-- as two people. The deck already carries one such pair — "Хын Мин Сон" and
-- "Сон Хын Мин", both name_en "Son Heung-min". Trigram similarity catches
-- what an equality check cannot, it lives in the database next to the rows it
-- is comparing, and running it here means the check happens against the deck
-- as it is AT INSERT TIME rather than as it was when the file was written.
--
-- Cards are inserted BARE on purpose: name, name_en, country, category and
-- forbidden_words, nothing else. docs/cards_enrich_newcomers.py resolves the
-- rest from the ru article — photo, facts, career, pageviews — and
-- cards_fame_refresh.py recomputes the percentile afterwards, because `fame`
-- is a rank and every new card moves the scale.
"""

TAIL = """-- The diacritic fold. "Wataru Endō" and "Wataru Endo" are one player, and
-- plain equality says they are two — the deck would gain a second Endo card
-- under a macron. Japanese and Korean names reach us romanised with macrons,
-- Spanish ones with acutes and tildes, so the fold is not an edge case here;
-- it is most of the batch. (unaccent is not installed on this database, hence
-- translate() rather than the extension.)
, folded as (
  select c.*,
         translate(lower(c.name_en),
                   'āēīōūáéíóúàèìòùâêîôûãõñçäëïöü',
                   'aeiouaeiouaeiouaeiouaoncaeiou') as en_key
    from candidate c
)
-- COUNTRY IS DELIBERATELY NOT WRITTEN HERE, though the candidate carries the
-- one we queried. P27 is multi-valued and these players are exactly the
-- population where that bites: Jonathan David answers a US query and is
-- Canadian, Zion Suzuki answers it and is Japanese, Bora Milutinović answers
-- Mexico and is Serbian. Writing "the citizenship whose query returned them"
-- would be a guess dressed as a fact. cards_enrich_newcomers resolves country
-- from the article, with run.iso_for_country's rule, the same way every other
-- card in this deck got one — and only into a column that is still NULL.
insert into cards (name, name_en, category, category_ru,
                   forbidden_words, active)
select c.name, c.name_en, 'player', 'игроки',
       -- build_forbidden_words in SQL: the whole name, then each token. A
       -- one-word name yields just itself, because the two coincide.
       case when position(' ' in c.name) = 0 then array[c.name]
            else array[c.name] || string_to_array(c.name, ' ') end,
       true
  from folded c
 where not exists (
   select 1 from cards x
    where x.category in ('player', 'woman')
      and (
        -- Same English name once folded, whatever the Cyrillic says. The
        -- strongest signal there is: two cards agreeing here are one person,
        -- and it is what catches "Кейсуке Хонда" vs "Кэйсукэ Хонда" — those
        -- two Russian spellings are only 0.47 similar and no threshold loose
        -- enough to join them is tight enough to be safe.
        translate(lower(coalesce(x.name_en, '')),
                  'āēīōūáéíóúàèìòùâêîôûãõñçäëïöü',
                  'aeiouaeiouaeiouaeiouaoncaeiou') = c.en_key
        -- …or near-identical spellings on either side, which is what catches
        -- a card whose name_en was written differently ("Rafael Márquez El
        -- piojo"). 0.62 is deliberately loose: a missed duplicate is a card
        -- the game shows twice under two names, a false positive is one
        -- notable player we do not add today.
        or similarity(lower(x.name), lower(c.name)) > 0.62
        or similarity(lower(coalesce(x.name_en, '')), lower(c.name_en)) > 0.62
      )
 )
   -- The file can carry the same person twice when two countries claim them.
   and not exists (
     select 1 from folded d where d.en_key = c.en_key and d.country < c.country
   )
returning name, name_en;
"""


if __name__ == "__main__":
    main()
