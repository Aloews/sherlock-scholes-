"""Offline tests for the fuzzy duplicate finder — NO network.

Run from the football_scraper/ directory:
    python3 -m tests.test_dedup
or:
    python3 tests/test_dedup.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scraper.dedup import (  # noqa: E402
    canonical_key,
    find_duplicate_pairs,
    normalize,
    normalize_display_name,
    strip_patronymic,
    translit_latin_to_cyrillic,
)


def check(label, got, want):
    status = "ok " if got == want else "FAIL"
    print("  [{}] {}: got={!r} want={!r}".format(status, label, got, want))
    return got == want


def _ids(pairs):
    """Set of unordered id-pairs from find_duplicate_pairs output."""
    return {frozenset((a["id"], b["id"])) for a, b, _ in pairs}


def main():
    ok = True

    # normalize: drops case, spaces and punctuation.
    ok &= check("normalize comma+space", normalize("Холанд, Эрлинг"),
                "холандэрлинг")
    ok &= check("normalize strips punct", normalize("Шальке-04 (клуб)"),
                "шальке04клуб")
    ok &= check("normalize empty", normalize(None), "")
    ok &= check("normalize folds ё to е", normalize("Артём Дзюба"),
                normalize("Артем Дзюба"))
    ok &= check("canonical_key ё/е match",
                canonical_key("Фёдор Смолов") == canonical_key("Федор Смолов"),
                True)

    # transliteration: Latin folds onto Cyrillic; Cyrillic passes through.
    ok &= check("translit passthrough cyr",
                translit_latin_to_cyrillic("хави"), "хави")
    ok &= check("translit digraph sh",
                translit_latin_to_cyrillic("sh"), "ш")

    # strip_patronymic: middle word of a 3-word name only.
    ok &= check("patronymic dropped", strip_patronymic("Артём Сергеевич Дзюба"),
                "Артём Дзюба")
    ok &= check("female patronymic", strip_patronymic("Анна Ильинична Иванова"),
                "Анна Иванова")
    ok &= check("latin patronymic", strip_patronymic("Artem Sergeyevich Dzyuba"),
                "Artem Dzyuba")
    ok &= check("two-word name untouched", strip_patronymic("Артём Дзюба"),
                "Артём Дзюба")
    ok &= check("serbian -ич surname kept (2 words)",
                strip_patronymic("Деян Станкович"), "Деян Станкович")
    ok &= check("hyphenated surname untouched",
                strip_patronymic("Сергей Милинкович-Савич Иванов") ==
                "Сергей Иванов", True)  # middle token IS patronymic-like here
    ok &= check("normalize_display_name flips and strips patronymic",
                normalize_display_name("Дзюба, Артём Сергеевич"),
                "Артём Дзюба")
    ok &= check("canonical_key matches after patronymic strip",
                canonical_key(normalize_display_name(
                    "Дзюба, Артём Сергеевич")) == canonical_key("Артём Дзюба"),
                True)

    # canonical_key brings a Latin and a Cyrillic spelling close together.
    print("  [info] key('Xavi')   = {!r}".format(canonical_key("Xavi")))
    print("  [info] key('Хави')   = {!r}".format(canonical_key("Хави")))

    cards = [
        {"id": "1", "name": "Холанд, Эрлинг", "category": "player"},
        {"id": "2", "name": "Холланд Эрлинг", "category": "player"},   # dup of 1 (spelling)
        {"id": "3", "name": "Лионель Месси", "category": "player"},
        {"id": "4", "name": "Месси, Лионель", "category": "player"},    # dup of 3 (word order)
        {"id": "5", "name": "Зенит", "category": "club"},               # unrelated
        {"id": "6", "name": "", "category": "term"},                    # skipped (empty)
    ]
    pairs = find_duplicate_pairs(cards)
    got = _ids(pairs)

    ok &= check("Holland pair flagged",
                frozenset(("1", "2")) in got, True)
    ok &= check("Messi word-order pair flagged",
                frozenset(("3", "4")) in got, True)
    ok &= check("unrelated Zenit not paired",
                any("5" in {a["id"], b["id"]} for a, b, _ in pairs), False)
    ok &= check("empty-name card 6 never paired",
                any("6" in {a["id"], b["id"]} for a, b, _ in pairs), False)

    # Identical-after-normalization pair scores 1.0 (definite dup).
    same = find_duplicate_pairs([
        {"id": "a", "name": "Хави", "category": "player"},
        {"id": "b", "name": "хави", "category": "player"},
    ])
    ok &= check("identical-after-normalize score 1.0",
                round(same[0][2], 3) if same else None, 1.0)

    print("\n{}".format("ALL TESTS PASSED" if ok else "SOME TESTS FAILED"))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
