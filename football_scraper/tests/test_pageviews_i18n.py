"""Offline tests for docs/cards_pageviews_i18n.py (no network, no DB).

Covers the two things that decide whether a card gets HONEST language views:

  * the maxlag detection. MediaWiki answers "the database is lagging" with
    HTTP **200** and an error body, so the old code took it for success: the
    batch came back with no entities, every card in it was reported
    unresolvable, and the run ended "successfully" having written nothing.
    A silent zero is the one failure CI cannot see;

  * the resolution split. Players resolve by their bare name (it IS the
    article title); everything else must go through the pipeline resolver,
    because a club's bare name is usually a city, a planet or a common noun
    — «Зенит» in ru-wiki is the astronomical zenith.

    python3 tests/test_pageviews_i18n.py
"""
import importlib.util
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SCRAPER = os.path.dirname(HERE)
REPO = os.path.dirname(SCRAPER)
sys.path.insert(0, SCRAPER)

_spec = importlib.util.spec_from_file_location(
    "cards_pageviews_i18n", os.path.join(REPO, "docs", "cards_pageviews_i18n.py"))
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)

FAILURES = []


def check(label, got, want):
    if got == want:
        print("ok    {}".format(label))
    else:
        FAILURES.append("{}: got={!r} want={!r}".format(label, got, want))
        print("FAIL  {}: got={!r} want={!r}".format(label, got, want))


def check_true(label, value):
    check(label, bool(value), True)


def check_false(label, value):
    check(label, bool(value), False)


class FakeResponse:
    def __init__(self, status=200, body=None, text=None, headers=None):
        self.status_code = status
        self._body = body
        self.text = text if text is not None else json.dumps(body or {})
        self.headers = headers or {}

    def json(self):
        if self._body is None:
            raise ValueError("not json")
        return self._body

    def raise_for_status(self):
        if self.status_code >= 400:
            raise AssertionError("raise_for_status on {}".format(self.status_code))


MAXLAG_BODY = {"error": {"code": "maxlag", "info": "Waiting for wdqs1016",
                         "type": "wikibase-queryservice", "lag": 14.5}}

# --------------------------------------------------------------------------
# is_maxlag — the HTTP 200 that means failure
# --------------------------------------------------------------------------
check_true("maxlag: ошибка в теле при HTTP 200 распознана",
           m.is_maxlag(FakeResponse(200, MAXLAG_BODY)))
check_false("maxlag: обычный успешный ответ — не maxlag",
            m.is_maxlag(FakeResponse(200, {"entities": {"Q1": {}}})))
check_false("maxlag: другая ошибка API — не maxlag",
            m.is_maxlag(FakeResponse(200, {"error": {"code": "badvalue"}})))
check_false("maxlag: не-JSON тело не роняет проверку",
            m.is_maxlag(FakeResponse(200, None, text="<html>502</html>")))
check_false("maxlag: HTTP 503 идёт своей веткой, не этой",
            m.is_maxlag(FakeResponse(503, MAXLAG_BODY)))


# --------------------------------------------------------------------------
# get_with_retry — backs off, then stops asking for maxlag
# --------------------------------------------------------------------------
class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def get(self, url, params=None, timeout=None):
        self.calls.append(dict(params or {}))
        return self.responses.pop(0)


class NoSleep:
    def __init__(self):
        self.slept = []

    def sleep(self, seconds):
        self.slept.append(seconds)

    def monotonic(self):
        return 0.0


_real_session, _real_time = m.session, m.time
ok_body = {"entities": {"Q29108": {"sitelinks": {}}}}
m.session = FakeSession([FakeResponse(200, MAXLAG_BODY),
                         FakeResponse(200, MAXLAG_BODY),
                         FakeResponse(200, ok_body)])
m.time = NoSleep()
resp = m.get_with_retry("https://www.wikidata.org/w/api.php",
                        params={"action": "wbgetentities", "maxlag": "5"})
check("maxlag: в итоге возвращён успешный ответ", resp.json(), ok_body)
check("maxlag: понадобилось три запроса", len(m.session.calls), 3)
check_true("maxlag: первый запрос ещё с maxlag", "maxlag" in m.session.calls[0])
check_false("maxlag: последний запрос уже без maxlag",
            "maxlag" in m.session.calls[2])
check_true("maxlag: перед снятием параметра всё-таки подождали",
           len(m.time.slept) >= 1)

# A caller's params dict must not be mutated — the loop pops 'maxlag' from
# its own copy, or the next batch would silently go out unthrottled.
caller_params = {"action": "wbgetentities", "maxlag": "5"}
m.session = FakeSession([FakeResponse(200, MAXLAG_BODY),
                         FakeResponse(200, MAXLAG_BODY),
                         FakeResponse(200, ok_body)])
m.time = NoSleep()
m.get_with_retry("https://www.wikidata.org/w/api.php", params=caller_params)
check_true("maxlag: словарь вызывающего не изменён",
           "maxlag" in caller_params)

# Lag that never clears must RAISE, not return an empty result that reads as
# "no card resolved".
m.session = FakeSession([FakeResponse(200, MAXLAG_BODY)] * 5)
m.time = NoSleep()
try:
    m.get_with_retry("https://www.wikidata.org/w/api.php",
                     params={"maxlag": "5"})
    check("maxlag: неразошедшееся отставание поднимает ошибку", "вернул", "исключение")
except Exception as exc:                                    # noqa: BLE001
    check_true("maxlag: неразошедшееся отставание поднимает ошибку",
               "maxlag" in str(exc))

m.session, m.time = _real_session, _real_time


# --------------------------------------------------------------------------
# resolve_chunk — players by name, everything else through the guard
# --------------------------------------------------------------------------
_real_qids = m.qids_for_ru_titles
_real_resolve = m.resolve_non_player
_real_links = m.sitelinks_for_qids

seen = {"batched": [], "pipeline": []}


def fake_qids_for_ru_titles(titles):
    seen["batched"] += list(titles)
    return {t: "Q_player_" + t for t in titles}


def fake_resolve_non_player(card):
    seen["pipeline"].append(card["name"])
    # «Зенит» is the card the guard saves; «Брест» is the one it refuses.
    return None if card["name"] == "Брест" else "Q_club_" + card["name"]


def fake_sitelinks_for_qids(qids):
    return {q: {"ru": q + "_ru", "fr": q + "_fr"} for q in qids if q}


m.qids_for_ru_titles = fake_qids_for_ru_titles
m.resolve_non_player = fake_resolve_non_player
m.sitelinks_for_qids = fake_sitelinks_for_qids

chunk = [
    {"id": "1", "name": "Лионель Месси", "category": "player"},
    {"id": "2", "name": "Зенит",         "category": "club"},
    {"id": "3", "name": "Брест",         "category": "club"},
    {"id": "4", "name": "Уэмбли",        "category": "stadium"},
]
links = m.resolve_chunk(chunk)

check("резолв: игрок ушёл в батч по имени", seen["batched"], ["Лионель Месси"])
check("резолв: неигровые ушли в конвейер с гардом",
      sorted(seen["pipeline"]), ["Брест", "Зенит", "Уэмбли"])
check_false("резолв: игрок НЕ идёт через конвейер",
            "Лионель Месси" in seen["pipeline"])
check("резолв: у клуба есть сайтлинки", links["2"],
      {"ru": "Q_club_Зенит_ru", "fr": "Q_club_Зенит_fr"})
# The refused card must come back as an empty mapping, which main() reports
# and skips — NOT as a missing key that would raise, and not as someone
# else's article.
check("резолв: отбракованная карточка даёт пустой словарь", links["3"], {})
check_true("резолв: у каждой карточки чанка есть запись",
           all(c["id"] in links for c in chunk))

m.qids_for_ru_titles = _real_qids
m.resolve_non_player = _real_resolve
m.sitelinks_for_qids = _real_links


# --------------------------------------------------------------------------
# LANGS — ru is collected like any other language
# --------------------------------------------------------------------------
check_true("LANGS: ru собирается наравне с остальными", "ru" in m.LANGS)
check("LANGS: все девять языков приложения", sorted(m.LANGS),
      sorted(["ru", "en", "es", "pt", "fr", "zh", "ja", "ko", "ar"]))

# --------------------------------------------------------------------------
print("-" * 60)
if FAILURES:
    print("ПРОВАЛЕНО {} проверок:".format(len(FAILURES)))
    for f in FAILURES:
        print("  " + f)
    sys.exit(1)
print("Все проверки пройдены.")
