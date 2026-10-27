#!/usr/bin/env python3
"""Regression tests for the seasonal-stat collection queue."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from players_stats_transfermarkt import (  # noqa: E402
    filter_candidates,
    latest_stat_fetch_by_tm,
    refresh_priority_key,
)


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


    def test_refresh_prioritizes_missing_and_oldest_stats(self):
        cards = [
            {"id": "1", "transfermarkt_id": "1", "market_value_eur": 120000000},
            {"id": "2", "transfermarkt_id": "2", "market_value_eur": 60000000},
            {"id": "3", "transfermarkt_id": "3", "market_value_eur": 90000000},
        ]
        latest = latest_stat_fetch_by_tm([
            {"tm_player_id": "1", "fetched_at": "2026-10-26T10:00:00Z"},
            {"tm_player_id": "2", "fetched_at": "2026-09-07T03:00:00Z"},
        ])
        ordered = sorted(cards, key=lambda card: refresh_priority_key(card, latest))
        self.assertEqual([card["transfermarkt_id"] for card in ordered], ["3", "2", "1"])

    def test_latest_stats_timestamp_uses_most_recent_row(self):
        latest = latest_stat_fetch_by_tm([
            {"tm_player_id": "316264", "fetched_at": "2026-09-07T03:00:00Z"},
            {"tm_player_id": "316264", "fetched_at": "2026-10-26T13:15:00Z"},
            {"tm_player_id": None, "fetched_at": "2026-10-27T00:00:00Z"},
        ])
        self.assertEqual(latest, {"316264": "2026-10-26T13:15:00Z"})

    def test_old_career_rows_do_not_count_as_current_season_refresh(self):
        stored = [
            {"tm_player_id": "316264", "season_id": 2025, "fetched_at": "2026-10-26T13:15:00Z"},
            {"tm_player_id": "132098", "season_id": 2024, "fetched_at": "2026-10-26T13:15:00Z"},
            {"tm_player_id": "2", "season_id": 2026, "fetched_at": "2026-10-27T10:00:00Z"},
        ]
        latest = latest_stat_fetch_by_tm(stored, season_id=2026)
        self.assertEqual(latest, {"2": "2026-10-27T10:00:00Z"})

        cards = [
            {"id": "odegaard", "transfermarkt_id": "316264", "market_value_eur": 70000000},
            {"id": "kane", "transfermarkt_id": "132098", "market_value_eur": 60000000},
            {"id": "refreshed", "transfermarkt_id": "2", "market_value_eur": 100000000},
        ]
        ordered = sorted(cards, key=lambda card: refresh_priority_key(card, latest))
        self.assertEqual(
            [card["transfermarkt_id"] for card in ordered],
            ["316264", "132098", "2"],
        )

    def test_current_season_timestamp_wins_over_newer_historical_timestamp(self):
        latest = latest_stat_fetch_by_tm([
            {"tm_player_id": "316264", "season_id": 2025, "fetched_at": "2026-10-27T12:00:00Z"},
            {"tm_player_id": "316264", "season_id": 2026, "fetched_at": "2026-10-20T12:00:00Z"},
            {"tm_player_id": "316264", "season_id": 2026, "fetched_at": "2026-10-26T13:15:00Z"},
        ], season_id=2026)
        self.assertEqual(latest, {"316264": "2026-10-26T13:15:00Z"})

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
