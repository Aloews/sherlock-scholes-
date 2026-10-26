#!/usr/bin/env python3
"""Regression tests for the seasonal-stat collection queue."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from players_stats_transfermarkt import filter_candidates, select_stale_candidates, parse_seasons, parse_season_competition_stats, payload_status  # noqa: E402
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



class ProviderPayloadSafetyTests(unittest.TestCase):
    def test_incomplete_statistics_are_not_converted_to_zero_rows(self):
        payload = {"success": True, "data": {"performance": [
            {"generalInformation": {"seasonId": 2025, "competitionId": "GB1", "clubId": "281"},
             "statistics": {"goalStatistics": {}, "playingTimeStatistics": {}}},
            {"generalInformation": {"seasonId": 2025, "competitionId": "FAC", "clubId": "281"},
             "statistics": {"goalStatistics": {"goalsSum": 0, "assistsSum": 0},
                            "playingTimeStatistics": {"appearancesCount": 0, "playedMinutesSum": 0}}},
        ]}}
        rows = parse_seasons(payload)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["competition_id"], "FAC")
        self.assertEqual(rows[0]["goals"], 0)

    def test_failed_or_empty_payload_is_not_treated_as_statistics(self):
        self.assertEqual(parse_seasons(None), [])
        self.assertEqual(parse_seasons({"success": False, "data": {}}), [])



class TrueSeasonStatisticsTests(unittest.TestCase):
    def test_parses_season_and_competition_from_detailed_link(self):
        payload = [{
            "detailedStatsLink": "/cole-palmer/leistungsdatendetails/spieler/568177/wettbewerb/GB1/saison/2025",
            "competitionDescription": "Premier League",
            "nameSeason": "25/26",
            "possibleGames": 38,
            "gamesPlayed": 24,
            "goalsScored": 14,
            "assists": 3,
            "yellowCards": 4,
            "secondYellowCards": 0,
            "redCards": 0,
            "startElevenPercent": 91.67,
            "minutesPlayedPercent": 82.5,
            "goalsContributedPercent": 60.0,
            "goalkeeper": False,
            "minutesPlayed": 1980,
        }]
        rows = parse_season_competition_stats(payload, "568177")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["season_id"], 2025)
        self.assertEqual(rows[0]["competition_id"], "GB1")
        self.assertEqual(rows[0]["apps"], 24)
        self.assertEqual(rows[0]["goals"], 14)
        self.assertEqual(rows[0]["minutes"], 1980)
        self.assertEqual(rows[0]["goalkeeper"], False)
        self.assertIn("/ceapi/player/568177/performance", rows[0]["source_url"])

    def test_missing_core_season_fields_are_skipped(self):
        payload = [{
            "detailedStatsLink": "/player/568177/wettbewerb/GB1/saison/2025",
            "gamesPlayed": None, "goalsScored": 1, "assists": 0, "minutesPlayed": 90,
        }]
        self.assertEqual(parse_season_competition_stats(payload, "568177"), [])

    def test_distinguishes_empty_response_from_bad_payload(self):
        self.assertEqual(payload_status([], [], "season"), "empty")
        self.assertEqual(payload_status(None, [], "season"), "error")
        self.assertEqual(payload_status({"html": "challenge"}, [], "season"), "error")


if __name__ == "__main__":
    unittest.main()
