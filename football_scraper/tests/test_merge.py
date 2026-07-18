"""Offline tests for the players_meta name-quality merge guard — NO network.

Run from the football_scraper/ directory:
    python3 -m tests.test_merge
or:
    python3 tests/test_merge.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scraper.supabase_writer import merge_player_name  # noqa: E402


def _incoming(name_ru, conf, qid=None, name_en="Player"):
    return {
        "api_football_id": 1,
        "name_en": name_en,
        "name_ru": name_ru,
        "name_source": "wikidata" if name_ru else "none",
        "name_confidence": conf,
        "wikidata_qid": qid,
        "updated_at": "2026-06-06T00:00:00+00:00",
    }


def _existing(name_ru, conf, qid=None):
    return {
        "api_football_id": 1,
        "name_ru": name_ru,
        "name_source": "wikidata" if name_ru else "none",
        "name_confidence": conf,
        "wikidata_qid": qid,
    }


def check(label, got, want):
    status = "ok " if got == want else "FAIL"
    print("  [{}] {}: got={!r} want={!r}".format(status, label, got, want))
    return got == want


def main():
    ok = True

    # 1. high in DB, incoming null/low -> keep high, guard fires (preserved).
    row, preserved = merge_player_name(
        _existing("Холанд, Эрлинг", "high", "Q42"), _incoming(None, "none")
    )
    ok &= check("high vs null: name kept", row["name_ru"], "Холанд, Эрлинг")
    ok &= check("high vs null: conf kept", row["name_confidence"], "high")
    ok &= check("high vs null: qid kept", row["wikidata_qid"], "Q42")
    ok &= check("high vs null: preserved", preserved, True)

    row, preserved = merge_player_name(
        _existing("Холанд, Эрлинг", "high", "Q42"),
        _incoming("Erling", "low", "Q99"),
    )
    ok &= check("high vs low: name kept", row["name_ru"], "Холанд, Эрлинг")
    ok &= check("high vs low: qid kept", row["wikidata_qid"], "Q42")
    ok &= check("high vs low: preserved", preserved, True)

    # 2. low in DB, incoming high -> upgrade, guard does NOT fire.
    row, preserved = merge_player_name(
        _existing("Эрлинг", "low", "Q99"),
        _incoming("Холанд, Эрлинг", "high", "Q42"),
    )
    ok &= check("low->high: name updated", row["name_ru"], "Холанд, Эрлинг")
    ok &= check("low->high: conf updated", row["name_confidence"], "high")
    ok &= check("low->high: qid updated", row["wikidata_qid"], "Q42")
    ok &= check("low->high: not preserved", preserved, False)

    # 3. empty in DB -> any non-empty fills it (even low).
    row, preserved = merge_player_name(
        _existing(None, "none", None), _incoming("Эрлинг", "low", "Q99")
    )
    ok &= check("empty<-low: name filled", row["name_ru"], "Эрлинг")
    ok &= check("empty<-low: not preserved", preserved, False)

    # 4. empty in DB, incoming also empty -> stays empty, nothing to protect.
    row, preserved = merge_player_name(
        _existing(None, "none", None), _incoming(None, "none", None)
    )
    ok &= check("empty<-empty: name still null", row["name_ru"], None)
    ok &= check("empty<-empty: not preserved", preserved, False)

    # 5. equal confidence, incoming non-empty -> takes incoming (>=), no guard.
    row, preserved = merge_player_name(
        _existing("Старое", "high", "Q1"), _incoming("Новое", "high", "Q2")
    )
    ok &= check("high==high: takes incoming", row["name_ru"], "Новое")
    ok &= check("high==high: qid incoming", row["wikidata_qid"], "Q2")
    ok &= check("high==high: not preserved", preserved, False)

    # 6. brand-new player (no existing row) -> incoming as-is, no guard.
    incoming = _incoming("Холанд", "high", "Q42")
    row, preserved = merge_player_name(None, incoming)
    ok &= check("new player: name", row["name_ru"], "Холанд")
    ok &= check("new player: not preserved", preserved, False)

    # 7. non-name fields always come from incoming, even when name is kept.
    row, _ = merge_player_name(
        _existing("Холанд, Эрлинг", "high", "Q42"),
        _incoming(None, "none", name_en="Erling Braut Haaland"),
    )
    ok &= check("name_en always incoming", row["name_en"], "Erling Braut Haaland")
    ok &= check(
        "updated_at always incoming",
        row["updated_at"],
        "2026-06-06T00:00:00+00:00",
    )

    # 8. blank-string (whitespace) incoming name is treated as empty.
    row, preserved = merge_player_name(
        _existing("Холанд", "high", "Q42"), _incoming("   ", "high")
    )
    ok &= check("whitespace incoming kept old", row["name_ru"], "Холанд")
    ok &= check("whitespace incoming: preserved", preserved, True)

    print("\n{}".format("ALL TESTS PASSED" if ok else "SOME TESTS FAILED"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
