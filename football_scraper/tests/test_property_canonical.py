"""Property-based tests for the dedup key — NO network.

canonical_key() is the invariant that stops the same player being inserted
twice under a different spelling. These Hypothesis properties fuzz it with
thousands of generated names to find order/case/spacing holes that
example-based tests miss.

    pytest football_scraper/tests/test_property_canonical.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from hypothesis import given, strategies as st  # noqa: E402

from scraper.dedup import canonical_key  # noqa: E402

# Cyrillic name tokens: 2-12 letters, no spaces/punctuation.
CYR = "абвгдеёжзийклмнопрстуфхцчшщъыьэюяАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ"
token = st.text(alphabet=CYR, min_size=2, max_size=12)


@given(token)
def test_deterministic(name):
    assert canonical_key(name) == canonical_key(name)


@given(token)
def test_case_insensitive(name):
    assert canonical_key(name.lower()) == canonical_key(name.upper())


@given(token, token)
def test_word_order_invariant(a, b):
    # "Эрлинг Холанд" and "Холанд Эрлинг" must collapse onto one key, otherwise
    # a re-ordered scrape would sail past the duplicate guard.
    assert canonical_key(f"{a} {b}") == canonical_key(f"{b} {a}")


@given(token, token)
def test_comma_form_matches_spaced_form(surname, given_name):
    # "Surname, Given" (old manual format) vs "Given Surname" (auto-translated).
    assert canonical_key(f"{surname}, {given_name}") == canonical_key(
        f"{given_name} {surname}"
    )


@given(token)
def test_surrounding_whitespace_ignored(name):
    assert canonical_key(f"  {name}  ") == canonical_key(name)
