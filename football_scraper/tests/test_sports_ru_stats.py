"""Offline tests for sports_ru_stats.py's own matching logic — NO network.

Run from the football_scraper/ directory:
    python3 -m tests.test_sports_ru_stats
or:
    python3 tests/test_sports_ru_stats.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sports_ru_stats import active_cards_by_key  # noqa: E402


def check(label, got, want):
    status = "ok " if got == want else "FAIL"
    print("  [{}] {}: got={!r} want={!r}".format(status, label, got, want))
    return got == want


def _card(card_id, name):
    return {"id": card_id, "name": name, "name_en": ""}


def test_active_cards_by_key():
    ok = True

    # The measured case: a retired legend's bare-name card, no current club —
    # excluded, so a squad page listing an unrelated active "Роналдо" has
    # nothing to wrongly match against.
    cards = [_card("legend", "Роналдо")]
    ok &= check("retired namesake excluded", active_cards_by_key(cards, set()), {})

    # An active player with a current club is included as before.
    cards = [_card("active", "Килиан Мбаппе")]
    ok &= check(
        "active player included",
        active_cards_by_key(cards, {"active"}),
        {"килианмбаппе": _card("active", "Килиан Мбаппе")},
    )

    # Mixed pool: only the one with a current club survives.
    cards = [_card("legend", "Роналдо"), _card("active", "Килиан Мбаппе")]
    got = active_cards_by_key(cards, {"active"})
    ok &= check("mixed pool keeps only the active one", len(got), 1)
    ok &= check("mixed pool keeps the right one", list(got.values())[0]["id"], "active")

    # Two cards sharing a canonical_key: first one wins, same as the
    # pre-existing dict.setdefault behaviour this function preserves.
    cards = [_card("first", "Данило"), _card("second", "Данило")]
    got = active_cards_by_key(cards, {"first", "second"})
    ok &= check("duplicate key: first wins", len(got), 1)
    ok &= check("duplicate key: first wins (id)", list(got.values())[0]["id"], "first")

    return ok


def main():
    print("test_sports_ru_stats.py")
    ok = test_active_cards_by_key()
    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
