"""Offline tests for espn_stats.py's own matching logic — NO network.

Run from the football_scraper/ directory:
    python3 -m tests.test_espn_stats
or:
    python3 tests/test_espn_stats.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from espn_stats import active_cards_by_key, card_key  # noqa: E402


def check(label, got, want):
    status = "ok " if got == want else "FAIL"
    print("  [{}] {}: got={!r} want={!r}".format(status, label, got, want))
    return got == want


def _card(card_id, name_en):
    return {"id": card_id, "name": "", "name_en": name_en}


def test_active_cards_by_key():
    ok = True

    # The measured case, ESPN's side of it: a retired legend's bare-name card
    # (name_en "Ronaldo"), no current club — excluded, so a currently-active
    # same-named player on some league's roster has nothing to wrongly match
    # against. See docs/namesake_fixes.sql.
    cards = [_card("legend", "Ronaldo")]
    ok &= check("retired namesake excluded", active_cards_by_key(cards, set()), {})

    # An active player with a current club is included as before.
    cards = [_card("active", "Kylian Mbappe")]
    ok &= check(
        "active player included",
        active_cards_by_key(cards, {"active"}),
        {card_key("Kylian Mbappe"): _card("active", "Kylian Mbappe")},
    )

    # Mixed pool: only the one with a current club survives.
    cards = [_card("legend", "Ronaldo"), _card("active", "Kylian Mbappe")]
    got = active_cards_by_key(cards, {"active"})
    ok &= check("mixed pool keeps only the active one", len(got), 1)
    ok &= check("mixed pool keeps the right one", list(got.values())[0]["id"], "active")

    # Two cards sharing a card_key: first one wins, same setdefault behaviour
    # the un-guarded loop in collect() had before.
    cards = [_card("first", "Danilo"), _card("second", "Danilo")]
    got = active_cards_by_key(cards, {"first", "second"})
    ok &= check("duplicate key: first wins", len(got), 1)
    ok &= check("duplicate key: first wins (id)", list(got.values())[0]["id"], "first")

    return ok


def main():
    print("test_espn_stats.py")
    ok = test_active_cards_by_key()
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
