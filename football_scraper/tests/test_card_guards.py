"""Offline tests for the card-resolution guards (no network, no DB).

Covers the two fixes that stop a card from being resolved to the wrong page:
the people/mononym guard in make_card_qid_validator, and the title order used
by --cards-pageviews (which used to measure a club by its city).

    python3 tests/test_card_guards.py
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCRAPER = os.path.dirname(HERE)
sys.path.insert(0, SCRAPER)

import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "run", os.path.join(SCRAPER, "run.py"))
run = importlib.util.module_from_spec(_spec)
sys.modules["run"] = run
_spec.loader.exec_module(run)

FAILURES = []


def check(label, got, want):
    if got != want:
        FAILURES.append("{}\n    ожидалось: {!r}\n    получено : {!r}".format(
            label, want, got))
        print("FAIL  {}".format(label))
    else:
        print("ok    {}".format(label))


def check_true(label, got):
    check(label, bool(got), True)


def check_false(label, got):
    check(label, bool(got), False)


# --------------------------------------------------------------------------
# fakes: a Wikidata whose answers we control, and a cache that always hits so
# the budget is never touched (a real consume() would need a live budget file)
# --------------------------------------------------------------------------
class FakeWikidata:
    def __init__(self, p31=None, p106=None):
        self.p31 = p31 or {}
        self.p106 = p106 or {}

    def instance_of_qids(self, qid):
        return list(self.p31.get(qid, []))

    def claim_item_ids(self, qid, prop):
        return list((self.p106 if prop == "P106" else {}).get(qid, []))


class WarmCache:
    """Every lookup is a hit, so make_card_qid_validator never consumes."""
    def get(self, namespace, key):
        return {}


class NoBudget:
    def consume(self):
        raise AssertionError("бюджет не должен тратиться на кеш-попадание")


HUMAN = ["Q5"]
FOOTBALLER = [run.FOOTBALLER_OCCUPATION]
POET = ["Q49757", "Q4964182"]          # poet, philosopher — Dante Alighieri
CLUB = ["Q476028"]                      # association football club
CITY = ["Q7930989", "Q515"]             # city/town — Краснодар

# --------------------------------------------------------------------------
# mononym player cards: Q5 is not enough, occupation decides
# --------------------------------------------------------------------------
wd = FakeWikidata(p31={"Q_dante_poet": HUMAN, "Q_dante_player": HUMAN},
                  p106={"Q_dante_poet": POET, "Q_dante_player": FOOTBALLER})
validator = run.make_card_qid_validator(
    {"category": "player", "name": "Данте"}, wd, WarmCache(), NoBudget())
check_true("мононим «Данте»: футболист принимается", validator("Q_dante_player"))
check_false("мононим «Данте»: поэт отбраковывается", validator("Q_dante_poet"))

# Hadrian: a human, but an emperor — must not take the «Адриан» card.
wd_h = FakeWikidata(p31={"Q_hadrian": HUMAN}, p106={"Q_hadrian": ["Q842606"]})
v_h = run.make_card_qid_validator(
    {"category": "player", "name": "Адриан"}, wd_h, WarmCache(), NoBudget())
check_false("мононим «Адриан»: римский император отбраковывается",
            v_h("Q_hadrian"))

# A city is not a person at all — rejected by P31 before occupation matters.
wd_c = FakeWikidata(p31={"Q_city": CITY})
v_c = run.make_card_qid_validator(
    {"category": "player", "name": "Крис"}, wd_c, WarmCache(), NoBudget())
check_false("мононим-игрок: город отбраковывается по P31", v_c("Q_city"))

# --------------------------------------------------------------------------
# multi-word player names: occupation is NOT required, so an incomplete
# Wikidata item cannot lose a resolution that is already correct
# --------------------------------------------------------------------------
wd_m = FakeWikidata(p31={"Q_nobody": HUMAN}, p106={})   # no P106 at all
v_m = run.make_card_qid_validator(
    {"category": "player", "name": "Стефан Лихтштайнер"}, wd_m,
    WarmCache(), NoBudget())
check_true("составное имя: человек без P106 всё равно принимается",
           v_m("Q_nobody"))
v_m2 = run.make_card_qid_validator(
    {"category": "player", "name": "Стефан Лихтштайнер"},
    FakeWikidata(p31={"Q_city": CITY}), WarmCache(), NoBudget())
check_false("составное имя: город всё равно отбраковывается", v_m2("Q_city"))

# --------------------------------------------------------------------------
# is_mononym
# --------------------------------------------------------------------------
check_true("«Педро» — мононим", run.is_mononym("Педро"))
check_true("«Данте» — мононим", run.is_mononym("Данте"))
check_false("«Эзри Конса» — не мононим", run.is_mononym("Эзри Конса"))
check_false("пустое имя — не мононим", run.is_mononym(""))
check_false("None — не мононим", run.is_mononym(None))

# --------------------------------------------------------------------------
# other people categories keep the plain human guard
# --------------------------------------------------------------------------
for category in ("coach", "referee", "commentator"):
    v = run.make_card_qid_validator(
        {"category": category, "name": "Юрген Клопп"},
        FakeWikidata(p31={"Q_h": HUMAN}), WarmCache(), NoBudget())
    check_true("{}: человек принимается".format(category), v("Q_h"))
    v2 = run.make_card_qid_validator(
        {"category": category, "name": "Юрген Клопп"},
        FakeWikidata(p31={"Q_club": CLUB}), WarmCache(), NoBudget())
    check_false("{}: клуб отбраковывается".format(category), v2("Q_club"))

# --------------------------------------------------------------------------
# title order — the club/city bug behind «Краснодар» = 767k
# --------------------------------------------------------------------------
club_titles = run.cards_photos_candidates({"category": "club", "name": "Краснодар"})
check("клуб: сначала уточнённый заголовок, потом голое имя",
      club_titles[:2], ["Краснодар (футбольный клуб)", "Краснодар"])
check_true("клуб: голое имя (город) НЕ первое",
           club_titles[0] != "Краснодар")

stadium_titles = run.cards_photos_candidates(
    {"category": "stadium", "name": "Сантьяго Бернабеу"})
check_true("стадион: уточнённый заголовок первым",
           stadium_titles[0] == "Сантьяго Бернабеу (стадион)")

player_titles = run.cards_photos_candidates(
    {"category": "player", "name": "Лионель Месси"})
check_true("игрок: точное имя первым (уточнение — запасной вариант)",
           player_titles[0] == "Лионель Месси")

# The pageviews mode must use exactly this order — the old CARDS_PV_VARIANTS
# table put the bare name first and is now reference-only.
check_true("у клуба варианты заголовков непусты",
           len(club_titles) >= 2)

# --------------------------------------------------------------------------
print("-" * 60)
if FAILURES:
    print("ПРОВАЛЕНО {} проверок:".format(len(FAILURES)))
    for f in FAILURES:
        print("  " + f)
    sys.exit(1)
print("Все проверки пройдены.")
