"""Pure parsing of ESPN's public soccer JSON — no network, no I/O.

WHY A SECOND SOURCE AT ALL. sports.ru resolves a slug for a player only if a
squad page listed them (Russian clubs) or a guessed slug verified (34 of the 40
most famous). Everyone else is simply absent from the ratings. ESPN is keyed by
league and match rather than by player, so it reaches the same players from the
other side — and it needs no key.

⚠️ ESPN DOES NOT GIVE MINUTES. `subbedIn` / `subbedOut` are BOOLEANS, not
timestamps: the payload says a player came on, never when. Goals, assists and
cards are exact; minutes are unknown, and unknown is written as None rather
than 0. Zero would be a lie with consequences — the rating breaks ties by
"fewer minutes for the same return", so a fabricated 0 would put ESPN rows
above players who actually earned the same points.

⚠️ THE SUMMARY PAYLOAD CARRIES BOOKMAKER ODDS (`odds`, `pickcenter`). Nothing
here reads them and nothing may: odds are internal-only in this project by the
rule in §4 of docs/LIVE_FOOTBALL_HANDOFF.md, and the safest way to honour that
is for the parser to never learn the keys exist.
"""

# Stat names as ESPN spells them. Taken from the payload, not from memory:
# every one of these was read off a real completed match.
STAT_GOALS = "totalGoals"
STAT_ASSISTS = "goalAssists"
STAT_YELLOW = "yellowCards"
STAT_RED = "redCards"
STAT_APPEARANCES = "appearances"


def _stat(entry, name, default=0):
    """Value of a named stat in ESPN's list-of-dicts shape."""
    for item in entry.get("stats") or []:
        if item.get("name") == name:
            value = item.get("value")
            if isinstance(value, (int, float)):
                return int(value)
            # `displayValue` is a string and is the only value present on some
            # payloads; a stat that cannot be read is 0, not a crash.
            try:
                return int(str(item.get("displayValue", "")).strip() or default)
            except ValueError:
                return default
    return default


def parse_match_date(summary):
    """`YYYY-MM-DD` of kickoff, or None.

    Taken from the header competition rather than from the request date: a
    match listed under 15 August can kick off at 23:30Z and belong to the 15th
    everywhere, and a scoreboard query for one day returns events from two.
    """
    header = summary.get("header") or {}
    for competition in header.get("competitions") or []:
        date = competition.get("date")
        if isinstance(date, str) and len(date) >= 10:
            return date[:10]
    return None


def parse_match_meta(summary):
    """{'date', 'league', 'home', 'away', 'home_score', 'away_score'} or None."""
    date = parse_match_date(summary)
    if not date:
        return None
    header = summary.get("header") or {}
    competitions = header.get("competitions") or []
    if not competitions:
        return None
    competitors = competitions[0].get("competitors") or []

    home = away = None
    home_score = away_score = None
    for side in competitors:
        name = (side.get("team") or {}).get("displayName")
        score = side.get("score")
        try:
            score = int(score) if score is not None else None
        except (TypeError, ValueError):
            score = None
        if side.get("homeAway") == "home":
            home, home_score = name, score
        elif side.get("homeAway") == "away":
            away, away_score = name, score

    # Some payloads omit homeAway; order in the list is home, away.
    if home is None and len(competitors) == 2:
        home = (competitors[0].get("team") or {}).get("displayName")
        away = (competitors[1].get("team") or {}).get("displayName")

    return {
        "date": date,
        "league": (header.get("league") or {}).get("name") or "",
        "home": home or "",
        "away": away or "",
        "home_score": home_score,
        "away_score": away_score,
    }


def parse_player_rows(summary):
    """One dict per player who was in a squad for this match.

    Keys: name, goals, assists, yellow, red, played, minutes (always None).

    A named substitute who never came on is included with `played=False`; the
    caller decides whether an unused substitute is worth a row. Dropping them
    here would hide the difference between "was not in the squad" and "was on
    the bench", which is exactly the distinction the local pipeline keeps.
    """
    rows = []
    for roster in summary.get("rosters") or []:
        for entry in roster.get("roster") or []:
            athlete = entry.get("athlete") or {}
            name = athlete.get("displayName") or athlete.get("fullName")
            if not name:
                continue
            played = bool(entry.get("starter")) or bool(entry.get("subbedIn"))
            if not played and _stat(entry, STAT_APPEARANCES) > 0:
                played = True
            rows.append(
                {
                    "name": name.strip(),
                    "goals": _stat(entry, STAT_GOALS),
                    "assists": _stat(entry, STAT_ASSISTS),
                    "yellow": _stat(entry, STAT_YELLOW),
                    "red": _stat(entry, STAT_RED),
                    "played": played,
                    # Not a placeholder to fill in later — ESPN has no such
                    # number. See the module docstring.
                    "minutes": None,
                }
            )
    return rows


def completed_event_ids(scoreboard):
    """Ids of matches that have actually finished.

    An in-progress match would be written and then never corrected: the
    pipeline upserts by (card, date, tournament), so a 60th-minute snapshot
    would sit there as the final line until someone noticed a striker stuck on
    one goal.
    """
    out = []
    for event in scoreboard.get("events") or []:
        status = ((event.get("status") or {}).get("type") or {})
        if status.get("completed") is True and event.get("id"):
            out.append(str(event["id"]))
    return out
