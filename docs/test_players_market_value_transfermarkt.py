#!/usr/bin/env python3
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from players_market_value_transfermarkt import (  # noqa: E402
    market_value_refresh_key,
    should_write_market_value,
)


class MarketValueRefreshTests(unittest.TestCase):
    def test_refresh_prioritizes_oldest_attempt_and_source_date_breaks_ties(self):
        cards = [
            {"name": "Recently checked", "market_value_eur": 90_000_000,
             "market_value_at": "2025-01-01", "market_value_checked_at": "2026-10-20T00:00:00+00:00"},
            {"name": "Never checked", "market_value_eur": 40_000_000,
             "market_value_at": "2026-10-01", "market_value_checked_at": None},
            {"name": "Old check, newer value", "market_value_eur": 50_000_000,
             "market_value_at": "2026-01-01", "market_value_checked_at": "2026-09-01T00:00:00+00:00"},
            {"name": "Old check, old low", "market_value_eur": 10_000_000,
             "market_value_at": "2025-01-01", "market_value_checked_at": "2026-09-01T00:00:00+00:00"},
            {"name": "Old check, old high", "market_value_eur": 70_000_000,
             "market_value_at": "2025-01-01", "market_value_checked_at": "2026-09-01T00:00:00+00:00"},
        ]
        ordered = sorted(cards, key=market_value_refresh_key)
        self.assertEqual(
            [card["name"] for card in ordered],
            ["Never checked", "Old check, old high", "Old check, old low",
             "Old check, newer value", "Recently checked"],
        )

    def test_unknown_valuation_date_is_never_written(self):
        self.assertTrue(should_write_market_value(65_000_000, "2026-06-03"))
        self.assertFalse(should_write_market_value(65_000_000, None))
        self.assertFalse(should_write_market_value(65_000_000, "not-a-date"))
        self.assertFalse(should_write_market_value(65_000_000, "2999-01-01"))
        self.assertFalse(should_write_market_value(None, "2026-06-03"))
        self.assertFalse(should_write_market_value(0, "2026-06-03"))


if __name__ == "__main__":
    unittest.main()
