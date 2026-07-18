"""Offline tests for the pageviews parsing/helpers — NO network.

Run from the football_scraper/ directory:
    python3 -m tests.test_pageviews
or:
    python3 tests/test_pageviews.py
"""
import os
import sys
from datetime import date

# Allow running the file directly (python3 tests/test_pageviews.py).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scraper.pageviews import (  # noqa: E402
    PROJECT_EN,
    PROJECT_RU,
    resolve_article,
    season_window,
    sum_views,
)


# A realistic Wikimedia per-article monthly response (trimmed). Three months
# for one player; views are what we must sum.
FAKE_PAYLOAD = {
    "items": [
        {
            "project": "ru.wikipedia",
            "article": "Холанн,_Эрлинг",
            "granularity": "monthly",
            "timestamp": "2023080100",
            "agent": "user",
            "views": 120000,
        },
        {
            "project": "ru.wikipedia",
            "article": "Холанн,_Эрлинг",
            "granularity": "monthly",
            "timestamp": "2023090100",
            "agent": "user",
            "views": 95000,
        },
        {
            "project": "ru.wikipedia",
            "article": "Холанн,_Эрлинг",
            "granularity": "monthly",
            "timestamp": "2023100100",
            "agent": "user",
            "views": 80500,
        },
    ]
}


def check(label, got, want):
    status = "ok " if got == want else "FAIL"
    print("  [{}] {}: got={!r} want={!r}".format(status, label, got, want))
    return got == want


def main():
    ok = True

    # --- sum_views -------------------------------------------------------
    ok &= check("sum three months", sum_views(FAKE_PAYLOAD), 120000 + 95000 + 80500)
    ok &= check("empty items", sum_views({"items": []}), 0)
    ok &= check("no items key", sum_views({}), 0)
    ok &= check("None payload (404)", sum_views(None), 0)
    ok &= check(
        "missing/odd views ignored",
        sum_views({"items": [{"views": 10}, {}, {"views": None}, {"views": 5}]}),
        15,
    )
    ok &= check(
        "bool not counted as int",
        sum_views({"items": [{"views": True}, {"views": 7}]}),
        7,
    )

    # --- season_window (default Aug 1 -> next-year Jun 30) ----------------
    start, end = season_window(2023)
    ok &= check("2023 start", start, date(2023, 8, 1))
    ok &= check("2023 end", end, date(2024, 6, 30))

    # Custom window: calendar year, same year.
    cstart, cend = season_window(
        2022,
        {"start_month": 1, "start_day": 1, "end_month": 12, "end_day": 31,
         "end_year_offset": 0},
    )
    ok &= check("custom calendar start", cstart, date(2022, 1, 1))
    ok &= check("custom calendar end", cend, date(2022, 12, 31))

    # Pre-2015 season clamps the start to the Pageviews epoch.
    estart, _ = season_window(2014)
    ok &= check("epoch clamp", estart, date(2015, 7, 1))

    # --- resolve_article (offline; no enricher network) ------------------
    ru = resolve_article(
        {"name_ru": "Холанд, Эрлинг", "name_en": "Erling Haaland",
         "wikidata_qid": "Q42"},
        enricher=None,
        allow_network=False,
    )
    ok &= check("prefers name_ru", ru, (PROJECT_RU, "Холанд, Эрлинг", "name_ru"))

    en = resolve_article(
        {"name_ru": None, "name_en": "Erling Haaland", "wikidata_qid": "Q42"},
        enricher=None,
        allow_network=False,
    )
    ok &= check(
        "falls back to name_en (no network)",
        en,
        (PROJECT_EN, "Erling Haaland", "name_en"),
    )

    nothing = resolve_article(
        {"name_ru": None, "name_en": None, "wikidata_qid": None},
        enricher=None,
        allow_network=False,
    )
    ok &= check("no fields -> none", nothing, (None, None, "none"))

    # With a fake enricher, a QID resolves via ruwiki sitelink.
    class FakeEnricher:
        def titles_for_qid(self, qid):
            return {"ruwiki": "Холанд, Эрлинг", "enwiki": "Erling Haaland"}

    via_qid = resolve_article(
        {"name_ru": None, "name_en": "Erling Haaland", "wikidata_qid": "Q42"},
        enricher=FakeEnricher(),
        allow_network=True,
    )
    ok &= check(
        "qid -> ruwiki sitelink",
        via_qid,
        (PROJECT_RU, "Холанд, Эрлинг", "qid_ruwiki"),
    )

    print("\n{}".format("ALL TESTS PASSED" if ok else "SOME TESTS FAILED"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
