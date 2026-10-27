#!/usr/bin/env python3
"""Regression tests for the seasonal-stat collection queue."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from players_stats_transfermarkt import category_filter, filter_candidates  # noqa: E402


class CandidateSelectionTests(unittest.TestCase):
    def test_category_filter_supports_women_without_changing_default(self):
        self.assertEqual(category_filter("player"), "eq.player")
        self.assertEqual(category_filter("woman"), "eq.woman")
        self.assertEqual(category_filter("both"), "in.(player,woman)")
        with self.assertRaises(ValueError):
            category_filter("unknown")

    def test_threshold_keeps_equal_and_higher_values(self):
        cards = [
            {"transfermarkt_id": "1", "market_value_eur": 599999},
            {"transfermarkt_id": "2", "market_value_eur": 600000},
            {"transfermarkt_id": "3", "market_value_eur": "1200000"},
        ]
        self.assertEqual(
            [c["transfermarkt_id"] for c in filter_candidates(cards, 600000)],
            ["2", "3"],
        )

    def test_unvalued_players_are_included_only_when_requested(self):
        cards = [
            {"transfermarkt_id": "1", "market_value_eur": None},
            {"transfermarkt_id": "2", "market_value_eur": 200000},
        ]
        self.assertEqual(
            [c["transfermarkt_id"] for c in filter_candidates(cards, 0)],
            ["2"],
        )
        self.assertEqual(
            [c["transfermarkt_id"] for c in filter_candidates(
                cards, 0, include_unvalued=True)],
            ["1", "2"],
        )

    def test_invalid_values_do_not_break_the_queue(self):
        cards = [
            {"transfermarkt_id": "1", "market_value_eur": "unknown"},
            {"transfermarkt_id": "2", "market_value_eur": 0},
        ]
        self.assertEqual(
            [c["transfermarkt_id"] for c in filter_candidates(
                cards, 0, include_unvalued=True)],
            ["2"],
        )


if __name__ == "__main__":
    unittest.main()
