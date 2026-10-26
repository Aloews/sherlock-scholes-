#!/usr/bin/env python3
"""Regression tests for the seasonal-stat collection queue."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from players_stats_transfermarkt import filter_candidates, select_stale_candidates  # noqa: E402
from datetime import datetime, timezone


class CandidateSelectionTests(unittest.TestCase):
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



class FreshnessSelectionTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 10, 26, 12, tzinfo=timezone.utc)
        self.cards = [
            {"transfermarkt_id": "fresh"},
            {"transfermarkt_id": "stale"},
            {"transfermarkt_id": "missing"},
            {"transfermarkt_id": "invalid"},
        ]
        self.freshness = {
            "fresh": "2026-10-25T12:00:00+00:00",
            "stale": "2026-10-01T12:00:00+00:00",
            "invalid": "not-a-date",
        }

    def test_refreshes_missing_and_stale_but_skips_fresh(self):
        selected = select_stale_candidates(self.cards, self.freshness, 7, self.now)
        self.assertEqual(
            [c["transfermarkt_id"] for c in selected],
            ["stale", "missing", "invalid"],
        )

    def test_empty_freshness_selects_every_player(self):
        self.assertEqual(
            select_stale_candidates(self.cards, {}, 7, self.now),
            self.cards,
        )

    def test_zero_day_threshold_selects_all_existing_records_as_stale(self):
        self.assertEqual(
            select_stale_candidates(self.cards, self.freshness, 0, self.now),
            self.cards,
        )


if __name__ == "__main__":
    unittest.main()
