"""Offline tests for the ESPN payload parsers — NO network.

    python3 tests/test_espn.py

Fixtures are trimmed from a real completed MLS match read on 2026-08-16
(Atlanta United 2:1 Red Bull New York).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scraper.espn import (  # noqa: E402
    completed_event_ids,
    parse_match_date,
    parse_match_meta,
    parse_player_rows,
)


def check(label, got, want):
    status = "ok " if got == want else "FAIL"
    print("  [{}] {}: got={!r} want={!r}".format(status, label, got, want))
    return got == want


def stat(name, value, display=None):
    return {"name": name, "value": value,
            "displayValue": display if display is not None else str(value)}


def player(name, starter=False, subbed_in=False, goals=0, assists=0, yellow=0, red=0,
           appearances=1):
    return {
        "starter": starter,
        "subbedIn": subbed_in,
        "subbedOut": False,
        "athlete": {"displayName": name},
        "stats": [
            stat("appearances", appearances),
            stat("totalGoals", goals),
            stat("goalAssists", assists),
            stat("yellowCards", yellow),
            stat("redCards", red),
        ],
    }


SUMMARY = {
    "header": {
        "league": {"name": "MLS"},
        "competitions": [{
            "date": "2026-08-15T23:30Z",
            "competitors": [
                {"homeAway": "home", "score": "2", "team": {"displayName": "Atlanta United FC"}},
                {"homeAway": "away", "score": "1", "team": {"displayName": "Red Bull New York"}},
            ],
        }],
    },
    # The real payload also carries `odds` and `pickcenter`. Nothing here reads
    # them and nothing may — odds are internal-only in this project.
    "odds": [{"details": "irrelevant"}],
    "rosters": [
        {"roster": [
            player("Tristan Muyumba", starter=True, goals=1),
            player("Miguel Almirón", starter=True, assists=1),
            player("Unused Sub", appearances=0),
        ]},
        {"roster": [
            player("Emil Forsberg", subbed_in=True, goals=1),
            player("Mohammed Sofo", starter=True, yellow=1),
        ]},
    ],
}


def main():
    ok = True

    # ---- match metadata --------------------------------------------------
    ok &= check("date from header", parse_match_date(SUMMARY), "2026-08-15")
    meta = parse_match_meta(SUMMARY)
    ok &= check("league", meta["league"], "MLS")
    ok &= check("home", meta["home"], "Atlanta United FC")
    ok &= check("away", meta["away"], "Red Bull New York")
    ok &= check("score", (meta["home_score"], meta["away_score"]), (2, 1))

    # homeAway is what decides which side is home — NOT list order, which some
    # payloads reverse. Getting it backwards silently swaps every scoreline.
    reversed_sides = {
        "header": {"league": {"name": "MLS"}, "competitions": [{
            "date": "2026-08-15T23:30Z",
            "competitors": [
                {"homeAway": "away", "score": "1", "team": {"displayName": "Гости"}},
                {"homeAway": "home", "score": "2", "team": {"displayName": "Хозяева"}},
            ],
        }]},
    }
    m2 = parse_match_meta(reversed_sides)
    ok &= check("home read from homeAway", m2["home"], "Хозяева")
    ok &= check("home score follows", m2["home_score"], 2)

    ok &= check("no header -> no meta", parse_match_meta({}), None)
    ok &= check("no date -> no meta", parse_match_meta(
        {"header": {"competitions": [{}]}}), None)

    # ---- player rows -----------------------------------------------------
    rows = parse_player_rows(SUMMARY)
    ok &= check("both rosters read", len(rows), 5)
    by_name = {r["name"]: r for r in rows}
    ok &= check("goal", by_name["Tristan Muyumba"]["goals"], 1)
    ok &= check("assist", by_name["Miguel Almirón"]["assists"], 1)
    ok &= check("yellow", by_name["Mohammed Sofo"]["yellow"], 1)

    # ⚠️ MINUTES ARE UNKNOWN, NOT ZERO. ESPN's subbedIn/subbedOut are booleans:
    # the payload says a player came on, never when. A fabricated 0 would win
    # the rating's "fewer minutes for the same return" tie-break against
    # players who actually earned it.
    ok &= check("minutes unknown", by_name["Tristan Muyumba"]["minutes"], None)
    ok &= check("no minutes anywhere",
                {r["minutes"] for r in rows}, {None})

    ok &= check("starter played", by_name["Tristan Muyumba"]["played"], True)
    ok &= check("substitute played", by_name["Emil Forsberg"]["played"], True)
    # A named substitute who never came on is kept but marked: "was on the
    # bench" and "was not in the squad" are different facts.
    ok &= check("unused sub kept, not played", by_name["Unused Sub"]["played"], False)

    ok &= check("empty payload", parse_player_rows({}), [])
    ok &= check("roster without athletes", parse_player_rows({"rosters": [{"roster": []}]}), [])
    # An entry with no name is not a player row.
    ok &= check("nameless entry dropped",
                parse_player_rows({"rosters": [{"roster": [{"stats": []}]}]}), [])

    # Missing stats read as 0 rather than raising: one odd payload must not
    # take down a night's collection.
    bare = {"rosters": [{"roster": [{"athlete": {"displayName": "X"}, "starter": True}]}]}
    ok &= check("missing stats -> zeros", parse_player_rows(bare)[0]["goals"], 0)

    # A value that is only a string still parses.
    strung = {"rosters": [{"roster": [{
        "athlete": {"displayName": "Y"}, "starter": True,
        "stats": [{"name": "totalGoals", "displayValue": "2"}],
    }]}]}
    ok &= check("string stat parsed", parse_player_rows(strung)[0]["goals"], 2)

    # ---- scoreboard ------------------------------------------------------
    board = {"events": [
        {"id": "1", "status": {"type": {"completed": True}}},
        # In-progress must be skipped: the pipeline upserts by
        # (card, date, tournament), so a 60th-minute snapshot would sit there
        # as the final line until somebody noticed.
        {"id": "2", "status": {"type": {"completed": False}}},
        {"id": "3", "status": {"type": {}}},
        {"status": {"type": {"completed": True}}},
    ]}
    ok &= check("only completed events", completed_event_ids(board), ["1"])
    ok &= check("empty board", completed_event_ids({}), [])

    print("\n{}".format("ALL TESTS PASSED" if ok else "SOME TESTS FAILED"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
