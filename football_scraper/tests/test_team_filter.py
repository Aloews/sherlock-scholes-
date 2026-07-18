"""Offline tests for the explicit club-list matcher — NO network.

Run from the football_scraper/ directory:
    python3 -m tests.test_team_filter
or:
    python3 tests/test_team_filter.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scraper.team_filter import select_teams, team_names_match  # noqa: E402


def check(label, got, want):
    status = "ok " if got == want else "FAIL"
    print("  [{}] {}: got={!r} want={!r}".format(status, label, got, want))
    return got == want


def main():
    ok = True

    # Exact / case-insensitive.
    ok &= check("exact ci", team_names_match("Barcelona", "barcelona"), True)
    # Token-subset: shorter config / shorter API both match.
    ok &= check("config superset of api", team_names_match("Real Betis", "Betis"), True)
    ok &= check("api superset of config", team_names_match("Monaco", "AS Monaco"), True)
    ok &= check("Werder subset", team_names_match("Werder Bremen", "SV Werder Bremen"), True)
    # Diacritic / spelling variant via difflib.
    ok &= check("munich vs munchen", team_names_match("Bayern Munich", "Bayern München"), True)
    ok &= check("hyphen psg", team_names_match("Paris Saint Germain", "Paris Saint-Germain"), True)
    # Must NOT match different clubs sharing a word.
    ok &= check("real madrid != real betis", team_names_match("Real Madrid", "Real Betis"), False)
    ok &= check("atletico != athletic", team_names_match("Atletico Madrid", "Athletic Club"), False)
    ok &= check("inter != empty", team_names_match("Inter", ""), False)

    # select_teams: realistic Serie A response (subset of clubs + extras).
    api_teams = [
        {"id": 505, "name": "Inter"},
        {"id": 489, "name": "AC Milan"},
        {"id": 496, "name": "Juventus"},
        {"id": 499, "name": "Atalanta"},
        {"id": 495, "name": "Genoa"},
        {"id": 494, "name": "Udinese"},
        {"id": 500, "name": "Bologna"},
        {"id": 867, "name": "Lecce"},
        {"id": 497, "name": "AS Roma"},
        {"id": 487, "name": "Lazio"},          # not in the wanted list
        {"id": 502, "name": "Fiorentina"},     # not in the wanted list
    ]
    wanted = ["Inter", "AC Milan", "Juventus", "Atalanta", "Genoa",
              "Udinese", "Bologna", "Lecce", "AS Roma"]
    selected, missing = select_teams(api_teams, wanted)
    ok &= check("serie a selected count", len(selected), 9)
    ok &= check("serie a no missing", missing, [])
    ok &= check("serie a excludes Lazio",
                any(t["name"] == "Lazio" for t in selected), False)
    ok &= check("serie a preserves config order",
                [t["name"] for t in selected][:3], ["Inter", "AC Milan", "Juventus"])

    # A club the API spells unrecognisably ends up in `missing`, not crashing.
    selected2, missing2 = select_teams(
        [{"id": 1, "name": "Real Madrid"}],
        ["Real Madrid", "Atletico Madrid"],
    )
    ok &= check("missing club reported", missing2, ["Atletico Madrid"])
    ok &= check("found club still selected", [t["name"] for t in selected2], ["Real Madrid"])

    # Dedup by id: the same API team matched twice is kept once.
    selected3, _ = select_teams(
        [{"id": 7, "name": "AS Monaco"}],
        ["Monaco", "AS Monaco"],
    )
    ok &= check("dedup by id", len(selected3), 1)

    print("\n{}".format("ALL TESTS PASSED" if ok else "SOME TESTS FAILED"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
