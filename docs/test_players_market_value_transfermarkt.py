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
    def test_refresh_prioritizes_missing_and_old_source_dates(self):
        cards = [
            {"name": "Newest", "market_value_eur": 90_000_000, "market_value_at": "2026-10-01"},
            {"name": "No date", "market_value_eur": 40_000_000, "market_value_at": None},
            {"name": "Old low", "market_value_eur": 10_000_000, "market_value_at": "2025-01-01"},
            {"name": "Old high", "market_value_eur": 70_000_000, "market_value_at": "2025-01-01"},
            {"name": "Mid", "market_value_eur": 50_000_000, "market_value_at": "2026-01-01"},
        ]
        ordered = sorted(cards, key=market_value_refresh_key)
        self.assertEqual(
            [card["name"] for card in ordered],
            ["No date", "Old high", "Old low", "Mid", "Newest"],
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
